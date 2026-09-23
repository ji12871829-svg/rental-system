// PayHero (payherokenya.com) adapter — the payment-collection layer for
// RPMS. PayHero fronts the property's M-Pesa paybill/till: tenants pay the
// same paybill they always have, and PayHero records every collection.
//
// This module is deliberately a *thin adapter*:
//  - fetchRecentTransactions() pulls the collections PayHero has received so
//    the poll job (payheroPollJob) can feed them into the existing
//    mpesa pipeline (match → post → receipt → auto-SMS).
//  - initiateStkPush() initiates a PayHero STK push (channel-based) —
//    replacing direct Daraja integration where PayHero is active.
//
// Auth is HTTP Basic with an API username/password created in the PayHero
// dashboard (API Keys). Everything is env-gated: with no credentials the
// adapter is inert and the rest of the system behaves exactly as before.
//
// Endpoint shapes follow the official client (PAY-HERO-KENYA/payhero-php):
//   GET  {base}/transactions                — account transactions
//   POST {base}/mpesa/stk-push/             — collection STK push
// If PayHero revises field names, only mapPayheroTransaction needs touching.

import { env } from '../config/env';

const DEFAULT_BASE_URL = 'https://backend.payhero.co.ke/api';

export interface PayheroConfig {
  configured: boolean;
  baseUrl: string;
  pollSeconds: number;
  channelId: string;
}

export function getPayheroConfig(): PayheroConfig {
  return {
    configured: Boolean(env.payheroApiUsername && env.payheroApiPassword),
    baseUrl: env.payheroBaseUrl || DEFAULT_BASE_URL,
    pollSeconds: env.payheroPollSeconds,
    channelId: env.payheroChannelId,
  };
}

/** Raw record shape we tolerate from the transactions endpoint. */
export interface RawPayheroTransaction {
  id?: number | string;
  reference?: string;
  amount?: number | string;
  created_at?: string;
  timestamp?: string;
  sender_phone?: string;
  phone?: string;
  msisdn?: string;
  [key: string]: unknown;
}

/** Normalized collection, ready for the mpesa pipeline. */
export interface NormalizedPayheroTransaction {
  transactionId: string;
  accountReference: string;
  amount: number;
  transactionDate: Date;
  phoneNumber: string;
  raw: RawPayheroTransaction;
}

/**
 * Map one raw PayHero record to the normalized shape. Returns null for
 * records that are not usable collections (no id/reference/amount) — the
 * poll job skips them loudly rather than guessing.
 */
export function mapPayheroTransaction(raw: RawPayheroTransaction): NormalizedPayheroTransaction | null {
  const transactionId = raw.id !== undefined && raw.id !== null ? String(raw.id) : '';
  if (!transactionId) return null;

  const accountReference = typeof raw.reference === 'string' ? raw.reference.trim() : '';
  if (!accountReference) return null;

  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const dateSource = raw.created_at ?? raw.timestamp;
  const transactionDate = dateSource ? new Date(dateSource) : new Date();
  if (Number.isNaN(transactionDate.getTime())) return null;

  const phoneNumber = typeof raw.sender_phone === 'string'
    ? raw.sender_phone
    : typeof raw.phone === 'string'
      ? raw.phone
      : typeof raw.msisdn === 'string'
        ? raw.msisdn
        : '';

  return { transactionId, accountReference, amount, transactionDate, phoneNumber, raw };
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${env.payheroApiUsername}:${env.payheroApiPassword}`).toString('base64')}`;
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.payheroTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!response.ok) {
      const detail = typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message?: unknown }).message)
        : `HTTP ${response.status}`;
      throw new Error(`PayHero request failed: ${detail}`);
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

interface PayheroTransactionsResponse {
  /** Documented shape: { transactions: [...] }; tolerate a bare array too. */
  transactions?: RawPayheroTransaction[];
  data?: RawPayheroTransaction[];
  results?: RawPayheroTransaction[];
}

/**
 * Fetch recent collections. `page` maps to PayHero's pagination (newest
 * first); callers pass an increasing page until they see records older than
 * the last poll.
 */
export async function fetchRecentTransactions(page = 1): Promise<NormalizedPayheroTransaction[]> {
  const config = getPayheroConfig();
  if (!config.configured) throw new Error('PayHero is not configured (PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD missing).');

  const body = await fetchJson<PayheroTransactionsResponse | RawPayheroTransaction[]>(
    `${config.baseUrl}/transactions?page=${page}`,
    { headers: { Authorization: authHeader(), Accept: 'application/json' } }
  );

  const list = Array.isArray(body)
    ? body
    : body.transactions ?? body.data ?? body.results ?? [];
  return list
    .map(mapPayheroTransaction)
    .filter((t): t is NormalizedPayheroTransaction => t !== null);
}

/**
 * Initiate a PayHero collection STK push. Mirrors the Daraja-flavoured
 * requestStkPush contract so callers can switch providers without caring.
 * Returns the provider's checkout id when available.
 */
export async function initiateStkPush(input: {
  phoneNumber: string;
  amount: number;
  channelReference?: string;
  externalReference?: string;
  callbackUrl?: string;
}): Promise<{ checkoutRequestId: string; merchantRequestId?: string; responseDescription?: string }> {
  const config = getPayheroConfig();
  if (!config.configured) throw new Error('PayHero is not configured (PAYHERO_API_USERNAME / PAYHERO_API_PASSWORD missing).');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('STK amount must be greater than zero.');

  const payload: Record<string, unknown> = {
    phone_number: input.phoneNumber,
    amount: input.amount,
    channel_id: input.channelReference ?? config.channelId,
  };
  if (input.externalReference) payload.external_reference = input.externalReference;
  if (input.callbackUrl) payload.callback_url = input.callbackUrl;

  const body = await fetchJson<{ checkout_request_id?: string; merchant_request_id?: string; response_description?: string; status?: string }>(
    `${config.baseUrl}/mpesa/stk-push/`,
    {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  return {
    checkoutRequestId: body.checkout_request_id ?? '',
    merchantRequestId: body.merchant_request_id,
    responseDescription: body.response_description ?? body.status,
  };
}
