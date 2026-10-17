// WhatsApp provider unit tests — pure classification, no database.
//  * config detection: live only when token + phone number id are both set
//  * recipient normalization (07… / 2547… → Meta wa_id digits)
//  * Graph API success envelope → wamid
//  * Meta error envelope classification: 131047 (24-hour window) and network
//    errors are transient; 131026 is terminal
//  * not-configured mode refuses before any network call
import { getWhatsappConfig, normalizeWhatsAppNumber, sendCloudWhatsapp, WhatsAppDeliveryError } from '../../src/services/whatsappProvider';

const SAVED_ENV = { token: process.env.WHATSAPP_TOKEN, phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const noFetch = async () => { throw new Error('network must not be reached in this test'); };

afterAll(() => {
  process.env.WHATSAPP_TOKEN = SAVED_ENV.token;
  process.env.WHATSAPP_PHONE_NUMBER_ID = SAVED_ENV.phoneId;
});

describe('getWhatsappConfig', () => {
  it('reports live only when both credentials are present', () => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    expect(getWhatsappConfig().live).toBe(false);
    expect(getWhatsappConfig().provider).toBe('none');

    process.env.WHATSAPP_TOKEN = 'tok';
    expect(getWhatsappConfig().live).toBe(false);

    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
    expect(getWhatsappConfig().live).toBe(true);
    expect(getWhatsappConfig().provider).toBe('cloud');
  });
});

describe('normalizeWhatsAppNumber', () => {
  it('strips to digits and upgrades Kenya leading-zero numbers', () => {
    expect(normalizeWhatsAppNumber('0712 345 678')).toBe('254712345678');
    expect(normalizeWhatsAppNumber('+254712345678')).toBe('254712345678');
    expect(normalizeWhatsAppNumber('254712345678')).toBe('254712345678');
    expect(normalizeWhatsAppNumber('')).toBeNull();
    expect(normalizeWhatsAppNumber(null)).toBeNull();
  });
});

describe('sendCloudWhatsapp — configured', () => {
  beforeAll(() => {
    process.env.WHATSAPP_TOKEN = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';
  });

  it('returns the Meta wamid from a success envelope', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fake = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return jsonResponse(200, { messaging_product: 'whatsapp', contacts: [], messages: [{ id: 'wamid.HBgLTest', message_status: 'accepted' }] });
    }) as unknown as typeof fetch;
    const result = await sendCloudWhatsapp('254712345678', 'Hello (test)', fake);
    expect(result.wamid).toBe('wamid.HBgLTest');
    const reqUrl = seen[0].url;
    expect(reqUrl).toMatch(/graph\.facebook\.com\/v\d[\d.]*\/123456789012345\/messages$/);
    const payload = JSON.parse(String(seen[0].init?.body)) as { messaging_product: string; to: string; type: string; text: { body: string } };
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.to).toBe('254712345678');
    expect(payload.type).toBe('text');
    expect(payload.text.body).toBe('Hello (test)');
  });

  it('passes through a Meta 2xx envelope with no messages entry (delivery is just nil-accepted)', async () => {
    const result = await sendCloudWhatsapp('254712345678', 'x', (async () => jsonResponse(200, { messaging_product: 'whatsapp' })) as unknown as typeof fetch);
    expect(result.wamid).toBeNull();
  });

  it('classifies the 24-hour window rejection (131047) as transient with actionable copy', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', (async () => jsonResponse(400, { error: { message: 'Re-engagement message', code: 131047, error_data: { details: 'More than 24 hours have passed since the customer last replied' } } })) as unknown as typeof fetch)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppDeliveryError);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(false);
    expect(derr.code).toBe(131047);
    expect(derr.message).toContain('24-hour');
    expect(derr.message).toContain('reply');
  });

  it('classifies "number not on WhatsApp" (131026) as terminal', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', (async () => jsonResponse(404, { error: { message: 'Recipient phone number not in whatsapp', code: 131026 } })) as unknown as typeof fetch)
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(true);
    expect(derr.code).toBe(131026);
    expect(derr.message).toContain('does not use WhatsApp');
  });

  it('classifies token rejection (code 190) as non-terminal with a config hint', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', (async () => jsonResponse(401, { error: { message: 'Invalid OAuth access token', code: 190 } })) as unknown as typeof fetch)
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(false);
    expect(derr.message).toContain('WHATSAPP_TOKEN');
  });

  it('treats a network failure as transient', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', (async () => { throw new TypeError('failed to fetch'); }) as unknown as typeof fetch)
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(false);
    expect(derr.message).toContain('network error');
  });

  it('never throws raw non-JSON provider bodies through', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', (async () => ({ ok: false, status: 503, text: async () => 'upstream HTML' } as unknown as Response)) as unknown as typeof fetch)
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.message).toContain('HTTP 503');
  });
});

describe('sendCloudWhatsapp — not configured', () => {
  beforeAll(() => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it('refuses before any network call', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', noFetch as unknown as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppDeliveryError);
    expect((err as WhatsAppDeliveryError).message).toContain('not configured');
  });
});
