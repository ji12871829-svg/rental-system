// SMS campaign composer — the SMS twin of the Tenant Email page. Confirmation
// and notice messages (payment reminders, water billing, late fees, welcomes,
// or a free-typed notice) are composed once with {{name}} / {{unit}} merge
// tokens, personalised per ACTIVE tenant, and queued as one PENDING row each.
// Rows auto-send when the SMS pipeline is on, otherwise they wait on the SMS
// page for manual send — exactly like hand-queued reminders, and nothing
// spends credit unattended beyond what auto-send already permits.
import { useState } from 'react';
import { MessageSquareText, Send } from 'lucide-react';
import { Button, EmptyState, Field, Select, SkeletonTable, useShake, useToast } from './ui';
import { api } from '../lib/api';

export interface SmsComposerTenant {
  id: number;
  full_name: string;
  phone_number: string | null;
  unit_number: string | null;
}

export type SmsTemplateKey = 'reminder' | 'general' | 'water' | 'latefee' | 'welcome';

// Starting wordings only — the operator edits before sending. Each fits the
// two-segment GSM-7 budget (306 chars) with a typical name and unit number,
// so the default send never trips the server's cost guard.
export const SMS_TEMPLATES: Record<SmsTemplateKey, string> = {
  reminder: [
    'Dear {{name}}, this is a friendly reminder that your Olbano Plaza account (Unit {{unit}}) has an outstanding balance.',
    'Please pay via M-Pesa using your unit number as the account reference. If you already paid, kindly ignore this message.',
  ].join(' '),
  general: [
    'Dear {{name}}, please note the following regarding your tenancy at Unit {{unit}}:',
    '[Write your notice here]',
    'Regards, Olbano Plaza Management.',
  ].join(' '),
  water: [
    'Dear {{name}}, this is a reminder that water for your Unit {{unit}} is unpaid.',
    'Please pay via M-Pesa using your unit number as the account reference. If you already paid, kindly ignore this message.',
  ].join(' '),
  latefee: [
    'Dear {{name}}, rent for Unit {{unit}} was not received by the due date, so a late fee has been applied.',
    'Please settle the full amount via M-Pesa using your unit number as the reference. Regards, Olbano Plaza Management.',
  ].join(' '),
  welcome: [
    'Dear {{name}}, welcome to Olbano Plaza! Your home is Unit {{unit}}.',
    'Rent is due on the 1st of each month; pay via M-Pesa using your unit number as the reference. Regards, Management.',
  ].join(' '),
};

const SMS_TEMPLATE_LABELS: Record<SmsTemplateKey, string> = {
  reminder: 'Payment reminder',
  general: 'General notice',
  water: 'Water billing notice',
  latefee: 'Late payment fee',
  welcome: 'New tenant welcome',
};

/** Two GSM-7 segments — the per-message cost guard (mirrors the backend). */
export const SMS_BUDGET = 306;

const GSM7_EXTENSION_CHARS = new Set(['^', '{', '}', '[', ']', '~', '\\', '|', '€']);

// Same counting as the backend's gsm7EffectiveLength, so the live counter and
// the server's guard can never disagree on whether a message fits.
export function smsSegments(text: string): { effective: number; segments: number; overBudget: boolean } {
  let effective = 0;
  for (const ch of text) effective += GSM7_EXTENSION_CHARS.has(ch) ? 2 : 1;
  const segments = effective <= 160 ? 1 : Math.ceil(effective / 153);
  return { effective, segments, overBudget: effective > SMS_BUDGET };
}

interface SmsComposerProps {
  tenants: SmsComposerTenant[];
  loading: boolean;
  loadError: string | null;
  /** Template to start on — the arrears deep-link (?compose=arrears) starts on the reminder. */
  initialTemplate?: SmsTemplateKey;
  /** Recipients to start checked — the arrears deep-link checks tenants with open balances. */
  preselectedIds?: number[];
  /** After a successful queue (so the parent can refresh its history). */
  onSent: () => void;
}

