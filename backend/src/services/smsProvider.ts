// SMS provider abstraction. This is the ONLY file that knows about a real
// provider (spec §34/§41: credentials live in env vars — never in code or DB).
//
// Selection is env-driven via backend/.env:
//   SMS_PROVIDER=mock            (default) simulated send — no network call,
//                                message recorded with a MOCK-<id> reference
//   SMS_PROVIDER=africastalking  real delivery via Africa's Talking (Kenya)
//   SMS_USERNAME / SMS_API_KEY   Africa's Talking account credentials
//   SMS_SENDER_ID                optional registered sender ID (e.g. "RPMS")
//   SMS_PROVIDER=twilio          real delivery via Twilio (global)
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN   Twilio credentials
//   TWILIO_FROM                  verified number (E.164) OR
//   TWILIO_MESSAGING_SERVICE_SID an alphanumeric sender via a Messaging
//                                Service (recommended — number pooling)
//   SMS_PROVIDER=textbee         own-SIM delivery via textbee — an Android
//                                phone with a local SIM relays the API call.
//                                No sender ID to buy: the SMS leaves as a
//                                normal text from that SIM, so the only cost
//                                is the carrier bundle (Safaricom sells ~1,000
//                                SMS for KES 30/week). Kenya's Safaricom does
//                                not accept unregistered alphanumeric sender
//                                IDs, which is what makes this route — rather
//                                than an unbranded Africa's Talking send — the
//                                genuinely cheap option.
//   TEXTBEE_API_KEY              generated in the textbee dashboard
//   TEXTBEE_API_URL              default https://api.textbee.dev/api/v1;
//                                point at your own host when self-hosting
//   TEXTBEE_DEVICE_ID            optional — pin which registered phone sends
//
// Safety nets:
//   - NODE_ENV=test forces the mock provider so test runs can never spend
//     money or text real numbers, even if credentials are present.
//   - A live provider with missing credentials records a FAILED row with a
//     clear reason instead of crashing or silently pretending success.
import { env, isTest } from '../config/env';

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  failureReason?: string;
  /** Provider-reported delivery cost, when the provider returns one. */
  cost?: { amount: number; currency: string };
}

export interface SmsConfig {
  provider: 'mock' | 'africastalking' | 'twilio' | 'textbee';
  live: boolean;
  senderId?: string;
  /** Receipt SMS are auto-sent when a payment is recorded (never in tests). */
  autoSend: boolean;
}

const AT_SMS_ENDPOINT = 'https://api.africastalking.com/version1/messaging';
const AT_USER_ENDPOINT = 'https://api.africastalking.com/version1/user';
const AT_TIMEOUT_MS = 15_000;
const TWILIO_TIMEOUT_MS = 15_000;
// textbee merely queues the send and returns — the phone dispatches
// asynchronously — so this timeout only bounds the API round-trip, not
// delivery. It stays generous because a self-hosted instance may be remote.
const TEXTBEE_TIMEOUT_MS = 15_000;

// Current mode, safe to expose to the UI — contains no secrets.
export function getSmsConfig(): SmsConfig {
  const provider: SmsConfig['provider'] =
    !isTest &&
    (env.smsProvider === 'africastalking' || env.smsProvider === 'twilio' || env.smsProvider === 'textbee')
      ? env.smsProvider
      : 'mock';
  const twilioReady =
    Boolean(env.twilioAccountSid && env.twilioAuthToken) &&
    Boolean(env.twilioFrom || env.twilioMessagingServiceSid);
  return {
    provider,
    live:
      provider === 'africastalking'
        ? Boolean(env.smsApiKey && env.smsUsername)
        : provider === 'twilio'
          ? twilioReady
          : // textbee needs only its API key — the "sender" is the SIM in the
            // phone, so unlike AT/Twilio there is no sender identity to verify.
            provider === 'textbee'
            ? Boolean(env.textbeeApiKey)
            : false,
    // No senderId for textbee by design: messages carry the SIM's own number,
    // which the backend does not know and cannot set.
    senderId:
      provider === 'twilio'
        ? env.twilioFrom || env.twilioMessagingServiceSid || undefined
        : provider === 'textbee'
          ? undefined
          : env.smsSenderId || undefined,
    autoSend: !isTest && env.smsAutoSend,
  };
}

