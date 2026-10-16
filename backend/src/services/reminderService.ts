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
  lateFeeNoticeMessage,
  monthlyBalanceDueMessage,
  overdueNoticeMessage,
  rentDueSoonMessage,
  waterBillingNoticeMessage,
  welcomeMessage,
  whatsappBalanceDueMessage,
  whatsappOverdueMessage,
} from '../utils/businessRules';
import { badRequest, notFound } from '../utils/httpError';
import { logAudit } from './auditService';
import { getBusinessIdentity, getPaybillInstructions } from './brandingService';
import { getSettings } from './settingsService';
import { composeRentStatementEmail } from '../utils/emailTemplates';
import { getCustomTemplate, type TemplateKind } from './templateService';
import { renderMergeFields, type MergeVars } from '../utils/mergeFields';
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
  unitId: number | null;
  unitNumber: string;
  /** Real UTC month (1-12) the figures were computed for. */
  month: number;
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
  // Latest meter reading for the unit (the row the current bill was computed
  // from) — feeds the proof clause on water notices. Null when the unit has
  // no readings (builders omit the clause rather than printing blanks).
  latestWaterReading: { previous: number; current: number } | null;
}

async function gatherReminderFigures(tenantId: number): Promise<ReminderFigures> {
  const tenant = await queryOne<{
    full_name: string;
    phone_number: string | null;
    email: string | null;
    unit_id: number | null;
    unit_number: string | null;
    move_in_date: string;
    move_out_date: string | null;
  }>(
    `SELECT t.full_name, t.phone_number, t.email, u.id AS unit_id, u.unit_number, t.move_in_date, t.move_out_date
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

  // Latest meter reading for the unit in the reporting year — the proof
  // behind the water-billing notice. Falls back to null (clause omitted)
  // when the unit has no readings.
  let latestWaterReading: { previous: number; current: number } | null = null;
  if (tenant.unit_id !== null) {
    const reading = await queryOne<{ previous_reading: string; current_reading: string }>(
      `SELECT previous_reading, current_reading FROM water_meter_readings
       WHERE unit_id = $1 AND billing_year = $2
       ORDER BY reading_date DESC, id DESC LIMIT 1`,
      [tenant.unit_id, year],
    );
    if (reading) {
      const prev = Number(reading.previous_reading);
      const curr = Number(reading.current_reading);
      if (Number.isFinite(prev) && Number.isFinite(curr)) latestWaterReading = { previous: prev, current: curr };
    }
  }

  return {
    tenantName: tenant.full_name,
    phoneNumber: tenant.phone_number,
    email: tenant.email,
    unitId: tenant.unit_id,
    unitNumber: tenant.unit_number ?? String(tenantId),
    month,
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
    latestWaterReading,
  };
}

export type ReminderKind = 'BALANCE_DUE' | 'OVERDUE' | 'DUE_SOON' | 'WATER_BILLING' | 'LATE_FEE' | 'WELCOME';
// The three notice kinds report an event rather than an amount owed, and are
// SMS-only: WhatsApp and email have no composition for them, so the route
// refuses the combination instead of silently falling back to a statement.
export const NOTICE_KINDS: ReadonlySet<ReminderKind> = new Set<ReminderKind>(['WATER_BILLING', 'LATE_FEE', 'WELCOME']);
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
  opts: { userId?: number | null; templateKind?: string | null } = {},
): Promise<ReminderResult | null> {
  const f = await gatherReminderFigures(tenantId);
  // The notice kinds are SMS-only — refuse the other channels rather than
  // silently sending a balance statement the operator did not ask for.
  if (NOTICE_KINDS.has(kind) && channel !== 'SMS') {
    throw badRequest('This notice is only available as an SMS.');
  }
  // A notice reports an event, so refuse to compose one that never happened.
  // The modal queues the row as soon as it opens, so without these a click on
  // "water billing" for a tenant with no water would queue (and, with
  // auto-send on, send) a notice announcing a charge of KSh 0.
  if (kind === 'WATER_BILLING' && f.waterBalance <= 0) {
    throw badRequest('This tenant has no water charge this month.');
  }
  if (kind === 'LATE_FEE' && f.rentBalance <= 0) {
    throw badRequest('This tenant has no overdue rent, so there is no late fee to report.');
  }
  // DUE_SOON is the scheduler's SMS-only nudge; the manual channels treat it
  // as the neutral BALANCE_DUE statement rather than mislabeling it.
  const channelKind: ReminderKind = kind === 'DUE_SOON' ? 'BALANCE_DUE' : kind;
  if (channel === 'WHATSAPP') return whatsappReminder(f, channelKind, tenantId, opts.userId ?? null);
  if (channel === 'EMAIL') return emailReminder(f, channelKind, tenantId, opts.userId ?? null);
  // SMS (default) — keeps the real kind so SMS_RENT_DUE_SOON can override,
  // and tags the row (templateKind) so the scheduler can dedupe its batches.
  return smsReminder(f, kind, tenantId, opts.userId ?? null, opts.templateKind ?? null);
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
  templateKind: string | null = null,
): Promise<ReminderResult | null> {
  if (!f.phoneNumber) return null;
  // A customized Message Templates row overrides the hardcoded wording for
  // every kind; merge fields resolve per tenant from the same figures.
  const templateKindName: TemplateKind = TEMPLATE_KIND_BY_REMINDER[kind];
  const custom = await getCustomTemplate(templateKindName);
  // DUE_SOON speaks about NEXT month (it is sent on the last day of this one).
  const nextMonth = f.month === 12 ? 1 : f.month + 1;
  const nextYear = f.month === 12 ? f.year + 1 : f.year;
  const baseVars = {
    name: f.tenantName,
    unit: f.unitNumber,
    month: f.monthName,
    year: f.year,
    currency: f.currency,
    business: f.identityName ?? '',
  };
  const message = custom
    ? renderMergeFields(custom.body, mergeVarsFor(kind, f, baseVars, nextMonth))
    : fallbackSmsMessage(kind, f, nextMonth, nextYear);
  const smsId = await queueSms({ tenantId, phoneNumber: f.phoneNumber, message, templateKind });
  await logAudit({
    userId,
    action: 'SMS_REMINDER_QUEUED',
    entity: 'tenant',
    entityId: tenantId,
    newValue: { kind, smsId },
  });
  return { message, smsId, emailId: null, whatsappUrl: null };
}

// Reminder kind -> the Message Templates kind whose customization overrides
// it. A map rather than a chain of ternaries on purpose: adding a kind here
// is what wires up both the override and the fallback, so a new notice cannot
// be half-registered and silently fall through to another kind's wording.
const TEMPLATE_KIND_BY_REMINDER: Record<ReminderKind, TemplateKind> = {
  BALANCE_DUE: 'SMS_BALANCE_DUE',
  DUE_SOON: 'SMS_RENT_DUE_SOON',
  OVERDUE: 'SMS_OVERDUE',
  WATER_BILLING: 'SMS_WATER_BILLING',
  LATE_FEE: 'SMS_LATE_FEE',
  WELCOME: 'SMS_WELCOME',
};

// Merge fields for a customized template — exactly the fields the Message
// Templates editor offers for that kind, resolved from the live ledger.
function mergeVarsFor(kind: ReminderKind, f: ReminderFigures, baseVars: MergeVars, nextMonth: number): MergeVars {
  switch (kind) {
    case 'BALANCE_DUE':
      return { ...baseVars, total_due: Math.max(f.combinedBalance, 0), account: f.accountNumber, payment_method: f.paymentMethod };
    case 'DUE_SOON':
      return { ...baseVars, next_month: MONTH_NAMES[nextMonth - 1], amount: Math.max(f.currentRent, 0), payment_method: f.paymentMethod };
    case 'WATER_BILLING': {
      const prev = f.latestWaterReading?.previous ?? null;
      const curr = f.latestWaterReading?.current ?? null;
      return {
        ...baseVars,
        amount: Math.max(f.waterBalance, 0),
        payment_method: f.paymentMethod,
        previous_reading: prev,
        current_reading: curr,
        units_used: prev !== null && curr !== null ? Math.round((curr - prev) * 100) / 100 : null,
      };
    }
    case 'LATE_FEE':
      return { ...baseVars, amount_due: Math.max(f.rentBalance, 0) };
    case 'WELCOME':
      return { ...baseVars, amount: Math.max(f.currentRent, 0), payment_method: f.paymentMethod };
    case 'OVERDUE':
    default:
      return { ...baseVars, amount_due: Math.max(f.rentBalance, 0), total_due: Math.max(f.combinedBalance, 0) };
  }
}

// The hardcoded builders, used when nobody has customized that kind — same six
// kinds as above, so an untouched install sends exactly the default wording.
function fallbackSmsMessage(kind: ReminderKind, f: ReminderFigures, nextMonth: number, nextYear: number): string {
  const identity = f.identityName ?? undefined;
  switch (kind) {
    case 'BALANCE_DUE':
      return monthlyBalanceDueMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, monthName: f.monthName, year: f.year,
        totalDue: Math.max(f.combinedBalance, 0), accountNumber: f.accountNumber,
        paymentMethod: f.paymentMethod, currency: f.currency, businessIdentity: identity,
      });
    case 'DUE_SOON':
      return rentDueSoonMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, nextMonthName: MONTH_NAMES[nextMonth - 1], year: nextYear,
        rentAmount: Math.max(f.currentRent, 0), paymentMethod: f.paymentMethod, currency: f.currency, businessIdentity: identity,
      });
    case 'WATER_BILLING':
      return waterBillingNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, monthName: f.monthName, year: f.year,
        amount: Math.max(f.waterBalance, 0), paymentMethod: f.paymentMethod, currency: f.currency,
        previousReading: f.latestWaterReading?.previous ?? null,
        currentReading: f.latestWaterReading?.current ?? null,
        businessIdentity: identity,
      });
    case 'LATE_FEE':
      return lateFeeNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, amountDue: Math.max(f.rentBalance, 0),
        currency: f.currency, businessIdentity: identity,
      });
    case 'WELCOME':
      return welcomeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, rentAmount: Math.max(f.currentRent, 0),
        paymentMethod: f.paymentMethod, currency: f.currency, businessIdentity: identity,
      });
    case 'OVERDUE':
    default:
      return overdueNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, amountDue: Math.max(f.rentBalance, 0),
        totalBalance: Math.max(f.combinedBalance, 0), currency: f.currency, businessIdentity: identity,
      });
  }
}