export function SmsComposer({ tenants, loading, loadError, initialTemplate = 'general', preselectedIds, onSent }: SmsComposerProps) {
  const { toast } = useToast();
  const [template, setTemplate] = useState<SmsTemplateKey>(initialTemplate);
  const [message, setMessage] = useState(SMS_TEMPLATES[initialTemplate]);
  const [selectedIds, setSelectedIds] = useState<number[]>(preselectedIds ?? []);
  const [busy, setBusy] = useState(false);
  const [shakeRef, fireShake] = useShake();

  const phoneTenants = tenants.filter((t) => t.phone_number?.trim());
  // Empty selection = everyone with a phone (same convention as Tenant Email).
  const effectiveIds = selectedIds.length === 0 ? phoneTenants.map((t) => t.id) : selectedIds;
  const count = smsSegments(message);

  function chooseTemplate(value: SmsTemplateKey) {
    setTemplate(value);
    setMessage(SMS_TEMPLATES[value]);
  }

  function toggleTenant(id: number) {
    // First manual toggle pins the current "everyone" set so unchecking one
    // box doesn't flip the meaning of the rest.
    const base = selectedIds.length === 0 ? phoneTenants.map((t) => t.id) : selectedIds;
    setSelectedIds(base.includes(id) ? base.filter((v) => v !== id) : [...base, id]);
  }

  async function send() {
    if (!message.trim() || phoneTenants.length === 0) {
      toast('error', 'Type a message, and ensure tenants have phone numbers.');
      fireShake();
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ data: { total: number; queued: number; skipped: number; tooLong: number } }>('/api/sms/campaign', {
        // No tenantIds = the whole phone list (same convention as Tenant Email).
        ...(selectedIds.length ? { tenantIds: selectedIds } : {}),
        message,
      });
      const parts = [`${result.data.queued} queued`];
      if (result.data.skipped > 0) parts.push(`${result.data.skipped} skipped (no phone)`);
      if (result.data.tooLong > 0) parts.push(`${result.data.tooLong} over the 2-segment budget — shorten the message and resend to them`);
      toast('success', `Confirmation SMS processed: ${parts.join(', ')}. Queued messages send automatically when auto-send is on, otherwise from this page.`);
      onSent();
    } catch (err) {
      toast('error', (err as Error).message);
      fireShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
      <section ref={shakeRef} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <MessageSquareText size={20} className="text-brand-600" aria-hidden />
          <h2 className="font-semibold text-gray-900">Compose confirmation</h2>
        </div>
        <div className="space-y-4">
          <Field label="Message type">
            <Select value={template} onChange={(event) => chooseTemplate(event.target.value as SmsTemplateKey)}>
              {(Object.keys(SMS_TEMPLATE_LABELS) as SmsTemplateKey[]).map((key) => (
                <option key={key} value={key}>{SMS_TEMPLATE_LABELS[key]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Message" hint="Use {{name}} and {{unit}} for each tenant's name and unit number.">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={6} className="w-full rounded-lg border border-ash bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 md:text-sm" />
          </Field>
          <div className={`rounded-lg px-3 py-2 text-sm ${count.overBudget ? 'bg-red-50 font-semibold text-red-700' : 'bg-fog text-graphite'}`}>
            {count.effective}/{SMS_BUDGET} characters · {count.segments} segment{count.segments === 1 ? '' : 's'}
            {count.overBudget
              ? ' — over the 2-segment budget. Sending will skip recipients whose message exceeds it; shorten the text first.'
              : ` — sending to ${effectiveIds.length} tenant${effectiveIds.length === 1 ? '' : 's'} with phone numbers. Messages are recorded in the history below.`}
          </div>
          <Button onClick={send} disabled={busy || loading} loading={busy} className="w-full">
            <Send size={16} aria-hidden /> {busy ? 'Queueing…' : 'Queue SMS'}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-gray-900">Recipients</h2>
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setSelectedIds(selectedIds.length === 0 ? phoneTenants.map((tenant) => tenant.id) : [])}>
            {selectedIds.length === 0 ? 'Select specific' : 'Send to all'}
          </button>
        </div>
        {loading && <SkeletonTable cols={2} rows={5} />}
        {loadError && <div className="text-sm text-red-600">{loadError}</div>}
        {!loading && !loadError && phoneTenants.length === 0 && <EmptyState message="No active tenants with phone numbers." />}
        {!loading && !loadError && phoneTenants.length > 0 && (
          <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {phoneTenants.map((tenant) => (
              <label key={tenant.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
                <input type="checkbox" checked={selectedIds.length === 0 || selectedIds.includes(tenant.id)} onChange={() => toggleTenant(tenant.id)} className="h-4 w-4" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900">{tenant.full_name} · Unit {tenant.unit_number ?? '—'}</span>
                  <span className="block truncate text-xs text-gray-500">{tenant.phone_number}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
