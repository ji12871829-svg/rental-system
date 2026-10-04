// Tenant reminder module — the one home for "tell this tenant what they owe."
//
// Resolves the tenant's LIVE ledger figures once (Tenant Ledger module), then
// composes the chosen channel:
//   SMS      — PENDING sms_notifications row via smsService.queueSms
//   EMAIL    — PENDING email_notifications row via emailService.queuePreparedEmail
//   WHATSAPP — no queue, no send: a wa.me click-to-chat URL the operator
//              reviews and sends from WhatsApp itself (no provider, no cost)
// Each channel's wording can be overridden by a Message Templates row; merge
// fields resolve against the same figures. Before this module existed the
// flow lived in smsService and reached into emailService for the email twin —
// now both channel modules stay channel-only.

import { queryOne } from '../config/db';
import { MONTH_NAMES } from '../types';
import {
  monthlyBalanceDueMessage,
  overdueNoticeMessage,
  whatsappBalanceDueMessage,
  whatsappOverdueMessage,
} from '../utils/businessRules';
import { notFound } from '../utils/httpError';
import { logAudit } from './auditService';
import { getBusinessIdentity, getPaybillInstructions } from './brandingService';
import { getSettings } from './settingsService';
import { composeRentStatementEmail } from '../utils/emailTemplates';
import { getCustomTemplate } from './templateService';
import { renderMergeFields } from '../utils/mergeFields';
import { tenantBalances } from './tenantLedger';
import { queuePreparedEmail } from './emailService';
import { queueSms } from './smsService';

// The shared figures every reminder channel composes from. previousRent
// (YTD expected minus THIS month's expected) drives the statement's
// "Previous Balance" line; currentRent is this month's rent.
interface ReminderFigures {
  tenantName: string;
  phoneNumber: string | null;
  email: string | null;
  unitNumber: string;
  monthName: string;
  year: number;
  currency: string;
  currentRent: number;
  previousRentBalance: number;
  waterBalance: number;
  rentBalance: number;
  combinedBalance: number;
  paymentMethod: string;
  accountNumber: string;
  identityName: string | null;
}

async function gatherReminderFigures(tenantId: number): Promise<ReminderFigures> {
  const tenant = await queryOne<{
    full_name: string;
    phone_number: string | null;
    email: string | null;
    unit_number: string | null;
    move_in_date: string;
    move_out_date: string | null;
  }>(
    `SELECT t.full_name, t.phone_number, t.email, u.unit_number, t.move_in_date, t.move_out_date
     FROM tenants t
     LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.id = $1`,
    [tenantId],
  );
  if (!tenant) throw notFound('Tenant not found.');

  const settings = await getSettings();
  const year = settings.reporting_year;
  const month = new Date().getUTCMonth() + 1;
  const monthName = MONTH_NAMES[month - 1];

  // Ledger figures via the Tenant Ledger module — the single source the
  // tenant card, dashboard, ledger page and arrears view read, so a reminder
  // can never quote a balance the ledger disagrees with. (spec §46)
  const ledger = await tenantBalances(tenantId, year, month);
  const currentRent = ledger.currentRent;
  const rentBalance = ledger.rentBalance;
  const waterBalance = ledger.waterBalance;
  const combinedBalance = ledger.combinedBalance;
  // Previous balance = everything before this month: YTD expected minus this
  // month's rent, minus payments (floored at 0 — an overpaid tenant has no
  // "previous balance" to show).
  const previousRentBalance = ledger.previousRentBalance;

  const identity = await getBusinessIdentity();
  // Payment channel line: the reconciled paybill number when branding has
  // one, otherwise a generic instruction.
  const paybill = await getPaybillInstructions();
  const paymentMethod = paybill.enabled && paybill.number
    ? `M-Pesa PayBill ${paybill.number}`
    : 'M-Pesa or at the office';
  const accountNumber = `Unit ${tenant.unit_number ?? tenantId}`;

  return {
    tenantName: tenant.full_name,
    phoneNumber: tenant.phone_number,
    email: tenant.email,
    unitNumber: tenant.unit_number ?? String(tenantId),
    monthName,
    year,
    currency: settings.currency,
    currentRent,
    previousRentBalance,
    waterBalance,
    rentBalance,
    combinedBalance,
    paymentMethod,
    accountNumber,
    identityName: identity.name,
  };
}

