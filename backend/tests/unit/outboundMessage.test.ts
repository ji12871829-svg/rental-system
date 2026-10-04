// The Outbound Message module — the one auto-send gate and post-commit
// dispatch seam both channels enter through. The test environment always opts
// out of auto-send, so these tests pose as production (isTest: false) and
// drive the seam directly plus through its two channel entry points. The SMS
// entry point's sender injection is covered in dispatchAutoSend.test.ts; this
// suite pins the shared seam, the per-channel gate, and the id guards.
jest.mock('../../src/config/env', () => {
  const actual = jest.requireActual('../../src/config/env');
  return { ...actual, isTest: false };
});

import { env } from '../../src/config/env';
import { autoSendEnabled, dispatchAfterCommit } from '../../src/services/outboundMessage';
import { dispatchAutoEmail } from '../../src/services/emailService';
import { dispatchAutoSend } from '../../src/services/smsService';

const flags = env as { smsAutoSend: boolean; emailAutoSend: boolean };

beforeAll(() => {
  flags.smsAutoSend = true;
  flags.emailAutoSend = true;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  flags.smsAutoSend = true;
  flags.emailAutoSend = true;
});

describe('autoSendEnabled — one gate, per channel', () => {
  it('follows each channel flag independently', () => {
    expect(autoSendEnabled('SMS')).toBe(true);
    expect(autoSendEnabled('EMAIL')).toBe(true);

    flags.smsAutoSend = false;
    expect(autoSendEnabled('SMS')).toBe(false);
    expect(autoSendEnabled('EMAIL')).toBe(true);

    flags.emailAutoSend = false;
    expect(autoSendEnabled('SMS')).toBe(false);
    expect(autoSendEnabled('EMAIL')).toBe(false);
  });
});

describe('dispatchAfterCommit', () => {
  it('never runs the dispatch synchronously (post-commit semantics)', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(undefined);
    dispatchAfterCommit({ channel: 'SMS', what: 'notification 42', run });
    expect(run).not.toHaveBeenCalled();
    await jest.runAllTimersAsync();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('skips a channel whose flag is off', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(undefined);
    flags.emailAutoSend = false;
    dispatchAfterCommit({ channel: 'EMAIL', what: 'receipt 7', run });
    await jest.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
  });

  it('swallows a failed dispatch and logs it against the right channel', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.useFakeTimers();
    dispatchAfterCommit({
      channel: 'EMAIL',
      what: 'receipt 9',
      run: () => Promise.reject(new Error('provider down')),
    });
    await expect(jest.runAllTimersAsync()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[email] auto-send failed for receipt 9: provider down')
    );
  });

  it('lets a failing dispatch never escape as an unhandled rejection', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.useFakeTimers();
    const unhandled = jest.fn();
    process.once('unhandledRejection', unhandled);
    dispatchAfterCommit({ channel: 'SMS', what: 'notification 1', run: () => Promise.reject(new Error('boom')) });
    await jest.runAllTimersAsync();
    // A pending microtask flush: an uncaught rejection would surface here.
    await Promise.resolve();
    process.removeListener('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('channel entry points — id guards stay at the wrapper', () => {
  it('dispatchAutoSend ignores null/undefined ids before reaching the seam', async () => {
    jest.useFakeTimers();
    const sender = jest.fn();
    dispatchAutoSend(null, sender);
    dispatchAutoSend(undefined, sender);
    await jest.runAllTimersAsync();
    expect(sender).not.toHaveBeenCalled();
  });

  it('dispatchAutoEmail ignores a null receipt id', async () => {
    jest.useFakeTimers();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    dispatchAutoEmail(null);
    await jest.runAllTimersAsync();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('dispatchAutoEmail honors the channel gate before preparing anything', async () => {
    jest.useFakeTimers();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    flags.emailAutoSend = false;
    dispatchAutoEmail(12345); // would hit the DB if the gate let it through
    await jest.runAllTimersAsync();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
