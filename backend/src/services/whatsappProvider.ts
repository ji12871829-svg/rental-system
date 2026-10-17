// WhatsApp Cloud API provider — the official Meta Graph API endpoint.
//
// This is the direct-delivery half of the WHATSAPP channel: the same channel
// that used to be click-to-chat only (a wa.me link the operator opened and
// pressed send on). When WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID are set
// in backend/.env, reminders and Final Notices go out programmatically
// instead — one POST per message to
//   {graph}/{version}/{PHONE_NUMBER_ID}/messages
// with a text payload; Meta replies with a wamid when it accepts the send.
//
// The credentials are read at call time (not cached into the env snapshot)
// so an operator can add them to .env and just restart-free redeploy the
// module: getWhatsappConfig() answers "is the channel connected right now"
// for the reminder flow, which must keep working in click-to-chat mode when
// they are absent.
//
// Failure classification mirrors the email channel's permanent-vs-transient
// split (isTerminalEmailFailure): a handful of Meta error codes mean "this
// recipient will never accept this message" (terminal → ERRONEOUS, no retry
// deadline); everything else — network hiccups, rate limits, token expiries,
// and the 24-hour customer-service window (131047) — is transient → FAILED
// with a backoff deadline, because circumstances can change (a tenant reply
// opens the window; an expired token gets replaced).

import { env } from '../config/env';

export interface WhatsappConfig {
  /** 'cloud' when live credentials are present, 'none' for click-to-chat mode. */
  provider: 'cloud' | 'none';
  /** True when direct Cloud API delivery will actually attempt a send. */
  live: boolean;
  apiVersion: string;
}

export function getWhatsappConfig(): WhatsappConfig {
  const token = process.env.WHATSAPP_TOKEN || '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const live = Boolean(token && phoneNumberId);
  return { provider: live ? 'cloud' : 'none', live, apiVersion: env.whatsappApiVersion };
}

// --- Approved template messaging -------------------------------------------------
//
// Free-form Cloud API sends are only deliverable inside Meta's 24-hour
// customer-service window. Approved TEMPLATE messages have no window — that
// is what Meta designed automated business sends around — and they render
// with whatever header/footer the operator baked into the template, which is
// also what makes them look official.
//
// The operator registers each template once in Meta Business Manager
// (category UTILITY, English) using the body text the app's docs give them,
// with EXACTLY these numbered placeholders in this order — the payload we
// send must match the registration:
//   {{1}} tenant name        "Moses Barasa"
//   {{2}} unit label         "Unit 24"
//   {{3}} dues breakdown     "Rent for Jun, Jul, Aug 2026: KSh 55000 — total KSh 55000"
//   {{4}} pay-by deadline    "10 Nov 2026"
//   {{5}} payment method     "M-Pesa to 0743799002" (Send Money line)
//   {{6}} office contact     "0706719042"
// One template per purpose: WHATSAPP_TEMPLATE_REMINDER (statement/overdue
// chase) and WHATSAPP_TEMPLATE_FINAL_NOTICE (the escalation letter). Either
// may be set alone — the other purpose then keeps free-form sending. When a
// template IS set for a kind it replaces free-form entirely.
export function buildWhatsappTemplateParams(input: {
  tenantName: string;
  unitLabel: string;
  duesText: string;
  deadline: string;
  payMethod: string;
  contactPhone: string | null;
}): string[] {
  // No configured office contact → fall back to the phone digits inside the
  // payment method (the Send Money line is also the office's line), else a
  // blank the operator's template wording should tolerate.
  const contact =
    input.contactPhone?.trim() || input.payMethod.match(/\d{9,}/)?.[0] || '';
  return [
    input.tenantName,
    input.unitLabel,
    input.duesText,
    input.deadline,
    input.payMethod,
    contact,
  ];
}

export interface WhatsappTemplates {
  /** Template for the statement/overdue chase (kinds BALANCE_DUE / OVERDUE). */
  reminder: string | null;
  /** Template for the Final Notice escalation letter. */
  finalNotice: string | null;
  /** Meta language code sent with the template (default 'en'). */
  language: string;
}

export function getWhatsappTemplates(): WhatsappTemplates {
  // Read at call time, like the credentials — operators add template names
  // (and the tests inject them per-suite) without touching cached state.
  const reminder = (process.env.WHATSAPP_TEMPLATE_REMINDER || '').trim() || null;
  const finalNotice = (process.env.WHATSAPP_TEMPLATE_FINAL_NOTICE || '').trim() || null;
  const language = (process.env.WHATSAPP_TEMPLATE_LANG || 'en').trim() || 'en';
  return { reminder, finalNotice, language };
}

// Meta's recipient is a WhatsApp ID: digits with country code (no +, no
// leading zero). Kenya numbers stored as 07… or 2547… both normalize here —
// the same rule wa.me click-to-chat used before direct delivery existed.
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
}

// Terminal Meta error codes: no amount of retrying will make the same
// recipient accept the same message unchanged.
//   131026  message undeliverable — the number is not registered on WhatsApp
//   131051  unsupported message type
//   131030  recipient not in the sandbox allowlist (test numbers may only
//           message up to five allowlisted recipients until verification)
//   132xxx  template payload refused — name/language/parameter count does not
//           match the registration; only fixing the registration or the
//           template env vars helps, so these are treated as terminal too.
const TERMINAL_WHATSAPP_CODES = new Set<number>([131026, 131051, 131030]);

function isTerminalWhatsappCode(code: number | null): boolean {
  if (code === null) return false;
  return TERMINAL_WHATSAPP_CODES.has(code) || (code >= 132000 && code <= 132999);
}

