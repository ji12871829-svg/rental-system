// Unit tests for the email channel's retry sweep — the twin of
// smsRetryJob.test.ts. The claim/error-containment logic is mocked at the DB
// seam; the full fail → backoff → retry → sent integration lives in api.test.ts.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));
jest.mock('../../src/services/emailService', () => ({
  sendEmailNotification: jest.fn().mockResolvedValue({}),
}));

import { pool } from '../../src/config/db';
import { env } from '../../src/config/env';
import { runEmailRetrySweep, startEmailRetryJob, stopEmailRetryJob } from '../../src/services/emailRetryJob';
import { sendEmailNotification } from '../../src/services/emailService';

const poolQuery = pool.query as jest.Mock;
const sender = sendEmailNotification as jest.Mock;

beforeEach(() => {
  poolQuery.mockReset();
  sender.mockReset().mockResolvedValue({});
  (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
});

afterEach(() => {
  (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
});

describe('runEmailRetrySweep', () => {
  it('re-sends every due row it claims (FAILED and ERRONEOUS alike)', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 21 }, { id: 22 }] });
    const n = await runEmailRetrySweep(new Date('2026-10-05T08:00:00Z'));
    expect(n).toBe(2);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledWith(21);
    expect(sender).toHaveBeenCalledWith(22);
    // The claim covers BOTH non-final statuses — only SENT is genuinely final.
    const claimSql = poolQuery.mock.calls[0][0] as string;
    expect(claimSql).toContain("status IN ('FAILED', 'ERRONEOUS')");
    expect(claimSql).toContain('next_retry_at IS NOT NULL');
    expect(claimSql).toContain('next_retry_at <= $1');
    expect(claimSql).toContain('SKIP LOCKED');
  });

  it('does nothing when nothing is due', async () => {
    poolQuery.mockResolvedValue({ rows: [] });
    expect(await runEmailRetrySweep()).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it('continues the sweep and reverts the row when one send throws', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
    sender.mockRejectedValueOnce(new Error('provider exploded')).mockResolvedValueOnce({});
    const n = await runEmailRetrySweep();
    expect(n).toBe(1); // only the second row counted as dispatched
    expect(sender).toHaveBeenCalledTimes(2);
    // The failed row was flipped back to FAILED with the reason appended
    // (the concatenation itself happens in SQL — params are id + raw error).
    const revert = poolQuery.mock.calls.find((c) => (c[0] as string).includes('retry error'));
    expect(revert?.[1]).toEqual([1, 'provider exploded']);
  });

  it('returns 0 without touching the DB when retries are disabled', async () => {
    (env as { smsRetryEnabled: boolean }).smsRetryEnabled = false;
    await runEmailRetrySweep();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('startEmailRetryJob honors the disabled flag and is idempotent', () => {
    // The job no-ops entirely under NODE_ENV=test; pose as production to
    // exercise the flag + idempotency, then restore.
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      (env as { smsRetryEnabled: boolean }).smsRetryEnabled = false;
      startEmailRetryJob(); // logs "disabled", starts nothing
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));

      (env as { smsRetryEnabled: boolean }).smsRetryEnabled = true;
      logSpy.mockClear();
      startEmailRetryJob(); // starts the interval
      startEmailRetryJob(); // idempotent — timer already running
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('running every'));
    } finally {
      stopEmailRetryJob();
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNodeEnv;
      logSpy.mockRestore();
    }
  });
});