/**
 * Normalize a Kenyan phone number to E.164 (+254XXXXXXXXX), the format
 * Africa's Talking expects. Accepts the common local spellings:
 *   +254 711 000 002 | 254711000002 | 0711000002 | 711000002 | 00254711000002
 * Returns null when the input cannot be interpreted as a number.
 */
export function normalizePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  if (!digits) return null;

  if (digits.startsWith('+')) {
    return /^\+\d{8,15}$/.test(digits) ? digits : null;
  }
  if (digits.startsWith('00254')) return `+254${digits.slice(5)}`;
  if (digits.startsWith('254')) return `+${digits}`;
  if (/^0(7|1)\d{8}$/.test(digits)) return `+254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `+254${digits}`;
  return null;
}

// --- Mock (simulated) provider ----------------------------------------------

function mockSend(): SendResult {
  return { ok: true, providerMessageId: `MOCK-${Date.now()}` };
}

// --- Africa's Talking -------------------------------------------------------

interface AtRecipient {
  statusCode?: number;
  status?: string;
  statusDescription?: string;
  messageId?: string;
  /** e.g. "KES 1.20" — per-recipient charge as reported by the provider. */
  cost?: string;
}

/**
 * Parse a provider cost string like "KES 1.20" into { amount, currency }.
 * Returns undefined for anything unparseable — cost reporting must never
 * turn into a send failure.
 */
export function parseProviderCost(raw: string | undefined): { amount: number; currency: string } | undefined {
  if (!raw) return undefined;
  const m = /^\s*([A-Za-z]{2,5})\s*([\d,]+(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return undefined;
 const amount = Number(m[2].replace(/,/g, ''));
  if (!isFinite(amount)) return undefined;
  return { currency: m[1].toUpperCase(), amount };
}

export interface ProviderBalance {
  amount: number;
  currency: string;
}

export type BalanceStatus =
  | { state: 'unknown'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'ok' | 'low' | 'empty'; balance: ProviderBalance; threshold: number | null };

/**
 * Pure threshold logic so the UI copy is decided once, testably:
 *   empty — at or below zero (or the configured threshold dragged it there)
 *   low   — above zero but at/below the configured threshold
 *   ok    — above the threshold (or no threshold configured)
 */
export function evaluateBalance(balance: ProviderBalance, threshold: number | null): BalanceStatus {
  if (threshold !== null && balance.amount <= 0) return { state: 'empty', balance, threshold };
  if (threshold !== null && balance.amount <= threshold) return { state: 'low', balance, threshold };
  return { state: 'ok', balance, threshold };
}

interface AtResponse {
  SMSMessageData?: { Recipients?: AtRecipient[] };
  message?: string;
}

function parseAtRecipient(body: AtResponse): SendResult {
  const recipient = body?.SMSMessageData?.Recipients?.[0];
  if (!recipient) {
    return { ok: false, failureReason: body?.message ?? 'Provider returned no recipients.' };
  }
  const success = recipient.statusCode === 101 || recipient.status === 'Success';
  if (success) {
    return {
      ok: true,
      providerMessageId: recipient.messageId ?? 'unknown',
      cost: parseProviderCost(recipient.cost),
    };
  }
  // Africa's Talking relays Safaricom network-level blocks as 201 — the
  // fetch succeeds, so the app must read the status string to classify the
  // real outcome. DND / self-OTPs / closed accounts all surface here.
  const isDnd = recipient.status === 'UserInBlacklist';
  return {
    ok: false,
    failureReason:
      isDnd
        ? 'SMS blocked by the recipient (Safaricom DND) — the recipient dialled the opt-out; delivery is not possible until they reactivate. Cost 0.'
        : recipient.statusDescription || recipient.status || 'Unknown provider error',
  };
}

// --- Delivery reports (Africa's Talking callback payloads) ---------------------

/** One recipient entry of a delivery-report callback — mirrors the send
 * response's Recipients shape, with delivery-specific fields added. */
export interface AtDeliveryReport {
  phoneNumber?: string;
  /** The gateway message id this report refers to (our join key). */
  messageId?: string;
  /** "Success" = delivered to handset; anything else is a network failure. */
  status?: string;
  /** Numeric status code (e.g. 101 = Success / delivered). */
  statusCode?: number;
  /** Operator network code (e.g. "63902" = Safaricom KE). */
  networkCode?: string;
  /** How many times the operator retried before reporting. */
  retryCount?: number | string;
  /** "None" while pending; failure identifiers otherwise. */
  failureReason?: string;
}

export type DeliveryOutcome = 'DELIVERED' | 'FAILED_ON_NETWORK';

/**
 * Map an Africa's Talking delivery-report entry to our outcome.
 *   DELIVERED        — statusCode 101 or status "Success" (handset confirmed)
 *   FAILED_ON_NETWORK — a terminal failure (Operator Rejected, Invalid Number,
 *                      Insufficient Funds, …)
 *   null             — undecided: no status at all, or a TRANSIENT state
 *                      (100 User In Buffer Mode / 104 User Absent — the
 *                      handset is temporarily unreachable and a final report
 *                      will follow; treating those as failure would break the
 *                      first-report-wins rule below)
 */
const TRANSIENT_AT_CODES = new Set([100, 104]);

export function parseAtDeliveryOutcome(report: AtDeliveryReport): DeliveryOutcome | null {
  const delivered = report.statusCode === 101 || report.status === 'Success';
  if (delivered) return 'DELIVERED';
  if (report.statusCode !== undefined && TRANSIENT_AT_CODES.has(report.statusCode)) return null;
  if (report.status && /buffer|absent/i.test(report.status)) return null;
  if (!report.status && report.statusCode === undefined) return null;
  return 'FAILED_ON_NETWORK';
}

async function africasTalkingSend(phoneNumber: string, message: string): Promise<SendResult> {
  const { smsApiKey: apiKey, smsUsername: username, smsSenderId: senderId } = env;
  if (!apiKey || !username) {
    return {
      ok: false,
      failureReason: 'SMS_PROVIDER=africastalking but SMS_USERNAME / SMS_API_KEY are not set in backend/.env.',
    };
  }

  const to = normalizePhoneNumber(phoneNumber);
  if (!to) {
    return { ok: false, failureReason: `Invalid phone number: "${phoneNumber}"` };
  }

  // Africa's Talking requires the parameters in the form-urlencoded body —
  // not the query string — alongside the apiKey header.
  const form = new URLSearchParams({ username, to, message });
  if (senderId) form.set('from', senderId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AT_TIMEOUT_MS);
  try {
    const res = await fetch(AT_SMS_ENDPOINT, {
      method: 'POST',
      headers: {
        apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: controller.signal,
    });

    let body: AtResponse | undefined;
    try {
      body = (await res.json()) as AtResponse;
    } catch {
      // Non-JSON error body (HTML error page, empty 5xx body…)
    }
    if (!res.ok) {
      return { ok: false, failureReason: `Provider returned HTTP ${res.status}${body?.message ? `: ${body.message}` : ''}` };
    }
    return parseAtRecipient(body ?? {});
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, failureReason: `Provider request timed out after ${AT_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, failureReason: `Provider request failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

// --- Africa's Talking account balance -----------------------------------------

interface AtUserResponse {
  UserData?: { balance?: string };
  message?: string;
}

/**
 * Query the Africa's Talking wallet balance (GET /version1/user?username=…,
 * apiKey header — same credentials as sending). The response carries the
 * balance as a money string like "KES 1234.50", parsed by parseProviderCost.
 */
export async function africasTalkingBalance(): Promise<ProviderBalance> {
  const { smsApiKey: apiKey, smsUsername: username } = env;
  if (!apiKey || !username) {
    throw new Error('SMS_PROVIDER=africastalking but SMS_USERNAME / SMS_API_KEY are not set in backend/.env.');
  }

  const controller = new AbortController();
  const checkTimer = setTimeout(() => controller.abort(), AT_TIMEOUT_MS);
  try {
    const res = await fetch(`${AT_USER_ENDPOINT}?username=${encodeURIComponent(username)}`, {
      headers: { apiKey, Accept: 'application/json' },
      signal: controller.signal,
    });

    let body: AtUserResponse | undefined;
    try {
      body = (await res.json()) as AtUserResponse;
    } catch {
      // Non-JSON error body (HTML error page, empty 5xx body…)
    }
    if (!res.ok || !body?.UserData?.balance) {
      throw new Error(`Provider returned HTTP ${res.status}${body?.message ? `: ${body.message}` : ''}`);
    }
    const parsed = parseProviderCost(body.UserData.balance);
    if (!parsed) {
      throw new Error(`Unparseable balance from provider: "${body.UserData.balance}"`);
    }
    return parsed;
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Provider request timed out after ${AT_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`Provider request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(checkTimer);
  }
}

