// textbee (own-SIM gateway) provider tests. Same shape as twilioProvider.test.ts:
// the env module is mocked to pose as a non-test runtime with SMS_PROVIDER=textbee
// (the real test env forces the mock provider), and global.fetch is stubbed so no
// network is touched.
jest.mock('../../src/config/env', () => {
  const actual = jest.requireActual('../../src/config/env');
  return {
    ...actual,
    isTest: false,
    env: {
      ...actual.env,
      smsProvider: 'textbee',
      textbeeApiKey: 'tb_test_key_123',
      textbeeApiUrl: 'https://api.textbee.dev/api/v1',
      textbeeDeviceId: '',
    },
  };
});

// Pose as a runtime with no DB provider-override: this file stays unit-level
// (no DB, no network). A real query would stall under test 127's fake timers
// until the jest timeout — which also leaked real timers into later tests.
jest.mock('../../src/services/settingsService', () => ({
  getSmsProviderOverride: jest.fn().mockResolvedValue(null),
}));

import { env } from '../../src/config/env';
import { getSmsConfig, parseTextbeeDeliveryOutcome, parseTextbeeResponse, sendSms, verifyTextbeeSignature } from '../../src/services/smsProvider';

const fetchMock = jest.fn();

// jest 30: the sandbox `global` serves `fetch` from the host realm through a
// proxy — it is NOT an own property, so jest.spyOn(...)+restoreAllMocks()
// deletes it permanently instead of restoring it. Assign/restore directly.
const GLOBAL = global as unknown as { fetch: typeof fetch };
const realFetch = GLOBAL.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  GLOBAL.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  GLOBAL.fetch = realFetch;
  jest.restoreAllMocks();
});

function textbeeQueued(overrides: Record<string, unknown> = {}, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({
      data: { success: true, message: 'SMS added to queue for processing', smsBatchId: '66b1f2c3a4d5e6f7a8b9c0d2', recipientCount: 1, ...overrides },
    }),
  };
}

describe('getSmsConfig (textbee)', () => {
  it('is live with only an API key — no sender ID exists to verify', async () => {
    expect(await getSmsConfig()).toMatchObject({ provider: 'textbee', live: true });
  });

  it('exposes no senderId: the SIM in the phone is the sender, not an ID we set', async () => {
    expect((await getSmsConfig()).senderId).toBeUndefined();
  });

  it('is not live without an API key', async () => {
    (env as { textbeeApiKey: string }).textbeeApiKey = '';
    expect((await getSmsConfig()).live).toBe(false);
    (env as { textbeeApiKey: string }).textbeeApiKey = 'tb_test_key_123';
  });
});

