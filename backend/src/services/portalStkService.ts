// Tenant-initiated rent STK push via the PayHero collection channel.
//
// The tenant portal's Payments page gets a "Pay with M-Pesa" button: the
// tenant enters an amount (prefilled with their current rent balance) and we
// ask PayHero to push an STK prompt to the phone number on their tenant
// record. When the tenant enters their PIN, the money arrives as a NORMAL
// paybill collection, which the PayHero poller ingests into
// processPaybillPayment — the proven match → phone-fallback → arrears
// allocation → receipt → auto-SMS pipeline posts it exactly once. This
// service therefore ONLY initiates: it deliberately does not pre-create an
// mpesa_transactions row (a pre-created row plus the poller's insert would
// create a second identity for the same money — a double-posting surface).
//
// Configuration gate: when PayHero credentials are absent (dev, tests, pre-
// onboarding deploys) the endpoint returns 503 with a stable error code, and
// the frontend hides the card entirely (GET /api/portal/pay-rent/config).
import { normalizePhoneNumber } from './smsProvider';
import { getPayheroConfig, initiateStkPush } from './payheroProvider';
import { queryOne } from '../config/db';
import { env } from '../config/env';
import { conflict, HttpError, serviceUnavailable } from '../utils/httpError';
import { logAudit } from './auditService';

/** Stable error code the frontend uses to tailor the message. */
// Only used internally (and asserted by tests via the literal string), so
// not exported — knip would flag it as an unused export.
const PAYHERO_UNCONFIGURED_CODE = 'PAYHERO_UNCONFIGURED';

/**
 * STK availability for the logged-in tenant. `enabled` is false when PayHero
 * is unconfigured (POST returns 503; the card is hidden) or the tenant has no
 * usable phone number (card hidden with an explanation).
 */
export async function getPortalStkConfig(
  tenantId: number
): Promise<{ enabled: boolean; reason: string | null; targetPhone: string | null }> {
  const cfg = getPayheroConfig();
  if (!cfg.configured) {
    return { enabled: false, reason: 'M-Pesa STK Push is not available yet. Use the send-money details below.', targetPhone: null };
  }
  const tenant = await queryOne<{ phone_number: string | null }>(
    `SELECT phone_number FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const normalized = tenant?.phone_number ? normalizePhoneNumber(tenant.phone_number) : null;
  if (!normalized) {
    return { enabled: false, reason: 'Ask the office to add your M-Pesa phone number to your tenant record to pay by STK Push.', targetPhone: null };
  }
  return { enabled: true, reason: null, targetPhone: normalized };
}

/**
 * Initiate the push. Amount validation (positive, bounded) happens in the
 * route's zod schema; this is the money-path logic.
 */
export async function requestPortalStkPush(
  tenantId: number,
  amount: number,
  actorEmail: string
): Promise<{ checkoutRequestId: string; phone: string; expiresInSeconds: number; instructions: string }> {
  const cfg = getPayheroConfig();
  if (!cfg.configured) {
    throw serviceUnavailable(
      'M-Pesa STK Push is not available right now. Please use the send-money details below.',
      PAYHERO_UNCONFIGURED_CODE
    );
  }

  const tenant = await queryOne<{ phone_number: string | null; unit_number: string | null }>(
    `SELECT t.phone_number, u.unit_number
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.id = $1`,
    [tenantId]
  );
  if (!tenant) throw conflict('Tenancy not found.');
  const phone = tenant.phone_number ? normalizePhoneNumber(tenant.phone_number) : null;
  if (!phone) {
    throw conflict('Your tenant record has no M-Pesa phone number. Ask the office to add one to pay by STK Push.');
  }

  const unit = tenant.unit_number?.trim() || '';
  const externalReference = unit ? `RENT-${unit}` : 'RENT';
  let checkoutRequestId = '';
  try {
    const push = await initiateStkPush({
      phoneNumber: phone,
      amount,
      channelReference: cfg.channelId || undefined,
      externalReference,
      callbackUrl: env.payheroStkCallbackUrl || undefined,
    });
    checkoutRequestId = push.checkoutRequestId;
  } catch (err) {
    const detail = (err as Error).message.replace(/^PayHero request failed:\s*/, '');
    await logAudit({
      userId: null,
      action: 'PORTAL_STK_PUSH_FAILED',
      entity: 'tenants',
      entityId: tenantId,
      newValue: { actor: actorEmail, amount, phone, error: detail },
    });
    // Surface upstream failure as a clean 502 (not a 500): the provider is
    // temporarily unable to collect — the tenant should retry or fall back
    // to send-money, and the detail usually names the cause.
    throw new HttpError(502, 'STK_PUSH_FAILED', `The payment request failed: ${detail}. Please try again, or use the send-money details below.`);
  }

  await logAudit({
    userId: null,
    action: 'PORTAL_STK_PUSH_INITIATED',
    entity: 'tenants',
    entityId: tenantId,
    newValue: { actor: actorEmail, amount, phone, checkoutRequestId, externalReference },
  });

  return {
    checkoutRequestId,
    phone,
    expiresInSeconds: 60,
    instructions: `An M-Pesa request for the amount has been sent to ${phone}. Enter your PIN to complete the payment. Your rent balance updates automatically once M-Pesa confirms.`,
  };
}
