// Unit tests for the PayHero adapter: config gating, transaction
// normalization (tolerant field mapping, strict validation), and request
// shaping. HTTP is mocked at the global fetch boundary.
import {
  fetchRecentTransactions,
  getPayheroConfig,
  initiateStkPush,
  mapPayheroTransaction,
} from '../../src/services/payheroProvider';
import { env } from '../../src/config/env';
const original = {
  username: env.payheroApiUsername,
  password: env.payheroApiPassword,
  channelId: env.payheroChannelId,
  baseUrl: env.payheroBaseUrl,
  timeoutMs: env.payheroTimeoutMs,
};

afterAll(() => {
  env.payheroApiUsername = original.username;
  env.payheroApiPassword = original.password;
  env.payheroChannelId = original.channelId;
  env.payheroBaseUrl = original.baseUrl;
  env.payheroTimeoutMs = original.timeoutMs;
});

function withCredentials(overrides: Partial<typeof original> = {}): void {
  env.payheroApiUsername = overrides.username ?? 'test-user';
  env.payheroApiPassword = overrides.password ?? 'test-pass';
  env.payheroChannelId = overrides.channelId ?? '42';
  env.payheroBaseUrl = overrides.baseUrl ?? '';
  env.payheroTimeoutMs = overrides.timeoutMs ?? 5000;
}

describe('getPayheroConfig', () => {
  it('reports unconfigured when credentials are missing', () => {
    env.payheroApiUsername = '';
    env.payheroApiPassword = '';
    const config = getPayheroConfig();
    expect(config.configured).toBe(false);
  });

  it('reports configured with credentials and applies defaults', () => {
    withCredentials();
    const config = getPayheroConfig();
    expect(config.configured).toBe(true);
    expect(config.baseUrl).toBe('https://backend.payhero.co.ke/api');
    expect(config.channelId).toBe('42');
  });
});

describe('mapPayheroTransaction', () => {
  it('normalizes a fully-populated record', () => {
    const mapped = mapPayheroTransaction({
      id: 98765,
      reference: ' Unit 12 ',
      amount: '4000',
      created_at: '2026-09-20T09:00:00Z',
      sender_phone: '+254711000003',
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.transactionId).toBe('98765');
    expect(mapped!.accountReference).toBe('Unit 12');
    expect(mapped!.amount).toBe(4000);
    expect(mapped!.phoneNumber).toBe('+254711000003');
    expect(mapped!.transactionDate.toISOString()).toBe('2026-09-20T09:00:00.000Z');
  });

  it('tolerates alternate field names (phone / msisdn / timestamp / data array shape)', () => {
    const mapped = mapPayheroTransaction({
      id: 'abc',
      reference: '1',
      amount: 2500,
      timestamp: '2026-09-20T10:30:00Z',
      msisdn: '0711000001',
    });
    expect(mapped?.phoneNumber).toBe('0711000001');
  });

  it('rejects unusable records: no id, no reference, non-positive amount, bad date', () => {
    expect(mapPayheroTransaction({ reference: '1', amount: 100 })).toBeNull();
    expect(mapPayheroTransaction({ id: 1, amount: 100 })).toBeNull();
    expect(mapPayheroTransaction({ id: 1, reference: '1', amount: 0 })).toBeNull();
    expect(mapPayheroTransaction({ id: 1, reference: '1', amount: -5 })).toBeNull();
    expect(mapPayheroTransaction({ id: 1, reference: '1', amount: 100, created_at: 'not-a-date' })).toBeNull();
  });
});

const originalFetch = global.fetch;

function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): void {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

afterAll(() => {
  global.fetch = originalFetch;
});

describe('fetchRecentTransactions', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends Basic auth and unwraps the documented { transactions: [...] } shape', async () => {
    withCredentials();
    const fetchMock = jest.fn((): Promise<Response> => Promise.resolve(new Response(
      JSON.stringify({ transactions: [{ id: 1, reference: '1', amount: 4000, created_at: '2026-09-20T09:00:00Z' }] }),
      { status: 200 }
    )));
    global.fetch = fetchMock as unknown as typeof fetch;

    const list = await fetchRecentTransactions(2);
    expect(list).toHaveLength(1);
    expect(list[0].transactionId).toBe('1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/transactions?page=2');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`
    );
  });

  it('tolerates a bare-array response and skips unmappable records', async () => {
    withCredentials();
    mockFetch(() => Promise.resolve(new Response(
      JSON.stringify([
        { id: 5, reference: '12', amount: 1000, created_at: '2026-09-20T09:00:00Z' },
        { reference: 'broken', amount: 5 }, // no id — skipped
      ]),
      { status: 200 }
    )));
    const list = await fetchRecentTransactions();
    expect(list).toHaveLength(1);
    expect(list[0].transactionId).toBe('5');
  });

  it('throws a readable error on HTTP failure', async () => {
    withCredentials();
    mockFetch(() => Promise.resolve(new Response(
      JSON.stringify({ message: 'unauthorized' }),
      { status: 401 }
    )));
    await expect(fetchRecentTransactions()).rejects.toThrow('PayHero request failed: unauthorized');
  });

  it('refuses to call the API when unconfigured', async () => {
    env.payheroApiUsername = '';
    env.payheroApiPassword = '';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(fetchRecentTransactions()).rejects.toThrow('PayHero is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('initiateStkPush', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts channel-based STK payloads with Basic auth', async () => {
    withCredentials({ channelId: '77' });
    const fetchMock = jest.fn((): Promise<Response> => Promise.resolve(new Response(
      JSON.stringify({ checkout_request_id: 'PH-CK-1', status: 'SUCCESS' }),
      { status: 200 }
    )));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await initiateStkPush({ phoneNumber: '+254711000001', amount: 4000, callbackUrl: 'https://x/cb' });
    expect(result.checkoutRequestId).toBe('PH-CK-1');
    expect(result.responseDescription).toBe('SUCCESS');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/mpesa/stk-push/');
    const body = JSON.parse(String(init.body));
    expect(body.channel_id).toBe('77');
    expect(body.phone_number).toBe('+254711000001');
    expect(body.callback_url).toBe('https://x/cb');
  });

  it('rejects non-positive amounts before any network call', async () => {
    withCredentials();
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(initiateStkPush({ phoneNumber: '+254711000001', amount: 0 })).rejects.toThrow('greater than zero');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
