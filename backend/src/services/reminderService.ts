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

import { query, queryOne } from '../config/db';
import { toNumber } from '../utils/money';
import { MONTH_NAMES } from '../types';
import {
  formatArrearsSpan,
  lateFeeNoticeMessage,
  monthlyBalanceDueMessage,
  finalNoticeMessage,
  overdueNoticeMessage,
  paymentDeadlineLabel,
  rentDueSoonMessage,
  waterBillingNoticeMessage,
  welcomeMessage,
  whatsappBalanceDueMessage,
  whatsappOverdueMessage,
  whatsappPayLine,
} from '../utils/businessRules';
import { badRequest, notFound } from '../utils/httpError';
import { logAudit } from './auditService';
import { getBusinessIdentity, getPaybillInstructions } from './brandingService';
import { getSettings } from './settingsService';
import { composeRentStatementEmail } from '../utils/emailTemplates';
import { getCustomTemplate, type TemplateKind } from './templateService';
import { renderMergeFields, type MergeVars } from '../utils/mergeFields';
import { rentMonths, tenantBalances } from './tenantLedger';
import { queuePreparedEmail } from './emailService';
import { dispatchAutoSend, queueSms } from './smsService';

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
  /** Unpaid rent months as a compact label ("Oct 2026" / "Aug, Sep, Oct 2026"). */
  arrearsSpan: string;
  /** Unpaid water months as a compact label — falls back to the rent span
   *  when no water is owed, so templates always have a period to quote. */
  waterArrearsSpan: string;
  paymentMethod: string;
  accountNumber: string;
  identityName: string | null;
  /** Business contact phone for "already paid? call us" clauses — null when unset. */
  contactPhone: string | null;
  // Latest meter reading for the unit (the row the current bill was computed
  // from) — feeds the proof clause on water notices. Null when the unit has
  // no readings (builders omit the clause rather than printing blanks).
  latestWaterReading: { previous: number; current: number } | null;
}

export interface PaymentInstructions {
  /** Short method for {{payment_method}} — never carries the reference. */
  paymentMethod: string;
  /**
   * Unit account reference — EMPTY when none exists (Send Money has no
   * reference field). Every composer drops its reference clause on empty
   * rather than printing it blank.
   */
  accountNumber: string;
}

// Pure: which payment instruction tenants are told, from the operator's
// collection setup. PayBill with a unit reference when they collect that
// way; plain Send Money to the dedicated money line (falling back to the
// business contact phone) when they don't; otherwise a generic walk-in line
// that keeps the unit reference.
export function resolvePaymentInstructions(input: {
  paybillEnabled: boolean;
  paybillNumber: string | null;
  sendMoneyPhone: string | null;
  contactPhone: string | null;
  unitLabel: string;
}): PaymentInstructions {
  const unitAccount = `Unit ${input.unitLabel}`;
  if (input.paybillEnabled && input.paybillNumber) {
    return { paymentMethod: `M-Pesa PayBill ${input.paybillNumber}`, accountNumber: unitAccount };
  }
  const moneyPhone = input.sendMoneyPhone?.trim() || input.contactPhone?.trim() || '';
  if (moneyPhone) {
    return { paymentMethod: `M-Pesa to ${moneyPhone}`, accountNumber: '' };
  }
  return { paymentMethod: 'M-Pesa or at the office', accountNumber: unitAccount };
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

  // Unpaid rent months for the reminder's period label — which months the
  // tenant actually owes, not just the running total.
  const spine = await rentMonths(tenantId, year, month);
  const unpaidMonths = spine
    .filter((m) => m.inTenancy && m.expectedRent > m.rentPaid)
    .map((m) => m.month);
  const arrearsSpan = formatArrearsSpan(unpaidMonths, month, year);

  // Unpaid water months — the same span idea for the water notice. Water bills
  // come from meter readings (unit-scoped) and payments carry a billing month,
  // so the cumulative deficit after each month marks which months are still
  // unsettled. A tenant owing September and October readings reads
  // "(Sep, Oct 2026)" instead of naming the current month alone.
  let waterArrearsSpan = arrearsSpan;
  if (tenant.unit_id !== null && waterBalance > 0.009) {
    const rows = await query<{ month: number; billed: string; paid: string }>(
      `WITH b AS (
         SELECT billing_month AS m, SUM(water_bill) AS bill FROM water_meter_readings
         WHERE unit_id = $1 AND billing_year = $2 GROUP BY 1
       ), p AS (
         SELECT billing_month AS m, SUM(amount) AS paid FROM water_payments
         WHERE tenant_id = $1 AND billing_year = $2 GROUP BY 1
       )
       SELECT ms.m AS month, COALESCE(b.bill, 0) AS billed, COALESCE(p.paid, 0) AS paid
       FROM generate_series(1, $3::int) AS ms(m)
       LEFT JOIN b ON b.m = ms.m
       LEFT JOIN p ON p.m = ms.m
       ORDER BY ms.m`,
      [tenant.unit_id, year, month],
    );
    let deficit = 0;
    const unpaidWaterMonths: number[] = [];
    for (const r of rows) {
      deficit += toNumber(r.billed) - toNumber(r.paid);
      if (deficit > 0.009) unpaidWaterMonths.push(r.month);
    }
    waterArrearsSpan = formatArrearsSpan(unpaidWaterMonths, month, year);
  }

  const identity = await getBusinessIdentity();
  const paybill = await getPaybillInstructions();
  const { paymentMethod, accountNumber } = resolvePaymentInstructions({
    paybillEnabled: paybill.enabled,
    paybillNumber: paybill.number,
    sendMoneyPhone: identity.sendMoneyPhone,
    contactPhone: identity.phone,
    unitLabel: tenant.unit_number ?? String(tenantId),
  });

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
    arrearsSpan,
    waterArrearsSpan,
    paymentMethod,
    accountNumber,
    identityName: identity.name,
    contactPhone: identity.phone ?? null,
    latestWaterReading,
  };
}

