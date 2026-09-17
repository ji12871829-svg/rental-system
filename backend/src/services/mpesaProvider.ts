import { env, isTest } from '../config/env';
import { normalizePhoneNumber } from './smsProvider';

export interface MpesaPaymentInput {
  transactionId: string;
  amount: number;
  accountReference: string;
  transactionDate: Date;
  phoneNumber: string | null;
  rawPayload: unknown;
  checkoutRequestId?: string;
  merchantRequestId?: string;
}

export function parsePaybillReference(reference: string): { normalizedUnitNumber: string; kind: 'RENT' | 'WATER' } {
  const normalized = reference.trim().toUpperCase();
  if (!normalized) throw new Error('M-Pesa account reference is required.');
  if (normalized.endsWith('-WATER')) {
    const unit = normalized.slice(0, -'-WATER'.length).trim();
    if (!unit) throw new Error('M-Pesa water reference has no unit number.');
    return { normalizedUnitNumber: unit, kind: 'WATER' };
  }
  return { normalizedUnitNumber: normalized, kind: 'RENT' };
}

export interface MpesaConfig {
  provider: 'mock' | 'daraja';
  live: boolean;
  shortcode: string;
  callbackUrl: string;
}

export function getMpesaConfig(): MpesaConfig {
  const provider: MpesaConfig['provider'] = !isTest && env.mpesaProvider === 'daraja' ? 'daraja' : 'mock';
  return {
    provider,
    live: provider === 'daraja' && Boolean(
      env.mpesaConsumerKey && env.mpesaConsumerSecret && env.mpesaShortcode && env.mpesaPasskey && env.mpesaCallbackUrl
    ),
    shortcode: env.mpesaShortcode,
    callbackUrl: env.mpesaCallbackUrl,
  };
}

function requiredString(value: unknown, field: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !String(value).trim()) {
    throw new Error(`M-Pesa callback is missing ${field}.`);
  }
  return String(value).trim();
}

function positiveAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('M-Pesa callback amount must be greater than zero.');
  return amount;
}

function parseTransactionDate(value: unknown): Date {
  const raw = requiredString(value, 'transaction date');
  const iso = raw.length === 14
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+03:00`
    : raw;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error('M-Pesa callback has an invalid transaction date.');
  return date;
}

export function parseC2bCallback(payload: any): MpesaPaymentInput {
  return {
    transactionId: requiredString(payload?.TransID ?? payload?.TransactionID, 'transaction ID'),
    amount: positiveAmount(payload?.TransAmount ?? payload?.Amount),
    accountReference: requiredString(payload?.BillRefNumber ?? payload?.AccountReference, 'account reference'),
    transactionDate: parseTransactionDate(payload?.TransTime ?? payload?.TransactionDate),
    phoneNumber: normalizePhoneNumber(String(payload?.MSISDN ?? payload?.PhoneNumber ?? '')),
    rawPayload: payload,
  };
}

function callbackItems(payload: any): Map<string, unknown> {
  const items = payload?.Body?.stkCallback?.CallbackMetadata?.Item ?? [];
  return new Map(items.map((item: any) => [String(item.Name), item.Value]));
}

export function parseStkCallback(payload: any): {
  checkoutRequestId: string;
  merchantRequestId: string | null;
  resultCode: number;
  resultDescription: string;
  payment: MpesaPaymentInput | null;
} {
  const callback = payload?.Body?.stkCallback;
  const checkoutRequestId = requiredString(callback?.CheckoutRequestID, 'checkout request ID');
  const resultCode = Number(callback?.ResultCode);
  const resultDescription = String(callback?.ResultDesc ?? 'STK callback completed.');
  if (resultCode !== 0) {
    return { checkoutRequestId, merchantRequestId: callback?.MerchantRequestID ?? null, resultCode, resultDescription, payment: null };
  }
  const items = callbackItems(payload);
  const transactionId = requiredString(items.get('MpesaReceiptNumber'), 'M-Pesa receipt number');
  return {
    checkoutRequestId,
    merchantRequestId: callback?.MerchantRequestID ?? null,
    resultCode,
    resultDescription,
    payment: {
      transactionId,
      amount: positiveAmount(items.get('Amount')),
      accountReference: '',
      transactionDate: parseTransactionDate(items.get('TransactionDate')),
      phoneNumber: normalizePhoneNumber(String(items.get('PhoneNumber') ?? '')),
      checkoutRequestId,
      merchantRequestId: callback?.MerchantRequestID ?? undefined,
      rawPayload: payload,
    },
  };
}

async function fetchJson(url: string, options: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.mpesaTimeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`M-Pesa provider request failed (${response.status}).`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestStkPush(input: {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDescription: string;
}): Promise<{ checkoutRequestId: string; merchantRequestId?: string; responseDescription?: string }> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) throw new Error('Tenant phone number is not a valid Kenyan number.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('STK amount must be greater than zero.');
  const config = getMpesaConfig();
  if (config.provider === 'mock') {
    return { checkoutRequestId: `MOCK-CHECKOUT-${Date.now()}`, merchantRequestId: 'MOCK-MERCHANT', responseDescription: 'Mock STK request accepted.' };
  }
  if (!config.live) throw new Error('M-Pesa Daraja is not fully configured.');
  const tokenResponse = await fetchJson(`${env.mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${env.mpesaConsumerKey}:${env.mpesaConsumerSecret}`).toString('base64')}` },
  });
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const password = Buffer.from(`${env.mpesaShortcode}${env.mpesaPasskey}${timestamp}`).toString('base64');
  const response = await fetchJson(`${env.mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenResponse.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: env.mpesaShortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(input.amount),
      PartyA: phoneNumber.slice(1),
      PartyB: env.mpesaShortcode,
      PhoneNumber: phoneNumber.slice(1),
      CallBackURL: env.mpesaCallbackUrl,
      AccountReference: input.accountReference,
      TransactionDesc: input.transactionDescription,
    }),
  });
  return {
    checkoutRequestId: requiredString(response.CheckoutRequestID, 'checkout request ID'),
    merchantRequestId: response.MerchantRequestID,
    responseDescription: response.ResponseDescription,
  };
}
