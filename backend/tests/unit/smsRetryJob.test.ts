// Unit tests for the retry sweep's claim + error-containment logic. The DB
// integration (fail → backoff → retry → sent) is covered in api.test.ts.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));
jest.mock('../../src/services/smsService', () => ({
  sendSmsNotification: jest.fn().mockResolvedValue({}),
}));

import { pool } from '../../src/config/db';
import { env } from '../../src/config/env';
import { runRetrySweep, startSmsRetryJob, stopSmsRetryJob } from '../../src/services/smsRetryJob';
import { sendSmsNotification } from '../../src/services/smsService';

const poolQuery = pool.query as jest.Mock;
const sender = sendSmsNotification as jest.Mock;

beforeEach(() => {
  poolQuery.mockReset();
  sender.mockReset().mockResolvedValue({});
  (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
});

afterEach(() => {
  (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
});

describe('runRetrySweep', () => {
  it('re-sends every due FAILED row it claims', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 11 }, { id: 12 }] });
    const n = await runRetrySweep(new Date('2026-09-09T10:00:00Z'));
    expect(n).toBe(2);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledWith(11);
    expect(sender).toHaveBeenCalledWith(12);
    // The claim query filters by FAILED + due deadline, newest deadline first.
    const claimSql = poolQuery.mock.calls[0][0] as string;
    expect(claimSql).toContain("status = 'FAILED'");
    expect(claimSql).toContain('next_retry_at <= $1');
    expect(claimSql).toContain('SKIP LOCKED');
  });

  it('does nothing when nothing is due', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    expect(await runRetrySweep()).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it('continues the sweep and reverts the row when one send throws', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    sender.mockRejectedValueOnce(new Error('provider exploded')).mockResolvedValueOnce({});
    const n = await runRetrySweep();
    expect(n).toBe(1); // only the second row counted as dispatched
    expect(sender).toHaveBeenCalledTimes(2);
    // The failed row was flipped back to FAILED with the reason appended
    // (the concatenation itself happens in SQL — params are id + raw error).
    const revert = poolQuery.mock.calls.find((c) => (c[0] as string).includes('retry error'));
    expect(revert?.[1]).toEqual([1, 'provider exploded']);
  });

  it('returns 0 without touching the DB when retries are disabled', async () => {
    (env as { smsRetryEnabled: boolean }).smsRetryEnabled = false;
    await runRetrySweep();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('startSmsRetryJob honors the disabled flag and is idempotent', () => {
    // The job no-ops entirely under NODE_ENV=test; pose as production to
    // exercise the flag + idempotency, then restore.
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      (env as { smsRetryEnabled: boolean }).smsRetryEnabled = false;
      startSmsRetryJob(); // logs "disabled", starts nothing
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));

      (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
      logSpy.mockClear();
      startSmsRetryJob(); // starts the interval
      startSmsRetryJob(); // idempotent — timer already running
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('running every'));
    } finally {
      stopSmsRetryJob();
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNodeEnv;
      logSpy.mockRestore();
    }
  });
});