export type ReminderKind = 'BALANCE_DUE' | 'OVERDUE' | 'FINAL_NOTICE' | 'DUE_SOON' | 'WATER_BILLING' | 'LATE_FEE' | 'WELCOME';// The three notice kinds report an event rather than an amount owed, and are
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
  // The Final Notice demands money, so like the notices it stays SMS-only —
  // and it is refused outright for a tenant whose ledger shows nothing (or a
  // net credit): there is no arrears to demand, let alone escalate about.
  if (kind === 'FINAL_NOTICE' && channel !== 'SMS') {
    throw badRequest('The Final Notice is only available as an SMS.');
  }
  if (kind === 'FINAL_NOTICE' && Math.max(f.combinedBalance, 0) <= 0.009) {
    throw badRequest('This tenant owes nothing on the ledger — there is no arrears for a Final Notice to demand.');
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
  // Same pay-by date the SMS chase quotes: the 10th, or next month's 10th
  // once the month's deadline has passed.
  const deadline = paymentDeadlineLabel(new Date());
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
              account: `Unit ${f.unitNumber}`,
              pay_line: whatsappPayLine(f.accountNumber, f.paymentMethod),
              payment_method: f.paymentMethod,
              currency: f.currency,
              deadline,
            }
          : {
              name: f.tenantName,
              unit: f.unitNumber,
              amount_due: Math.max(f.rentBalance, 0),
              support_link: whatsappSupportLink((await getBusinessIdentity()).phone),
              currency: f.currency,
              deadline,
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
        deadline,
      })
    : whatsappOverdueMessage({
        tenantName: f.tenantName,
        unitNumber: f.unitNumber,
        amountDue: Math.max(f.rentBalance, 0),
        supportPhone: (await getBusinessIdentity()).phone,
        currency: f.currency,
        deadline,
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
  // The pay-by date every chase quotes: "10 Oct 2026" on the 10th or earlier,
  // otherwise the next month's 10th — a reminder never names a past deadline.
  const deadline = paymentDeadlineLabel(new Date());
  const baseVars = {
    name: f.tenantName,
    unit: f.unitNumber,
    month: f.monthName,
    year: f.year,
    currency: f.currency,
    deadline,
    business: f.identityName ?? '',
  };
  const message = custom
    ? renderMergeFields(custom.body, mergeVarsFor(kind, f, baseVars, nextMonth))
    : fallbackSmsMessage(kind, f, nextMonth, nextYear, deadline);
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
  FINAL_NOTICE: 'SMS_FINAL_NOTICE',
  WATER_BILLING: 'SMS_WATER_BILLING',
  LATE_FEE: 'SMS_LATE_FEE',
  WELCOME: 'SMS_WELCOME',
};

// Merge fields for a customized template — exactly the fields the Message
// Templates editor offers for that kind, resolved from the live ledger.
// {{account}} is always the unit label (never empty); the mode-aware
// {{account_clause}} / {{reference_clause}} / {{pay_line}} carry the reference
// phrasing and vanish when no reference exists (Send Money).
function mergeVarsFor(kind: ReminderKind, f: ReminderFigures, baseVars: MergeVars, nextMonth: number): MergeVars {
  const unitLabel = `Unit ${f.unitNumber}`;
  const accountClause = f.accountNumber ? ` with account ${f.accountNumber}` : '';
  const referenceClause = f.accountNumber ? `, quoting ${f.accountNumber} as the account reference` : '';
  switch (kind) {
    case 'BALANCE_DUE':
      return { ...baseVars, period: f.arrearsSpan, account: unitLabel, account_clause: accountClause, rent_due: Math.max(f.rentBalance, 0), water_due: Math.max(f.waterBalance, 0), total_due: Math.max(f.combinedBalance, 0), payment_method: f.paymentMethod };
    case 'DUE_SOON':
      return { ...baseVars, reference_clause: referenceClause, next_month: MONTH_NAMES[nextMonth - 1], amount: Math.max(f.currentRent, 0), payment_method: f.paymentMethod };
    case 'WATER_BILLING': {
      const prev = f.latestWaterReading?.previous ?? null;
      const curr = f.latestWaterReading?.current ?? null;
      return {
        ...baseVars,
        period: f.waterArrearsSpan,
        amount: Math.max(f.waterBalance, 0),
        payment_method: f.paymentMethod,
        previous_reading: prev,
        current_reading: curr,
        units_used: prev !== null && curr !== null ? Math.round((curr - prev) * 100) / 100 : null,
      };
    }
    case 'LATE_FEE':
      return { ...baseVars, amount_due: Math.max(f.rentBalance, 0) };
    case 'FINAL_NOTICE':
      return {
        ...baseVars,
        period: Math.max(f.rentBalance, 0) > 0 ? f.arrearsSpan : f.waterArrearsSpan,
        account: unitLabel,
        account_clause: accountClause,
        rent_due: Math.max(f.rentBalance, 0),
        water_due: Math.max(f.waterBalance, 0),
        total_due: Math.max(f.combinedBalance, 0),
        contact: f.contactPhone ?? '',
        payment_method: f.paymentMethod,
      };
    case 'WELCOME':
      return { ...baseVars, account: unitLabel, reference_clause: referenceClause, amount: Math.max(f.currentRent, 0), payment_method: f.paymentMethod };
    case 'OVERDUE':
    default:
      return { ...baseVars, period: f.arrearsSpan, amount_due: Math.max(f.rentBalance, 0), total_due: Math.max(f.combinedBalance, 0) };
  }
}

// The hardcoded builders, used when nobody has customized that kind — same six
// kinds as above, so an untouched install sends exactly the default wording.
function fallbackSmsMessage(kind: ReminderKind, f: ReminderFigures, nextMonth: number, nextYear: number, deadline: string): string {
  const identity = f.identityName ?? undefined;
  switch (kind) {
    case 'BALANCE_DUE':
      return monthlyBalanceDueMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, period: f.arrearsSpan,
        rentDue: Math.max(f.rentBalance, 0),
        waterDue: Math.max(f.waterBalance, 0),
        totalDue: Math.max(f.combinedBalance, 0), accountNumber: f.accountNumber,
        paymentMethod: f.paymentMethod, currency: f.currency, deadline, businessIdentity: identity,
      });
    case 'DUE_SOON':
      return rentDueSoonMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, nextMonthName: MONTH_NAMES[nextMonth - 1], year: nextYear,
        rentAmount: Math.max(f.currentRent, 0), paymentMethod: f.paymentMethod, accountNumber: f.accountNumber, currency: f.currency, businessIdentity: identity,
      });
    case 'WATER_BILLING':
      return waterBillingNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, period: f.waterArrearsSpan,
        amount: Math.max(f.waterBalance, 0), paymentMethod: f.paymentMethod, currency: f.currency, deadline,
        previousReading: f.latestWaterReading?.previous ?? null,
        currentReading: f.latestWaterReading?.current ?? null,
        businessIdentity: identity,
      });
    case 'LATE_FEE':
      return lateFeeNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, amountDue: Math.max(f.rentBalance, 0),
        currency: f.currency, businessIdentity: identity,
      });
    case 'FINAL_NOTICE':
      return finalNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber,
        period: Math.max(f.rentBalance, 0) > 0 ? f.arrearsSpan : f.waterArrearsSpan,
        rentDue: Math.max(f.rentBalance, 0),
        waterDue: Math.max(f.waterBalance, 0),
        totalDue: Math.max(f.combinedBalance, 0), accountNumber: f.accountNumber,
        paymentMethod: f.paymentMethod, currency: f.currency, deadline,
        contactPhone: f.contactPhone, businessIdentity: identity,
      });
    case 'WELCOME':
      return welcomeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, rentAmount: Math.max(f.currentRent, 0),
        paymentMethod: f.paymentMethod, accountNumber: f.accountNumber, currency: f.currency, businessIdentity: identity,
      });
    case 'OVERDUE':
    default:
      return overdueNoticeMessage({
        tenantName: f.tenantName, unitNumber: f.unitNumber, period: f.arrearsSpan, amountDue: Math.max(f.rentBalance, 0),
        totalBalance: Math.max(f.combinedBalance, 0), currency: f.currency, deadline, businessIdentity: identity,
      });
  }
}