export type ReminderKind = 'BALANCE_DUE' | 'OVERDUE';
export type ReminderChannel = 'SMS' | 'WHATSAPP' | 'EMAIL';
export interface ReminderResult {
  message: string;
  smsId: number | null;
  emailId: number | null;
  /** WhatsApp click-to-chat URL (wa.me) the operator opens — not queued. */
  whatsappUrl: string | null;
}

// Queue/compose a tenant reminder on the chosen channel. Each channel has
// its own helper below; this dispatcher resolves the shared figures once and
// delegates. Returns null (SMS/EMAIL) when the tenant lacks the channel's
// contact point.
export async function prepareReminder(
  tenantId: number,
  kind: ReminderKind,
  channel: ReminderChannel,
  opts: { userId?: number | null } = {},
): Promise<ReminderResult | null> {
  const f = await gatherReminderFigures(tenantId);
  if (channel === 'WHATSAPP') return whatsappReminder(f, kind, tenantId, opts.userId ?? null);
  if (channel === 'EMAIL') return emailReminder(f, kind, tenantId, opts.userId ?? null);
  // SMS (default)
  return smsReminder(f, kind, tenantId, opts.userId ?? null);
}

// WHATSAPP — nothing is queued or sent: returns a wa.me click-to-chat URL
// The exact "chat with support" sentence whatsappOverdueMessage appends,
// factored out so the customized WHATSAPP_OVERDUE template's {{support_link}}
// merge field expands to identical text.
function whatsappSupportLink(phone: string | null): string {
  return phone
    ? ` Click here to chat with support if you have any questions: https://wa.me/${phone.replace(/\D/g, '')}.`
    : '';
}

// with the text pre-filled. The operator reviews it in WhatsApp before
// pressing send; there is no provider cost and no unreviewed outbound.
async function whatsappReminder(
  f: ReminderFigures,
  kind: ReminderKind,
  tenantId: number,
  userId: number | null,
): Promise<ReminderResult | null> {
  // A customized Message Templates row (WHATSAPP_BALANCE_DUE /
  // WHATSAPP_OVERDUE) overrides the pre-filled wording. {{support_link}}
  // expands to the same "chat with support" sentence whatsappOverdueMessage
  // appends, or to nothing when no support phone is configured.
  const custom = await getCustomTemplate(kind === 'BALANCE_DUE' ? 'WHATSAPP_BALANCE_DUE' : 'WHATSAPP_OVERDUE');
  const text = custom
    ? renderMergeFields(
        custom.body,
        kind === 'BALANCE_DUE'
          ? {
              name: f.tenantName,
              unit: f.unitNumber,
              month: f.monthName,
              year: f.year,
              current_rent: f.currentRent,
              previous_balance: f.previousRentBalance,
              total_due: Math.max(f.combinedBalance, 0),
              account: f.accountNumber,
              payment_method: f.paymentMethod,
              currency: f.currency,
            }
          : {
              name: f.tenantName,
              unit: f.unitNumber,
              amount_due: Math.max(f.rentBalance, 0),
              support_link: whatsappSupportLink((await getBusinessIdentity()).phone),
              currency: f.currency,
            },
      )
    : kind === 'BALANCE_DUE'
    ? whatsappBalanceDueMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        monthName: f.monthName,
        year: f.year,
        currentRent: f.currentRent,
        previousBalance: f.previousRentBalance,
        totalDue: Math.max(f.combinedBalance, 0),
        accountNumber: f.accountNumber,
        paymentMethod: f.paymentMethod,
        currency: f.currency,
      })
    : whatsappOverdueMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        amountDue: Math.max(f.rentBalance, 0),
        supportPhone: (await getBusinessIdentity()).phone,
        currency: f.currency,
      });
  if (!f.phoneNumber) return null;
  const digits = f.phoneNumber.replace(/\D/g, '');
  // Kenya numbers stored as 07… normalize to 2547… for wa.me.
  const intl = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  await logAudit({
    userId,
    action: 'REMINDER_WHATSAPP_COMPOSED',
    entity: 'tenant',
    entityId: tenantId,
    newValue: { kind },
  });
  return { message: text, smsId: null, emailId: null, whatsappUrl: `https://wa.me/${intl}?text=${encodeURIComponent(text)}` };
}

