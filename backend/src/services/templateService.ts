// User-editable message templates (9 kinds) with mail-merge support.
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
    fields: ['name', 'unit', 'month', 'year', 'amount', 'balance', 'receipt', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'RENT RECEIPT: Dear {{name}}, {{currency}} {{amount}} received for Unit {{unit}}, {{month}} {{year}} rent. Balance: {{currency}} {{balance}}. Receipt: {{receipt}}. Thank you.',
  },
  {
    kind: 'SMS_WATER_RECEIPT',
    label: 'Water Receipt',
    channel: 'SMS' as const,
    description: 'Sent whenever a water payment is receipted.',
    fields: ['name', 'unit', 'month', 'year', 'amount', 'balance', 'receipt', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'WATER RECEIPT: Dear {{name}}, {{currency}} {{amount}} received for Unit {{unit}} water, {{month}} {{year}}. Outstanding balance: {{currency}} {{balance}}. Receipt: {{receipt}}. Thank you.',
  },
  {
    kind: 'SMS_COMBINED_RECEIPT',
    label: 'Combined Receipt (Rent + Water)',
    channel: 'SMS' as const,
    description: 'Sent whenever a combined rent + water payment is receipted.',
    fields: ['name', 'unit', 'month', 'year', 'rent', 'water', 'total', 'balance', 'receipt', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'PAYMENT RECEIPT: Dear {{name}}, {{currency}} {{total}} received for Unit {{unit}} for {{month}} {{year}} (Rent {{currency}} {{rent}} + Water {{currency}} {{water}}). Outstanding balance: {{currency}} {{balance}}. Receipt: {{receipt}}. Thank you.',
  },
  {
    kind: 'SMS_BALANCE_DUE',
    label: 'Balance Due Statement',
    channel: 'SMS' as const,
    description: 'The "Balance Due" reminder an operator sends from the SMS page or a tenant card.',
    fields: ['name', 'unit', 'month', 'year', 'total_due', 'account', 'payment_method', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, your statement for {{month}} {{year}} for Unit {{unit}} is ready. Total Due: {{currency}} {{total_due}}. Account: {{account}}. Pay via {{payment_method}}.',
  },
  {
    kind: 'SMS_OVERDUE',
    label: 'Overdue Notice',
    channel: 'SMS' as const,
    description: 'The firmer "Overdue Notice" reminder for a past-due balance.',
    fields: ['name', 'unit', 'amount_due', 'total_due', 'currency', 'business'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Hi {{name}}, Unit {{unit}} has an overdue balance of {{currency}} {{amount_due}}. Please clear this immediately to avoid late fees. Total Balance: {{currency}} {{total_due}}.',
  },
  {
    kind: 'WHATSAPP_BALANCE_DUE',
    label: 'WhatsApp Balance Due',
    channel: 'WHATSAPP' as const,
    description: 'Pre-filled text for the WhatsApp click-to-chat balance statement (you press send in WhatsApp).',
    fields: ['name', 'unit', 'month', 'year', 'current_rent', 'previous_balance', 'total_due', 'account', 'payment_method', 'currency'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Hello {{name}}, 🌟 Your rent statement for {{month}} {{year}} is ready for Unit {{unit}}. 💰 Current Rent: {{currency}} {{current_rent}} ➕ Previous Balance: {{currency}} {{previous_balance}} 🧾 Total Due: {{currency}} {{total_due}}. Please make payment to Account {{account}} via {{payment_method}}. If you have already paid, please ignore this message. Thank you!',
  },
  {
    kind: 'WHATSAPP_OVERDUE',
    label: 'WhatsApp Overdue',
    channel: 'WHATSAPP' as const,
    description:
      'Pre-filled text for the WhatsApp click-to-chat overdue reminder. {{support_link}} expands to the "chat with support" sentence when a support phone is configured, or to nothing otherwise.',
    fields: ['name', 'unit', 'amount_due', 'support_link', 'currency'],
    hasSubject: false,
    defaultSubject: null,
    defaultBody:
      'Dear {{name}}, this is a reminder that your account for Unit {{unit}} has an outstanding balance of {{currency}} {{amount_due}}. Please settle this today to maintain a clear ledger.{{support_link}}',
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