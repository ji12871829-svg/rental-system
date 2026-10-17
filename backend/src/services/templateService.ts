// User-editable message templates (14 kinds) with mail-merge support.
//
// A `message_templates` row exists ONLY for a template someone customized:
// every send path (smsService receipt SMS + reminders + WhatsApp composes,
// emailService tenant campaign) falls back to its hardcoded default when
// there is no row, so an untouched install behaves exactly as before and
// "Revert" is just a DELETE. The default bodies here mirror the hardcoded
// builders in utils/businessRules.ts; they are the editor UI's starting
// text; the runtime fallback keeps using businessRules directly so the two
// never drift for sends.

import { query, queryOne } from '../config/db';
import { renderMergeFields, type MergeVars } from '../utils/mergeFields';
import { notFound } from '../utils/httpError';

export type TemplateKind =
  | 'SMS_RENT_RECEIPT'
  | 'SMS_WATER_RECEIPT'
  | 'SMS_COMBINED_RECEIPT'
  | 'SMS_BALANCE_DUE'
  | 'SMS_OVERDUE'
  | 'SMS_FINAL_NOTICE'
  | 'SMS_LANDLORD_ALERT'
  | 'SMS_RENT_DUE_SOON'
  | 'SMS_WATER_BILLING'
  | 'SMS_LATE_FEE'
  | 'SMS_WELCOME'
  | 'WHATSAPP_BALANCE_DUE'
  | 'WHATSAPP_OVERDUE'
  | 'WHATSAPP_PAYMENT_CONFIRMATION'
  | 'EMAIL_CAMPAIGN';

export interface TemplateKindMeta {
  kind: TemplateKind;
  label: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
  description: string;
  fields: string[];
  hasSubject: boolean;
  defaultSubject: string | null;
  defaultBody: string;
}