// --- Twilio -----------------------------------------------------------------

interface TwilioMessage {
  sid?: string;
  price?: string | null;
  price_unit?: string | null;
  status?: string;
  code?: number;
  message?: string;
}

function parseTwilioError(body: unknown, httpStatus: number): string {
  const b = body as TwilioMessage & { message?: string };
  if (b?.code && b?.message) return `Twilio error ${b.code}: ${b.message}`;
  if (b?.message) return b.message;
  return `Twilio returned HTTP ${httpStatus}`;
}

async function twilioSend(phoneNumber: string, message: string): Promise<SendResult> {
  const { twilioAccountSid: sid, twilioAuthToken: token, twilioFrom, twilioMessagingServiceSid } = env;
  if (!sid || !token || (!twilioFrom && !twilioMessagingServiceSid)) {
    return {
      ok: false,
      failureReason:
        'SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and a sender (TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID) are not set in backend/.env.',
    };
  }

  const to = normalizePhoneNumber(phoneNumber);
  if (!to) {
    return { ok: false, failureReason: `Invalid phone number: "${phoneNumber}"` };
  }

  const form = new URLSearchParams({ To: to, Body: message });
  if (twilioMessagingServiceSid) form.set('MessagingServiceSid', twilioMessagingServiceSid);
  else form.set('From', twilioFrom);

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: controller.signal,
    });

    let body: TwilioMessage | undefined;
    try {
      body = (await res.json()) as TwilioMessage;
    } catch {
      // Non-JSON error body (HTML error page, empty 5xx body…)
    }
    if (!res.ok || !body?.sid) {
      return { ok: false, failureReason: parseTwilioError(body ?? {}, res.status) };
    }
    return {
      ok: true,
      providerMessageId: body.sid,
      // price is populated on the message shortly after send; on immediate
      // accept it is often null — cost simply stays unrecorded until then.
      cost:
        body.price && body.price_unit
          ? { amount: Math.abs(Number(body.price)), currency: body.price_unit.toUpperCase() }
          : undefined,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, failureReason: `Provider request timed out after ${TWILIO_TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, failureReason: `Provider request failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

// --- textbee (own-SIM gateway) -----------------------------------------------

interface TextbeeResponse {
  /** Queued-accept shape: { success, message, smsBatchId, recipientCount }. */
  data?: {
    success?: boolean;
    message?: string;
    /** Mongo-style id of the accepted batch — our join key in history. */
    smsBatchId?: string;
    recipientCount?: number;
    /** Immediate-dispatch shape reports counts instead of an id. */
    successCount?: number;
    failureCount?: number;
  };
  message?: string;
}

/**
 * Map a textbee response to our SendResult. Kept pure so the three quirks that
 * matter are testable without a network:
 *   - 200 with data.success false is a REJECTED send, not an accepted one
 *     (textbee reports plan-limit and validation failures in the body).
 *   - 429 is the free tier's 50/day · 300/month quota (or burst limiter) —
 *     worded so the operator knows to retry later or upgrade, not to
 *     reconfigure credentials.
 *   - the immediate-dispatch response carries successCount/failureCount and
 *     no smsBatchId, so a partial failure must not be recorded as full success.
 */
export function parseTextbeeResponse(body: TextbeeResponse, httpStatus: number): SendResult {
  if (httpStatus === 429) {
    return {
      ok: false,
      failureReason:
        `textbee rate limit reached (HTTP 429): ${body.message ?? 'the free tier caps sends at 50/day and 300/month, and the phone may also throttle bursts'}. The send was not queued — retry later or upgrade the textbee plan.`,
    };
  }
  if (httpStatus === 401) {
    return {
      ok: false,
      failureReason: 'textbee rejected the API key (HTTP 401) — regenerate it in the textbee dashboard and update TEXTBEE_API_KEY.',
    };
  }
  if (httpStatus >= 400) {
    return { ok: false, failureReason: `textbee returned HTTP ${httpStatus}${body.message ? `: ${body.message}` : ''}` };
  }

  const data = body.data;
  if (!data) {
    return { ok: false, failureReason: 'textbee returned no data — the send was not queued.' };
  }
  // Immediate-dispatch shape: count the failures rather than trusting the status.
  if (typeof data.failureCount === 'number') {
    if (data.failureCount > 0 && !data.successCount) {
      return { ok: false, failureReason: `textbee reported ${data.failureCount} recipient(s) failed to send.` };
    }
    return {
      ok: true,
      providerMessageId: data.smsBatchId ?? `TEXTBEE-${Date.now()}`,
    };
  }
  if (data.success === false) {
    return { ok: false, failureReason: data.message ?? 'textbee rejected the send (data.success=false).' };
  }
  return {
    ok: true,
    providerMessageId: data.smsBatchId ?? 'unknown',
  };
}

async function textbeeSend(phoneNumber: string, message: string): Promise<SendResult> {
  const { textbeeApiKey: apiKey, textbeeApiUrl, textbeeDeviceId: deviceId } = env;
  if (!apiKey) {
    return {
      ok: false,
      failureReason: 'SMS_PROVIDER=textbee but TEXTBEE_API_KEY is not set in backend/.env.',
    };
  }

  const to = normalizePhoneNumber(phoneNumber);
  if (!to) {
    return { ok: false, failureReason: `Invalid phone number: "${phoneNumber}"` };
  }

  // Strip trailing slashes here, not only in env.ts, so the endpoint can never
  // come out as "…/v1//gateway/send-sms" — a self-hosted TEXTBEE_API_URL pasted
  // with a trailing slash is the obvious way to hit that.
  const apiUrl = textbeeApiUrl.replace(/\/+$/, '');

  // textbee wants E.164 recipients and a message — no `from` field at all,
  // which is the whole point: the SIM in the phone is the sender.
  const payload: Record<string, unknown> = { recipients: [to], message };
  if (deviceId) payload.deviceId = deviceId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEXTBEE_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiUrl}/gateway/send-sms`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body: TextbeeResponse | undefined;
    try {
      body = (await res.json()) as TextbeeResponse;
    } catch {
      // Non-JSON error body (HTML error page, empty 5xx body…)
    }
    return parseTextbeeResponse(body ?? {}, res.status);
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, failureReason: `textbee request timed out after ${TEXTBEE_TIMEOUT_MS / 1000}s — is the phone online and the gateway app running?` };
    }
    return { ok: false, failureReason: `textbee request failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendSms(opts: { phoneNumber: string; message: string }): Promise<SendResult> {
  const { provider } = getSmsConfig();
  if (provider === 'mock') return mockSend();
  if (provider === 'twilio') return twilioSend(opts.phoneNumber, opts.message);
  if (provider === 'textbee') return textbeeSend(opts.phoneNumber, opts.message);
  return africasTalkingSend(opts.phoneNumber, opts.message);
}
