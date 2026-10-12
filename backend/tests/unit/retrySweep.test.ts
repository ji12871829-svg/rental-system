// Unit tests for the shared retry sweep (retrySweep.ts), exercised through
// BOTH of its channel bindings — smsRetryJob (claims FAILED) and
// emailRetryJob (claims FAILED + ERRONEOUS) — as one parameterized suite.
// The claim/error-containment logic is mocked at the DB seam; the full
// fail → backoff → retry → sent integration lives in api.test.ts.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));
jest.mock('../../src/services/smsService', () => ({
  sendSmsNotification: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/emailService', () => ({
  sendEmailNotification: jest.fn().mockResolvedValue({}),
}));

import { pool } from '../../src/config/db';
import { env } from '../../src/config/env';
import { runRetrySweep, startSmsRetryJob, stopSmsRetryJob } from '../../src/services/smsRetryJob';
import {
  runEmailRetrySweep,
  startEmailRetryJob,
  stopEmailRetryJob,
} from '../../src/services/emailRetryJob';
import { sendSmsNotification } from '../../src/services/smsService';
import { sendEmailNotification } from '../../src/services/emailService';

const poolQuery = pool.query as jest.Mock;

interface Channel {
  /** Display name for the describe block. */
  name: string;
  run: (now?: Date) => Promise<number>;
  start: () => void;
  stop: () => void;
  sender: jest.Mock;
  /** The distinctive claim filter (single status =, multi-status IN). */
  claimSqlFragment: string;
  /** Table the binding sweeps (the revert must target it too). */
  table: string;
}

const channels: Channel[] = [
  {
    name: 'SMS',
    run: runRetrySweep,
    start: startSmsRetryJob,
    stop: stopSmsRetryJob,
    sender: sendSmsNotification as jest.Mock,
    claimSqlFragment: "status = 'FAILED'",
    table: 'sms_notifications',
  },
  {
    name: 'email',
    run: runEmailRetrySweep,
    start: startEmailRetryJob,
    stop: stopEmailRetryJob,
    sender: sendEmailNotification as jest.Mock,
    // The claim covers BOTH non-final statuses — only SENT is genuinely final.
    claimSqlFragment: "status IN ('FAILED', 'ERRONEOUS')",
    table: 'email_notifications',
  },
];

beforeEach(() => {
  poolQuery.mockReset();
  (sendSmsNotification as jest.Mock).mockReset().mockResolvedValue({});
  (sendEmailNotification as jest.Mock).mockReset().mockResolvedValue({});
  (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
});

afterEach(() => {
  (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
});

describe.each(channels)('$name retry sweep', (channel) => {
  const { run, start, stop, sender, claimSqlFragment, table } = channel;

  it('re-sends every due row it claims', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 11 }, { id: 12 }] });
    const n = await run(new Date('2026-10-05T08:00:00Z'));
    expect(n).toBe(2);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledWith(11);
    expect(sender).toHaveBeenCalledWith(12);
    // The claim query filters by the channel's statuses + due deadline,
    // oldest deadline first, and claims rows without blocking concurrent
    // sweeps (FOR UPDATE SKIP LOCKED) on that channel's own table.
    const claimSql = poolQuery.mock.calls[0][0] as string;
    expect(claimSql).toContain(claimSqlFragment);
    expect(claimSql).toContain(`FROM ${table}`);
    expect(claimSql).toContain('next_retry_at IS NOT NULL');
    expect(claimSql).toContain('next_retry_at <= $1');
    expect(claimSql).toContain('SKIP LOCKED');
  });

  it('does nothing when nothing is due', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    expect(await run()).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it('continues the sweep and reverts the row when one send throws', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    sender.mockRejectedValueOnce(new Error('provider exploded')).mockResolvedValueOnce({});
    const n = await run();
    expect(n).toBe(1); // only the second row counted as dispatched
    expect(sender).toHaveBeenCalledTimes(2);
    // The failed row was flipped back to FAILED with the reason appended
    // (the concatenation itself happens in SQL — params are id + raw error).
    const revert = poolQuery.mock.calls.find((c) => (c[0] as string).includes('retry error'));
    expect(revert?.[1]).toEqual([1, 'provider exploded']);
    expect(revert?.[0]).toContain(`UPDATE ${table}`);
  });

  it('returns 0 without touching the DB when retries are disabled', async () => {
    (env as { smsRetryEnabled: boolean }).smsRetryEnabled = false;
    await run();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('start honors the disabled flag and is idempotent', () => {
    // The job no-ops entirely under NODE_ENV=test; pose as production to
    // exercise the flag + idempotency, then restore.
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      (env as { smsRetryEnabled: boolean }).smsRetryEnabled = false;
      start(); // logs "disabled", starts nothing
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));

      (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
      logSpy.mockClear();
      start(); // starts the interval
      start(); // idempotent — timer already running
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('running every'));
    } finally {
      stop();
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNodeEnv;
      logSpy.mockRestore();
    }
  });
});