export const TEMPLATE_KINDS: TemplateKindMeta[] = [
  {
    kind: 'SMS_RENT_RECEIPT',
    label: 'Rent Receipt',
    channel: 'SMS' as const,
    description:
      'Sent (queued) whenever a rent payment is receipted. Note: customized templates are sent as-is — the automatic business-identity line is only appended to the default wording, so include {{business}} in the text if you want it.',
    fields: ['name', 'unit', 'month', 'year', 'amount', 'balance', 'receipt', 'date', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'RENT RECEIPT: Dear {{name}}, we have received {{currency}} {{amount}} on {{date}} for Unit {{unit}} rent, {{month}} {{year}}. Your outstanding balance is {{currency}} {{balance}}. Receipt: {{receipt}}. Thank you.',
  },
  {
    kind: 'SMS_WATER_RECEIPT',
    label: 'Water Receipt',
    channel: 'SMS' as const,
    description: 'Sent whenever a water payment is receipted.',
    fields: ['name', 'unit', 'month', 'year', 'amount', 'balance', 'receipt', 'date', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'WATER RECEIPT: Dear {{name}}, we have received {{currency}} {{amount}} on {{date}} for Unit {{unit}} water, {{month}} {{year}}. Outstanding balance: {{currency}} {{balance}}. Receipt: {{receipt}}. Thank you.',
  },
  {
    kind: 'SMS_COMBINED_RECEIPT',
    label: 'Combined Receipt (Rent + Water)',
    channel: 'SMS' as const,
    description: 'Sent whenever a combined rent + water payment is receipted.',
    fields: ['name', 'unit', 'month', 'year', 'rent', 'water', 'total', 'balance', 'receipt', 'date', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'PAYMENT RECEIPT: Dear {{name}}, we have received {{currency}} {{total}} on {{date}} for Unit {{unit}}, {{month}} {{year}} (Rent {{currency}} {{rent}} + Water {{currency}} {{water}}). Outstanding balance: {{currency}} {{balance}}. Receipt: {{receipt}}. Thank you.',
  },
  {
    kind: 'SMS_BALANCE_DUE',
    label: 'Balance Due Statement',
    channel: 'SMS' as const,
    description: 'The itemized arrears reminder an operator sends from the SMS page, a tenant card, or the one-click bulk button — rent and water stated separately, with the pay-by deadline ({{deadline}}). {{account_clause}} carries the account reference and vanishes when the operator collects by Send Money (no reference exists). Rent-only arrears automatically shorten when nothing is customized.',
    fields: ['name', 'unit', 'period', 'rent_due', 'water_due', 'total_due', 'account', 'account_clause', 'deadline', 'payment_method', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, Unit {{unit}} arrears {{period}}: Rent {{currency}} {{rent_due}} + Water {{currency}} {{water_due}} = Total {{currency}} {{total_due}}. Pay by {{deadline}} via {{payment_method}}{{account_clause}}. If already paid, ignore this message. Thank you.',
  },
  {
    kind: 'SMS_OVERDUE',
    label: 'Overdue Notice',
    channel: 'SMS' as const,
    description: 'The firmer "Overdue Notice" reminder for a past-due balance — settle by {{deadline}} (the 10th, or the next one once this month\'s has passed) or a late payment fee follows.',
    fields: ['name', 'unit', 'period', 'amount_due', 'total_due', 'deadline', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, the rent for Unit {{unit}} is overdue by {{currency}} {{amount_due}} ({{period}}). Kindly settle by {{deadline}} to avoid a late payment fee. Your total balance is {{currency}} {{total_due}}. If already paid, ignore this message. Thank you.',
  },
  {
    kind: 'SMS_FINAL_NOTICE',
    label: 'Final Notice (Eviction Warning)',
    channel: 'SMS' as const,
    description:
      'The firm escalation the operator sends from a tenant card after routine reminders have gone unanswered: it leads with FINAL NOTICE, names the unpaid arrears, demands payment by {{deadline}}, and warns that the tenancy will be terminated and eviction proceedings started under the lease. Sent only per tenant, and only when something is actually owed. Rent-only and water-only arrears automatically shorten when nothing is customized.',
    fields: ['name', 'unit', 'period', 'rent_due', 'water_due', 'total_due', 'account', 'account_clause', 'contact', 'deadline', 'payment_method', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, FINAL NOTICE: Unit {{unit}} arrears {{period}}: Rent {{currency}} {{rent_due}} + Water {{currency}} {{water_due}} = Total {{currency}} {{total_due}} is unpaid despite reminders. Pay by {{deadline}} via {{payment_method}}{{account_clause}}, or we will begin termination of your tenancy and eviction proceedings as per the lease. Already paid or unable to pay? Call {{contact}}. Thank you.',
  },
  {
    kind: 'SMS_LANDLORD_ALERT',
    label: 'Landlord Payment Alert',
    channel: 'SMS' as const,
    description:
      'Sent to the business contact phone (Business Identity contact phone) whenever a rent or combined payment is receipted — a text the moment money lands. Note: customized templates are sent as-is; include {{business}} if you want the identity line.',
    fields: ['name', 'unit', 'month', 'year', 'amount', 'balance', 'receipt', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'PAYMENT RECEIVED: {{currency}} {{amount}} from {{name}}, Unit {{unit}}, for {{month}} {{year}} rent. Receipt: {{receipt}}. Balance: {{currency}} {{balance}}.',
  },
  {
    kind: 'SMS_RENT_DUE_SOON',
    label: 'Rent Due Reminder',
    channel: 'SMS' as const,
    description:
      'The automatic "rent is due" nudge sent on the last day of each month for the month that starts the next day (when Automatic monthly reminders are on in Settings).',
    fields: ['name', 'unit', 'next_month', 'amount', 'deadline', 'currency', 'payment_method', 'reference_clause', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, a friendly reminder that {{next_month}} rent of {{currency}} {{amount}} for Unit {{unit}} falls due by 10 {{next_month}}. Please pay via {{payment_method}}{{reference_clause}}. Thank you.',
  },
  {
    kind: 'SMS_WATER_BILLING',
    label: 'Water Billing Notice',
    channel: 'SMS' as const,
    description:
      'Reminds the tenant their water charge is still unpaid. {{period}} names the unpaid water months ("Sep, Oct 2026"); {{deadline}} is the pay-by date. Sent only when an operator sends it — billing water never spends SMS credit on its own.',
    fields: ['name', 'unit', 'period', 'amount', 'previous_reading', 'current_reading', 'units_used', 'deadline', 'payment_method', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, water for Unit {{unit}} ({{period}}) is unpaid: {{currency}} {{amount}}. Meter: prev {{previous_reading}}, curr {{current_reading}} ({{units_used}} units). Pay with rent via {{payment_method}} by {{deadline}}. If already paid, ignore this message. Thank you.',
  },
  {
    kind: 'SMS_LATE_FEE',
    label: 'Late Payment Fee',
    channel: 'SMS' as const,
    description:
      'Informs the tenant that a late fee now sits on top of their overdue rent. Sent only when an operator sends it.',
    fields: ['name', 'unit', 'amount_due', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, a late payment fee now applies to the overdue rent of {{currency}} {{amount_due}} on Unit {{unit}}. Kindly settle the full amount, including the fee, to avoid further charges. Thank you.',
  },
  {
    kind: 'SMS_WELCOME',
    label: 'New Tenant Welcome',
    channel: 'SMS' as const,
    description:
      'A one-time welcome when a tenancy starts: when rent falls due (by the 10th of each month) and how to pay it. Sent only when an operator sends it.',
    fields: ['name', 'unit', 'amount', 'account', 'reference_clause', 'payment_method', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, welcome to Unit {{unit}}! Rent of {{currency}} {{amount}} falls due by the 10th of each month. Pay via {{payment_method}}{{reference_clause}}. We wish you a comfortable stay.',
  },
  {
    kind: 'WHATSAPP_BALANCE_DUE',
    label: 'WhatsApp Balance Due',
    channel: 'WHATSAPP' as const,
    description: 'Pre-filled text for the WhatsApp click-to-chat balance statement (you press send in WhatsApp). {{deadline}} is the pay-by date.',
    fields: ['name', 'unit', 'month', 'year', 'current_rent', 'previous_balance', 'total_due', 'account', 'pay_line', 'deadline', 'payment_method', 'currency'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Hello {{name}}, 🌟 Your rent statement for {{month}} {{year}} is ready for Unit {{unit}}. 💰 Current Rent: {{currency}} {{current_rent}} ➕ Previous Balance: {{currency}} {{previous_balance}} 🧾 Total Due: {{currency}} {{total_due}}. {{pay_line}} Kindly settle by {{deadline}}. If you have already paid, please ignore this message. Thank you!',
  },
  {
    kind: 'WHATSAPP_OVERDUE',
    label: 'WhatsApp Overdue',
    channel: 'WHATSAPP' as const,
    description:
      'Pre-filled text for the WhatsApp click-to-chat overdue reminder. {{deadline}} is the pay-by date; {{support_link}} expands to the "chat with support" sentence when a support phone is configured, or to nothing otherwise.',
    fields: ['name', 'unit', 'amount_due', 'deadline', 'support_link', 'currency'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, this is a reminder that your account for Unit {{unit}} has an outstanding balance of {{currency}} {{amount_due}}. Please settle by {{deadline}} to maintain a clear ledger.{{support_link}}',
  },
  {
    kind: 'WHATSAPP_PAYMENT_CONFIRMATION',
    label: 'WhatsApp Payment Confirmation',
    channel: 'WHATSAPP' as const,
    description:
      'Pre-filled text for the WhatsApp click-to-chat payment thank-you with the updated balance (you press send in WhatsApp).',
    fields: ['name', 'unit', 'amount_paid', 'payment_date', 'new_balance', 'currency'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Thank you, {{name}}! 🎉 We received your payment of {{currency}} {{amount_paid}} on {{payment_date}} for Unit {{unit}}. Your updated account balance is {{currency}} {{new_balance}}. Have a great day!',
  },
  {
    kind: 'EMAIL_CAMPAIGN',
    label: 'Tenant Email Campaign',
    channel: 'EMAIL' as const,
    description:
      'Overrides the subject and body typed into the Tenant Email page: when customized, every campaign is sent with this template instead, with merge fields resolved per tenant.',
    fields: ['name', 'unit', 'business'],
    hasSubject: true,
    defaultSubject: 'A message from {{business}}',
    defaultBody:
      'Hello {{name}},\n\nWe are reaching out regarding Unit {{unit}}.\n\n— {{business}}',
  },
];

export interface MessageTemplateRow {
  id: number;
  kind: string;
  subject: string | null;
  body: string;
  is_custom: boolean;
  updated_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface TemplateState extends TemplateKindMeta {
  customized: boolean;
  /** Currently effective subject/body (custom row, else the default). */
  subject: string | null;
  body: string;
  updated_at: string | null;
}

function assertKind(kind: TemplateKind): TemplateKindMeta {
  const meta = TEMPLATE_KINDS.find((m) => m.kind === kind);
  if (!meta) throw notFound(`Unknown template kind: ${kind}`);
  return meta;
}

export async function getCustomTemplate(kind: TemplateKind): Promise<MessageTemplateRow | null> {
  return queryOne<MessageTemplateRow>(
    `SELECT id, kind, subject, body, is_custom, updated_by, created_at, updated_at
     FROM message_templates
     WHERE kind = $1`,
    [kind],
  );
}

// Pure: a customized template is rendered with the vars; otherwise the
// hardcoded fallback builder runs unchanged.
export function applyTemplate(
  custom: Pick<MessageTemplateRow, 'body'> | null,
  vars: MergeVars,
  fallback: () => string,
): string {
  if (!custom) return fallback();
  return renderMergeFields(custom.body, vars);
}

export async function listTemplateState(): Promise<TemplateState[]> {
  const rows = await query<MessageTemplateRow>(
    `SELECT id, kind, subject, body, is_custom, updated_by, created_at, updated_at
     FROM message_templates`,
  );
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return TEMPLATE_KINDS.map((meta) => {
    const row = byKind.get(meta.kind);
    return {
      ...meta,
      customized: Boolean(row),
      subject: row ? row.subject : meta.defaultSubject,
      body: row ? row.body : meta.defaultBody,
      updated_at: row ? String(row.updated_at) : null,
    };
  });
}

export async function upsertTemplate(
  kind: TemplateKind,
  input: { subject?: string | null; body: string },
  userId: number | null,
): Promise<MessageTemplateRow> {
  const meta = assertKind(kind);
  const subject = meta.hasSubject ? input.subject ?? null : null;
  const rows = await query<MessageTemplateRow>(
    `INSERT INTO message_templates (kind, subject, body, is_custom, updated_by)
     VALUES ($1, $2, $3, TRUE, $4)
     ON CONFLICT (kind) DO UPDATE
       SET subject = EXCLUDED.subject,
           body = EXCLUDED.body,
           is_custom = TRUE,
           updated_by = EXCLUDED.updated_by
     RETURNING id, kind, subject, body, is_custom, updated_by, created_at, updated_at`,
    [kind, subject, input.body, userId],
  );
  return rows[0];
}

export async function resetTemplate(kind: TemplateKind): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `DELETE FROM message_templates WHERE kind = $1 RETURNING id`,
    [kind],
  );
  return rows.length > 0;
}