// --- One-click bulk arrears reminders ---------------------------------------
// Single-operator action: queue a personalised SMS for EVERY ACTIVE tenant
// with money owing on EITHER side of the ledger — rent OR water. The gate is
// per-side (rentBalance / waterBalance), never the net combined figure, so a
// rent credit can never mask a water debt and a paid-up tenant (both sides
// clear or in credit) is always skipped. The `audience` narrows WHO is
// reminded (ALL = rent-or-water debtors, RENT = rent debtors only, WATER =
// water debtors only) while the kind still follows what EACH tenant actually
// owes, so every message quotes its recipient's own bill:
//   rent owed + net positive -> BALANCE_DUE statement (combined total covers both)
//   rent owed + netted to zero by a water credit -> OVERDUE (leads with the rent owed)
//   rent clear but water owed -> WATER_BILLING notice (water amount + meter proof)
// Custom Message Templates apply exactly as they do for a hand-queued
// reminder. Queue-only: rows auto-dispatch when the SMS pipeline is on,
// otherwise they wait as PENDING for manual send from the SMS page.
// Idempotency: a tenant who has already received MAX_ARREARS_REMINDERS_PER_
// MONTH (three) reminder SMS this reporting month is skipped with
// ALREADY_REMINDed — the bulk buttons allow a patient chase (a first
// reminder plus two repeats) and then stop. An accidental re-click and
// the scheduler's earlier batch stop inside the same allowance. The tagged
// reminder family counts (bulk rows, scheduler batches, hand sends from
// the Tenants page); receipts and landlord alerts are separate rows and
// a per-tenant hand send stays available as the deliberate re-send path
// (it counts toward the cap but is itself never blocked).
export type BulkAudience = 'ALL' | 'RENT' | 'WATER';