describe('sendSms (textbee)', () => {
  it('POSTs x-api-key auth with recipients[]+message and NO from field', async () => {
    fetchMock.mockResolvedValue(textbeeQueued());
    const result = await sendSms({ phoneNumber: '0711000002', message: 'Rent receipt test' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('tb_test_key_123');
    expect(init.headers['Content-Type']).toBe('application/json');

    const payload = JSON.parse(init.body);
    expect(payload.recipients).toEqual(['+254711000002']); // normalized E.164
    expect(payload.message).toBe('Rent receipt test');
    // No sender identity of any kind — that is the point of this provider.
    expect(payload.from).toBeUndefined();
    expect(payload.senderId).toBeUndefined();
    expect(payload.deviceId).toBeUndefined(); // unset → textbee picks the default

    expect(result).toMatchObject({ ok: true, providerMessageId: '66b1f2c3a4d5e6f7a8b9c0d2' });
    // Cost is the carrier's bundle, so the provider never reports one.
    expect(result.cost).toBeUndefined();
  });

  it('includes deviceId only when TEXTBEE_DEVICE_ID is set', async () => {
    (env as { textbeeDeviceId: string }).textbeeDeviceId = 'dev_42';
    fetchMock.mockResolvedValue(textbeeQueued());
    await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).deviceId).toBe('dev_42');
    (env as { textbeeDeviceId: string }).textbeeDeviceId = '';
  });

  it('strips a trailing slash from TEXTBEE_API_URL so the path never doubles', async () => {
    (env as { textbeeApiUrl: string }).textbeeApiUrl = 'http://localhost:3001/api/v1/';
    fetchMock.mockResolvedValue(textbeeQueued());
    await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/v1/gateway/send-sms');
    (env as { textbeeApiUrl: string }).textbeeApiUrl = 'https://api.textbee.dev/api/v1';
  });

  it('turns the 429 free-tier quota response into an actionable FAILED send', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'Daily message limit reached' }),
    });
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('429');
    expect(result.failureReason).toContain('Daily message limit reached');
    expect(result.failureReason).toContain('retry later');
  });

  it('fails with a credential hint on 401 rather than a generic HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) });
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('TEXTBEE_API_KEY');
  });

  it('reports data.success=false as a rejected send, not an accepted one', async () => {
    fetchMock.mockResolvedValue(textbeeQueued({ success: false, message: 'Device is offline', smsBatchId: undefined }));
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('Device is offline');
  });

  it('times out with an offline-phone hint instead of hanging the request', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
      }),
    );
    jest.useFakeTimers();
    try {
      const pending = sendSms({ phoneNumber: '+254711000002', message: 'x' });
      await jest.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.failureReason).toContain('timed out');
      expect(result.failureReason).toContain('phone online');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails fast with a clear reason when the API key is missing (no network)', async () => {
    (env as { textbeeApiKey: string }).textbeeApiKey = '';
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('TEXTBEE_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
    (env as { textbeeApiKey: string }).textbeeApiKey = 'tb_test_key_123';
  });

  it('rejects unparseable phone numbers before contacting the gateway', async () => {
    const result = await sendSms({ phoneNumber: 'not-a-phone', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('Invalid phone number');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseTextbeeResponse (response mapping)', () => {
  it('records the batch id from the queued-accept shape', () => {
    const r = parseTextbeeResponse({ data: { success: true, smsBatchId: 'batch_1' } }, 200);
    expect(r).toMatchObject({ ok: true, providerMessageId: 'batch_1' });
  });

  it('falls back to a generated id when the immediate-dispatch shape omits one', () => {
    const r = parseTextbeeResponse({ data: { successCount: 1, failureCount: 0 } }, 200);
    expect(r.ok).toBe(true);
    expect(r.providerMessageId).toMatch(/^TEXTBEE-\d+$/);
  });

  it('does not record a partial recipient failure as full success', () => {
    const r = parseTextbeeResponse({ data: { successCount: 0, failureCount: 2 } }, 200);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toContain('2 recipient(s) failed');
  });

  it('accepts a mixed batch that mostly succeeded, carrying the batch id', () => {
    const r = parseTextbeeResponse({ data: { successCount: 3, failureCount: 1, smsBatchId: 'batch_2' } }, 200);
    expect(r).toMatchObject({ ok: true, providerMessageId: 'batch_2' });
  });

  it('treats a 200 with no data as a non-send rather than a success', () => {
    expect(parseTextbeeResponse({}, 200).ok).toBe(false);
    expect(parseTextbeeResponse({ data: {} }, 200).ok).toBe(true); // {} → id "unknown"
  });

  it('surfaces the free-tier limit wording for 429 even with an empty body', () => {
    const r = parseTextbeeResponse({}, 429);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toContain('50/day');
    expect(r.failureReason).toContain('300/month');
  });

  it('passes through other 4xx/5xx statuses with the provider message', () => {
    const r = parseTextbeeResponse({ message: 'Device not found' }, 404);
    expect(r.ok).toBe(false);
    expect(r.failureReason).toContain('404');
    expect(r.failureReason).toContain('Device not found');
  });
});

describe('parseTextbeeDeliveryOutcome (webhook mapping)', () => {
  it('maps delivered and failed to the terminal outcomes', () => {
    expect(parseTextbeeDeliveryOutcome({ webhookEvent: 'MESSAGE_DELIVERED' })).toBe('DELIVERED');
    expect(parseTextbeeDeliveryOutcome({ webhookEvent: 'MESSAGE_FAILED' })).toBe('FAILED_ON_NETWORK');
  });

  it('ignores sent, unknown-state and unrecognised events (no outcome)', () => {
    // MESSAGE_SENT merely left the phone — the row is already SENT.
    expect(parseTextbeeDeliveryOutcome({ webhookEvent: 'MESSAGE_SENT' })).toBeNull();
    // UNKNOWN_STATE is log-only per textbee: the message may still arrive.
    expect(parseTextbeeDeliveryOutcome({ webhookEvent: 'UNKNOWN_STATE' })).toBeNull();
    expect(parseTextbeeDeliveryOutcome({ webhookEvent: 'SMS_STATUS_UPDATED' })).toBeNull();
    expect(parseTextbeeDeliveryOutcome({})).toBeNull();
  });
});

describe('verifyTextbeeSignature (webhook auth)', () => {
  const { createHmac } = jest.requireActual('node:crypto') as typeof import('node:crypto');
  const secret = 'test-webhook-secret-0123456789abcdef';
  const body = Buffer.from(JSON.stringify({ webhookEvent: 'MESSAGE_DELIVERED', smsBatchId: 'b1' }));
  const good = createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the correct HMAC-SHA256 hex of the raw body', () => {
    expect(verifyTextbeeSignature(body, good, secret)).toBe(true);
  });

  it('rejects a forged signature, a missing one, and a missing secret', () => {
    expect(verifyTextbeeSignature(body, '0'.repeat(64), secret)).toBe(false);
    expect(verifyTextbeeSignature(body, undefined, secret)).toBe(false);
    expect(verifyTextbeeSignature(body, good, '')).toBe(false);
  });

  it('rejects when the body differs by even one byte', () => {
    const tampered = Buffer.from(JSON.stringify({ webhookEvent: 'MESSAGE_DELIVERED', smsBatchId: 'b2' }));
    expect(verifyTextbeeSignature(tampered, good, secret)).toBe(false);
  });
});