export class WhatsAppDeliveryError extends Error {
  /** Meta error code from the response envelope, when one was returned. */
  readonly code: number | null;
  /** True when the recipient/type itself is the problem (ERRONEOUS). */
  readonly terminal: boolean;
  readonly httpStatus: number;

  constructor(message: string, opts: { code?: number | null; terminal?: boolean; httpStatus?: number } = {}) {
    super(message);
    this.name = 'WhatsAppDeliveryError';
    this.code = opts.code ?? null;
    this.terminal = opts.terminal ?? false;
    this.httpStatus = opts.httpStatus ?? 0;
  }
}

export interface WhatsappSendResult {
  /** Meta's wamid (e.g. wamid.HBgL…) — null when the envelope carries none. */
  wamid: string | null;
}

interface GraphMessagePayload {
  messages?: Array<{ id?: string; message_status?: string }>;
}

interface GraphErrorPayload {
  error?: {
    message?: string;
    code?: number;
    error_data?: { details?: string };
  };
}

export interface WhatsappTemplateSend {
  /** Registered template name (WHAT'SAPP_TEMPLATE_* env value). */
  name: string;
  /** Meta language code, e.g. 'en'. */
  language: string;
  /** Body parameters in the canonical registration order ({{1}}..{{6}}). */
  params: string[];
}

// One send attempt. Injected fetch keeps the tests on a local mock instead of
// the network; production uses the global fetch. When `template` is given the
// payload becomes a template send (no 24-hour window) and `body` is ignored —
// it stays in the call signature because every caller already holds the
// free-form text and it documents what the tenant's figures actually are.
export async function sendCloudWhatsapp(
  to: string,
  body: string,
  opts: { fetchImpl?: typeof fetch; template?: WhatsappTemplateSend } = {},
): Promise<WhatsappSendResult> {
  const config = getWhatsappConfig();
  if (!config.live) {
    throw new WhatsAppDeliveryError(
      'WhatsApp Cloud API is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing).',
      { httpStatus: 0 },
    );
  }
  const token = process.env.WHATSAPP_TOKEN as string;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID as string;
  const url = `https://graph.facebook.com/${config.apiVersion}/${phoneNumberId}/messages`;
  const payload: Record<string, unknown> = opts.template
    ? {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: opts.template.name,
          language: { code: opts.template.language },
          components: [
            {
              type: 'body',
              // Meta only accepts non-empty text parameters; an empty string
              // in the middle would shift nothing but still reads as a gap,
              // so keep them as strings exactly as composed.
              parameters: opts.template.params.map((value) => ({ type: 'text', text: value })),
            },
          ],
        },
      }
    : {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body },
      };

  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new WhatsAppDeliveryError(`WhatsApp network error: ${(err as Error).message}`, { httpStatus: 0 });
  }

  // Parse before status checks so Meta's { error: … } envelope is available
  // for failures; some non-2xx replies are JSON, some are not.
  const raw = await res.text();
  let parsed: GraphMessagePayload & GraphErrorPayload = {};
  try {
    parsed = raw ? (JSON.parse(raw) as GraphMessagePayload & GraphErrorPayload) : {};
  } catch {
    // Non-JSON body — fall through with an empty envelope.
  }

  if (!res.ok) {
    const code = parsed.error?.code ?? null;
    const base = parsed.error?.message ?? `HTTP ${res.status}`;
    const details = parsed.error?.error_data?.details;
    throw new WhatsAppDeliveryError(describeWhatsAppFailure(code, base, details, res.status), {
      code,
      terminal: isTerminalWhatsappCode(code),
      httpStatus: res.status,
    });
  }

  const wamid = parsed.messages?.[0]?.id ?? null;
  return { wamid };
}

// Operator-facing failure copy. The 24-hour customer-service window deserves
// its own sentence: it is the failure operators will hit most (a tenant who
// has not messaged the business number recently), it is recoverable (their
// reply opens the window), and it is not obvious from Meta's raw text.
function describeWhatsAppFailure(code: number | null, base: string, details: string | undefined, httpStatus: number): string {
  if (code === 131047) {
    const extra = details ? ` Meta says: ${details}` : '';
    return (
      `Meta's 24-hour WhatsApp window is closed (code 131047). Meta only delivers an automated business ` +
      `message within 24 hours of the recipient's own last message — ask them to reply once on WhatsApp, ` +
      `then press Send again.${extra} Original error: ${base}`
    );
  }
  if (code === 131026) {
    return (
      `Meta refused the recipient (code 131026): this number does not use WhatsApp. ` +
      `Correct the phone number and send again, or deliver the message by SMS instead.`
    );
  }
  if (code === 131051) {
    return `Meta rejected the message type (code 131051). Original error: ${base}`;
  }
  if (code === 131030) {
    return (
      `Meta refused the recipient (code 131030): this number is not in your WhatsApp test allowlist. ` +
      `Add it under Meta Business Manager → WhatsApp → API Setup → “To” (up to five numbers until the ` +
      `business is verified), then send again.`
    );
  }
  if (code !== null && code >= 132000 && code <= 132999) {
    return (
      `Meta refused the template (code ${code}): the template name, language or body parameters do not ` +
      `match what was registered in Meta Business Manager. Check the registration uses exactly the six ` +
      `placeholders ({{1}}..{{6}}) in the documented order, then send again. Original error: ${base}`
    );
  }
  if (code === 190 || httpStatus === 401) {
    return `WhatsApp access token was rejected (code ${code ?? 190}) — check WHATSAPP_TOKEN in backend/.env. ${base}`;
  }
  const extra = details ? ` (${details})` : '';
  return `WhatsApp Cloud API error${code === null ? '' : ` (code ${code})`}${extra}: ${base}`;
}
