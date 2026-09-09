// dispatchAutoSend gating — the production code path is exercised live (the
// test environment deliberately opts out so integration tests can drive the
// manual send flow; these unit tests unmock the guard via DI).
jest.mock('../../src/config/env', () => {
  const actual = jest.requireActual('../../src/config/env');
  return { ...actual, isTest: false };
});

import { env } from '../../src/config/env';
import { dispatchAutoSend } from '../../src/services/smsService';

const sender = jest.fn().mockResolvedValue({});

beforeAll(() => {
  (env as { smsAutoSend: boolean }).smsAutoSend = true;
});

afterEach(() => {
  jest.useRealTimers();
  sender.mockClear();
  (env as { smsAutoSend: boolean }).smsAutoSend = true;
});

describe('dispatchAutoSend', () => {
  it('sends asynchronously after the tick (post-commit semantics)', async () => {
    jest.useFakeTimers();
    dispatchAutoSend(42, sender);
    expect(sender).not.toHaveBeenCalled(); // not synchronous
    await jest.runAllTimersAsync();
    expect(sender).toHaveBeenCalledWith(42);
  });

  it('ignores a null id (tenant has no phone — nothing prepared)', async () => {
    jest.useFakeTimers();
    dispatchAutoSend(null, sender);
    await jest.runAllTimersAsync();
    expect(sender).not.toHaveBeenCalled();
  });

  it('does nothing when SMS_AUTO_SEND is disabled', async () => {
    (env as { smsAutoSend: boolean }).smsAutoSend = false;
    jest.useFakeTimers();
    dispatchAutoSend(7, sender);
    await jest.runAllTimersAsync();
    expect(sender).not.toHaveBeenCalled();
  });

  it('swallows sender failures so a provider outage cannot crash the request', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failing = jest.fn().mockRejectedValue(new Error('provider down'));
    jest.useFakeTimers();
    dispatchAutoSend(9, failing);
    await expect(jest.runAllTimersAsync()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('auto-send failed for notification 9'));
    consoleError.mockRestore();
  });
});