type BulkSkipReason = 'NO_PHONE' | 'PAID' | 'OTHER_BILL' | 'ALREADY_REMINDed';

// The template_kind tags that mark a row as "we already chased this tenant
// this month" — the bulk buttons, the scheduled batches, and hand sends from
// the Tenants page (routes/tenants.ts). Receipt rows carry receipt_id and
// landlord alerts carry tenant_id NULL, so neither can match a tenant here.
const REMINDER_TAGS = ['MANUAL_BULK_ARREARS', 'MANUAL_REMINDER', 'AUTO_DUE_SOON', 'AUTO_OVERDUE'];

// How many reminder-family texts a tenant may receive in one reporting month
// before the bulk buttons start skipping them: the first reminder plus two
// patient repeats. A hand send from the Tenants page counts toward the cap
// (it is a reminder too) but is itself never blocked, and a FAILED row never
// reached the phone so it frees its slot for the next attempt.
const MAX_ARREARS_REMINDERS_PER_MONTH = 3;

/** Which of these tenants have already received MAX_ARREARS_REMINDERS_PER_MONTH
 *  reminder-family SMS since `since` (the month start). A FAILED row never
 *  reached the phone and does not consume a slot — a re-click after a failure
 *  is a retry, not a duplicate; a PENDING row counts, because queuing twice
 *  would double-send once the pipeline flushes. Shared by the bulk buttons
 *  and the scheduled overdue chase. */
export async function tenantsRemindedSince(tenantIds: number[], since: Date): Promise<Set<number>> {
  if (tenantIds.length === 0) return new Set();
  const rows = await query<{ tenant_id: number }>(
    `SELECT tenant_id FROM sms_notifications
     WHERE tenant_id = ANY($1::int[]) AND template_kind = ANY($2::text[])
       AND status <> 'FAILED' AND created_at >= $3
     GROUP BY tenant_id HAVING COUNT(*) >= $4`,
    [tenantIds, REMINDER_TAGS, since, MAX_ARREARS_REMINDERS_PER_MONTH],
  );
  return new Set(rows.map((r) => r.tenant_id));
}

