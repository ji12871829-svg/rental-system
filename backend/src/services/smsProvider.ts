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
  provider: 'mock' | 'africastalking' | 'twilio';
  live: boolean;
  senderId?: string;
  /** Receipt SMS are auto-sent when a payment is recorded (never in tests). */
  autoSend: boolean;
}

const AT_SMS_ENDPOINT = 'https://api.africastalking.com/version1/messaging';
const AT_USER_ENDPOINT = 'https://api.africastalking.com/version1/user';
const AT_TIMEOUT_MS = 15_000;
const TWILIO_TIMEOUT_MS = 15_000;

// Current mode, safe to expose to the UI — contains no secrets.
export function getSmsConfig(): SmsConfig {
  const provider: SmsConfig['provider'] =
    !isTest && (env.smsProvider === 'africastalking' || env.smsProvider === 'twilio')
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
          : false,
    senderId:
      provider === 'twilio'
        ? env.twilioFrom || env.twilioMessagingServiceSid || undefined
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
  return {
    ok: false,
    failureReason: recipient.statusDescription || recipient.status || 'Unknown provider error',
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

export async function sendSms(opts: { phoneNumber: string; message: string }): Promise<SendResult> {
  const { provider } = getSmsConfig();
  if (provider === 'mock') return mockSend();
  if (provider === 'twilio') return twilioSend(opts.phoneNumber, opts.message);
  return africasTalkingSend(opts.phoneNumber, opts.message);
}
