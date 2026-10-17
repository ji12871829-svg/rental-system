// WhatsApp provider unit tests — pure classification, no database.
//  * config detection: live only when token + phone number id are both set
//  * recipient normalization (07… / 2547… → Meta wa_id digits)
//  * Graph API success envelope → wamid
//  * Meta error envelope classification: 131047 (24-hour window) and network
//    errors are transient; 131026 / 131030 / 132xxx (template registration)
//    are terminal
//  * template sends: payload shape, canonical parameter order, env config
//  * not-configured mode refuses before any network call
import {
  buildWhatsappTemplateParams,
  getWhatsappConfig,
  getWhatsappTemplates,
  normalizeWhatsAppNumber,
  sendCloudWhatsapp,
  WhatsAppDeliveryError,
} from '../../src/services/whatsappProvider';

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
    const result = await sendCloudWhatsapp('254712345678', 'Hello (test)', { fetchImpl: fake });
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
    const result = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => jsonResponse(200, { messaging_product: 'whatsapp' })) as unknown as typeof fetch });
    expect(result.wamid).toBeNull();
  });

  it('classifies the 24-hour window rejection (131047) as transient with actionable copy', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => jsonResponse(400, { error: { message: 'Re-engagement message', code: 131047, error_data: { details: 'More than 24 hours have passed since the customer last replied' } } })) as unknown as typeof fetch })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppDeliveryError);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(false);
    expect(derr.code).toBe(131047);
    expect(derr.message).toContain('24-hour');
    expect(derr.message).toContain('reply');
  });

  it('classifies "number not on WhatsApp" (131026) as terminal', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => jsonResponse(404, { error: { message: 'Recipient phone number not in whatsapp', code: 131026 } })) as unknown as typeof fetch })
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(true);
    expect(derr.code).toBe(131026);
    expect(derr.message).toContain('does not use WhatsApp');
  });

  it('classifies test-allowlist rejection (131030) as terminal with Meta setup copy', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => jsonResponse(400, { error: { message: 'Recipient phone number not in allowed list', code: 131030 } })) as unknown as typeof fetch })
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(true);
    expect(derr.code).toBe(131030);
    expect(derr.message).toContain('allowlist');
    expect(derr.message).toContain('Meta Business Manager');
  });

  it('classifies template refusals (132xxx) as terminal with registration copy', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', {
      fetchImpl: (async () => jsonResponse(400, { error: { message: 'Invalid parameter', code: 132000, error_data: { details: 'parameters size differ from template body' } } })) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(true);
    expect(derr.code).toBe(132000);
    expect(derr.message).toContain('template');
    expect(derr.message).toContain('{{1}}..{{6}}');
  });

  it('classifies token rejection (code 190) as non-terminal with a config hint', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => jsonResponse(401, { error: { message: 'Invalid OAuth access token', code: 190 } })) as unknown as typeof fetch })
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(false);
    expect(derr.message).toContain('WHATSAPP_TOKEN');
  });

  it('treats a network failure as transient', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => { throw new TypeError('failed to fetch'); }) as unknown as typeof fetch })
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.terminal).toBe(false);
    expect(derr.message).toContain('network error');
  });

  it('never throws raw non-JSON provider bodies through', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: (async () => ({ ok: false, status: 503, text: async () => 'upstream HTML' } as unknown as Response)) as unknown as typeof fetch })
      .catch((e: unknown) => e);
    const derr = err as WhatsAppDeliveryError;
    expect(derr.message).toContain('HTTP 503');
  });

  it('sends a template payload when a template is requested', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const fake = (async (url: unknown, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return jsonResponse(200, { messages: [{ id: 'wamid.HBgLTemplate' }] });
    }) as unknown as typeof fetch;
    const result = await sendCloudWhatsapp('254712345678', 'unused body text', {
      fetchImpl: fake,
      template: {
        name: 'rent_reminder',
        language: 'en',
        params: ['Moses Barasa', 'Unit 24', 'Rent for Oct 2026: KSh 55000 — total KSh 55000', '10 Nov 2026', 'M-Pesa to 0743799002', '0706719042'],
      },
    });
    expect(result.wamid).toBe('wamid.HBgLTemplate');
    const payload = JSON.parse(String(seen[0].init?.body)) as {
      type: string;
      to: string;
      text?: { body: string };
      template: { name: string; language: { code: string }; components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> };
    };
    expect(payload.type).toBe('template');
    expect(payload.to).toBe('254712345678');
    // The free-form body must NOT ride along on a template send.
    expect(payload.text).toBeUndefined();
    expect(payload.template.name).toBe('rent_reminder');
    expect(payload.template.language.code).toBe('en');
    const [bodyComp] = payload.template.components;
    expect(bodyComp.type).toBe('body');
    expect(bodyComp.parameters.map((p) => p.text)).toEqual([
      'Moses Barasa',
      'Unit 24',
      'Rent for Oct 2026: KSh 55000 — total KSh 55000',
      '10 Nov 2026',
      'M-Pesa to 0743799002',
      '0706719042',
    ]);
  });

  it('builds template parameters in the canonical order with the contact fallback', () => {
    const params = buildWhatsappTemplateParams({
      tenantName: 'Moses Barasa',
      unitLabel: 'Unit 24',
      duesText: 'Rent for Oct 2026: KSh 55000 — total KSh 55000',
      deadline: '10 Nov 2026',
      payMethod: 'M-Pesa to 0743799002',
      contactPhone: '0706719042',
    });
    expect(params).toEqual([
      'Moses Barasa',
      'Unit 24',
      'Rent for Oct 2026: KSh 55000 — total KSh 55000',
      '10 Nov 2026',
      'M-Pesa to 0743799002',
      '0706719042',
    ]);
    // No office contact on file → the Send Money digits inside the payment
    // method stand in, so the registered "Call the office on {{6}}" wording
    // still shows a real number.
    const fallback = buildWhatsappTemplateParams({
      tenantName: 'A',
      unitLabel: 'Unit 1',
      duesText: 'KSh 0',
      deadline: '10 Nov 2026',
      payMethod: 'M-Pesa to 0743799002',
      contactPhone: null,
    });
    expect(fallback[5]).toBe('0743799002');
  });

  it('reads template configuration from env at call time', () => {
    process.env.WHATSAPP_TEMPLATE_REMINDER = 'rent_reminder_v2';
    process.env.WHATSAPP_TEMPLATE_FINAL_NOTICE = '';
    process.env.WHATSAPP_TEMPLATE_LANG = 'en_GB';
    const templates = getWhatsappTemplates();
    expect(templates.reminder).toBe('rent_reminder_v2');
    expect(templates.finalNotice).toBeNull();
    expect(templates.language).toBe('en_GB');
    delete process.env.WHATSAPP_TEMPLATE_REMINDER;
    delete process.env.WHATSAPP_TEMPLATE_FINAL_NOTICE;
    delete process.env.WHATSAPP_TEMPLATE_LANG;
    const blank = getWhatsappTemplates();
    expect(blank.reminder).toBeNull();
    expect(blank.finalNotice).toBeNull();
    expect(blank.language).toBe('en');
  });
});

describe('sendCloudWhatsapp — not configured', () => {
  beforeAll(() => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  it('refuses before any network call', async () => {
    const err = await sendCloudWhatsapp('254712345678', 'x', { fetchImpl: noFetch as unknown as typeof fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhatsAppDeliveryError);
    expect((err as WhatsAppDeliveryError).message).toContain('not configured');
  });
});