interface BulkSkippedTenant {
  tenantId: number;
  tenantName: string;
  unitNumber: string | null;
  reason: BulkSkipReason;
  /** Which bill they owe, when reason is OTHER_BILL (the bill outside the audience). */
  bill: 'RENT' | 'WATER' | null;
}

export interface BulkArrearsResult {
  total: number;
  audience: BulkAudience;
  owing: number;
  queued: number;
  skippedPaid: number;
  skippedNoPhone: number;
  /** Owes money, but only on the bill outside the chosen audience. */
  skippedOtherBill: number;
  /** In the audience, but already chased MAX_ARREARS_REMINDERS_PER_MONTH times this month. */
  skippedAlreadyReminded: number;
  /** Every skipped tenant by name, so the operator can see exactly who and why. */
  skipped: BulkSkippedTenant[];
}

export async function sendBulkArrearsReminders(opts: {
  userId?: number | null;
  audience?: BulkAudience;
}): Promise<BulkArrearsResult> {
  const audience = opts.audience ?? 'ALL';
  const settings = await getSettings();
  const year = settings.reporting_year;
  const month = new Date().getUTCMonth() + 1;

  const tenants = await query<{ id: number; full_name: string; unit_number: string | null }>(
    `SELECT t.id, t.full_name, u.unit_number
     FROM tenants t LEFT JOIN units u ON u.id = t.unit_id
     WHERE t.status = 'ACTIVE' ORDER BY t.id`,
  );

  let owing = 0;
  let queued = 0;
  let skippedPaid = 0;
  let skippedNoPhone = 0;
  let skippedOtherBill = 0;
  let skippedAlreadyReminded = 0;
  const skipped: BulkSkippedTenant[] = [];

  // Who was already chased this month — one indexed lookup for the whole
  // blast, not one query per tenant. The window is this reporting month,
  // the same (year, month) the ledger figures above are read against.
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const alreadyReminded = await tenantsRemindedSince(
    tenants.map((t) => t.id),
    monthStart,
  );

  for (const tenant of tenants) {
    const ledger = await tenantBalances(tenant.id, year, month);
    const rentOwing = ledger.rentBalance > 0.009;
    const waterOwing = ledger.waterBalance > 0.009;
    const inAudience =
      audience === 'ALL' ? rentOwing || waterOwing : audience === 'RENT' ? rentOwing : waterOwing;
    if (!inAudience) {
      if (!rentOwing && !waterOwing) {
        skippedPaid += 1;
        skipped.push({ tenantId: tenant.id, tenantName: tenant.full_name, unitNumber: tenant.unit_number, reason: 'PAID', bill: null });
      } else {
        skippedOtherBill += 1;
        skipped.push({
          tenantId: tenant.id,
          tenantName: tenant.full_name,
          unitNumber: tenant.unit_number,
          reason: 'OTHER_BILL',
          bill: rentOwing ? 'RENT' : 'WATER',
        });
      }
      continue;
    }
    owing += 1;
    if (alreadyReminded.has(tenant.id)) {
      skippedAlreadyReminded += 1;
      skipped.push({ tenantId: tenant.id, tenantName: tenant.full_name, unitNumber: tenant.unit_number, reason: 'ALREADY_REMINDed', bill: null });
      continue;
    }
    const kind: ReminderKind =
      rentOwing && ledger.combinedBalance > 0.009
        ? 'BALANCE_DUE'
        : rentOwing
          ? 'OVERDUE'
          : 'WATER_BILLING';
    const sent = await prepareReminder(tenant.id, kind, 'SMS', {
      userId: opts.userId ?? null,
      templateKind: 'MANUAL_BULK_ARREARS',
    });
    if (sent?.smsId) {
      dispatchAutoSend(sent.smsId);
      queued += 1;
    } else {
      skippedNoPhone += 1;
      skipped.push({ tenantId: tenant.id, tenantName: tenant.full_name, unitNumber: tenant.unit_number, reason: 'NO_PHONE', bill: null });
    }
  }

  await logAudit({
    userId: opts.userId ?? null,
    action: 'BULK_ARREARS_REMINDERS',
    entity: 'tenants',
    newValue: { audience, total: tenants.length, owing, queued, skippedPaid, skippedNoPhone, skippedOtherBill, skippedAlreadyReminded },
  });

  return { total: tenants.length, audience, owing, queued, skippedPaid, skippedNoPhone, skippedOtherBill, skippedAlreadyReminded, skipped };
}