// EMAIL — PENDING email_notifications row (formal statement breakdown).
async function emailReminder(
  f: ReminderFigures,
  kind: ReminderKind,
  tenantId: number,
  userId: number | null,
): Promise<ReminderResult | null> {
  if (!f.email) return null;
  const identity = { name: f.identityName, regNo: null };
  const composed = composeRentStatementEmail({
    tenantName: f.tenantName,
    unitNumber: f.unitNumber,
    monthName: f.monthName,
    year: f.year,
    previousBalance: f.previousRentBalance,
    currentRent: f.currentRent,
    utilitiesAmount: Math.max(f.waterBalance, 0),
    totalDue: Math.max(f.combinedBalance, 0),
    currency: f.currency,
    accountNumber: f.accountNumber,
    paymentMethod: f.paymentMethod,
    identity,
  });
  const emailRow = await queuePreparedEmail({
    to: f.email,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    tenantId,
  });
  await logAudit({
    userId,
    action: 'REMINDER_EMAIL_QUEUED',
    entity: 'tenant',
    entityId: tenantId,
    newValue: { kind, emailId: emailRow.id },
  });
  return { message: composed.text, smsId: null, emailId: emailRow.id, whatsappUrl: null };
}

// SMS — PENDING sms_notifications row (manual send or auto-send).
async function smsReminder(
  f: ReminderFigures,
  kind: ReminderKind,
  tenantId: number,
  userId: number | null,
): Promise<ReminderResult | null> {
  if (!f.phoneNumber) return null;
  // A customized Message Templates row (SMS_BALANCE_DUE / SMS_OVERDUE)
  // overrides the hardcoded wording; merge fields resolve per tenant.
  const custom = await getCustomTemplate(kind === 'BALANCE_DUE' ? 'SMS_BALANCE_DUE' : 'SMS_OVERDUE');
  const baseVars = {
    name: f.tenantName,
    unit: f.unitNumber,
    month: f.monthName,
    year: f.year,
    currency: f.currency,
    business: f.identityName ?? '',
  };
  const message = custom
    ? renderMergeFields(
        custom.body,
        kind === 'BALANCE_DUE'
          ? {
              ...baseVars,
              total_due: Math.max(f.combinedBalance, 0),
              account: f.accountNumber,
              payment_method: f.paymentMethod,
            }
          : {
              ...baseVars,
              amount_due: Math.max(f.rentBalance, 0),
              total_due: Math.max(f.combinedBalance, 0),
            },
      )
    : kind === 'BALANCE_DUE'
    ? monthlyBalanceDueMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        monthName: f.monthName,
        year: f.year,
        totalDue: Math.max(f.combinedBalance, 0),
        accountNumber: f.accountNumber,
        paymentMethod: f.paymentMethod,
        currency: f.currency,
        businessIdentity: f.identityName ?? undefined,
      })
    : overdueNoticeMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        amountDue: Math.max(f.rentBalance, 0),
        totalBalance: Math.max(f.combinedBalance, 0),
        currency: f.currency,
        businessIdentity: f.identityName ?? undefined,
      });
  const smsId = await queueSms({ tenantId, phoneNumber: f.phoneNumber, message });
  await logAudit({
    userId,
    action: 'SMS_REMINDER_QUEUED',
    entity: 'tenant',
    entityId: tenantId,
    newValue: { kind, smsId },
  });
  return { message, smsId, emailId: null, whatsappUrl: null };
}
