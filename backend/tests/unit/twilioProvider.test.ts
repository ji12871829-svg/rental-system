// Twilio provider tests. The env module is mocked to pose as a non-test
// runtime with SMS_PROVIDER=twilio (the real test env forces the mock
// provider), and global.fetch is stubbed so no network is touched.
jest.mock('../../src/config/env', () => {
  const actual = jest.requireActual('../../src/config/env');
  return {
    ...actual,
    isTest: false,
    env: {
      ...actual.env,
      smsProvider: 'twilio',
      twilioAccountSid: 'AC7172635464748',
      twilioAuthToken: 'test-auth-token',
      twilioMessagingServiceSid: 'MG999888777',
      twilioFrom: '',
    },
  };
});

import { env } from '../../src/config/env';
import { getSmsConfig, sendSms } from '../../src/services/smsProvider';

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  jest.spyOn(global, 'fetch').mockImplementation(fetchMock);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function twilioSuccess(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 201,
    json: async () => ({ sid: 'SM8888', status: 'queued', price: null, price_unit: null, ...overrides }),
  };
}

describe('getSmsConfig (twilio)', () => {
  it('reports the twilio provider as live when credentials and a sender exist', () => {
    expect(getSmsConfig()).toMatchObject({ provider: 'twilio', live: true, senderId: 'MG999888777' });
  });

  it('is not live without a sender (From or Messaging Service)', () => {
    (env as { twilioMessagingServiceSid: string }).twilioMessagingServiceSid = '';
    expect(getSmsConfig().live).toBe(false);
    (env as { twilioMessagingServiceSid: string }).twilioMessagingServiceSid = 'MG999888777';
  });
});

describe('sendSms (twilio)', () => {
  it('POSTs Basic-auth form data and prefers the Messaging Service over From', async () => {
    fetchMock.mockResolvedValue(twilioSuccess());
    const result = await sendSms({ phoneNumber: '0711000002', message: 'Receipt test' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC7172635464748/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC7172635464748:test-auth-token').toString('base64')}`);
    const form = new URLSearchParams(init.body);
    expect(form.get('To')).toBe('+254711000002'); // normalized E.164
    expect(form.get('Body')).toBe('Receipt test');
    expect(form.get('MessagingServiceSid')).toBe('MG999888777');
    expect(form.get('From')).toBeNull();

    expect(result).toMatchObject({ ok: true, providerMessageId: 'SM8888' });
  });

  it('falls back to TWILIO_FROM when no Messaging Service is configured', async () => {
    (env as { twilioMessagingServiceSid: string }).twilioMessagingServiceSid = '';
    (env as { twilioFrom: string }).twilioFrom = '+15550001111';
    fetchMock.mockResolvedValue(twilioSuccess());

    await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    const form = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(form.get('From')).toBe('+15550001111');
    expect(form.get('MessagingServiceSid')).toBeNull();

    (env as { twilioFrom: string }).twilioFrom = '';
    (env as { twilioMessagingServiceSid: string }).twilioMessagingServiceSid = 'MG999888777';
  });

  it('parses provider-reported cost (absolute value, uppercase currency)', async () => {
    fetchMock.mockResolvedValue(twilioSuccess({ price: '-0.0150', price_unit: 'USD' }));
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(true);
    expect(result.cost).toEqual({ amount: 0.015, currency: 'USD' });
  });

  it('treats a Twilio error payload as a FAILED send with the code and message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 21211, message: "The 'To' number is not a valid phone number." }),
    });
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('21211');
    expect(result.failureReason).toContain('not a valid phone number');
  });

  it('fails fast with a clear reason when credentials are missing (no network)', async () => {
    (env as { twilioAccountSid: string }).twilioAccountSid = '';
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('TWILIO_ACCOUNT_SID');
    expect(fetchMock).not.toHaveBeenCalled();
    (env as { twilioAccountSid: string }).twilioAccountSid = 'AC7172635464748';
  });

  it('rejects unparseable phone numbers before contacting the provider', async () => {
    const result = await sendSms({ phoneNumber: 'not-a-phone', message: 'x' });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain('Invalid phone number');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
