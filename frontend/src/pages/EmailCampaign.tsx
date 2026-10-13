import { useMemo, useState } from 'react';
import { Mail, Send } from 'lucide-react';
import { Button, EmptyState, Field, PageHeader, Select, SkeletonTable, TextInput, useFetch, useShake, useToast } from '../components/ui';
import { api } from '../lib/api';

interface TenantOption {
  id: number;
  full_name: string;
  email: string | null;
  unit_number: string | null;
  status: string;
}

type MessageKey = 'bulk' | 'warning' | 'water' | 'latefee' | 'welcome';

// Ready-made drafts behind the "Message type" dropdown. `{{name}}` and
// `{{unit}}` are substituted per tenant by the backend (composeCampaignEmail),
// so one draft personalises for every recipient — they work in the subject
// line too, not just the body. Picking a type only prefills the composer: the
// tenant-facing copy stays fully editable before sending.
const TEMPLATES: Record<MessageKey, { subject: string; message: string }> = {
  bulk: {
    subject: 'Notice from Olbano Plaza — Unit {{unit}}',
    message: [
      'Dear {{name}},',
      '',
      'We hope you are well. Please take note of the following regarding your tenancy at Unit {{unit}}:',
      '',
      '• [Write your notice here]',
      '',
      'For clarification, kindly reach the management office during working hours.',
      '',
      'Thank you for your continued cooperation.',
      '',
      'Kind regards,',
      'Olbano Plaza Management',
    ].join('\n'),
  },
  warning: {
    subject: 'Rent reminder — Unit {{unit}}',
    message: [
      'Dear {{name}},',
      '',
      'This is a friendly reminder that your rent account for Unit {{unit}} requires attention. Kindly settle the outstanding balance at your earliest convenience.',
      '',
      'To pay via M-Pesa, use your unit number ({{unit}}) as the account reference.',
      '',
      'If you have already paid, please disregard this notice — payments reflect within 24 hours. If you would prefer to arrange a payment plan, please contact the management office.',
      '',
      'Thank you.',
      '',
      'Kind regards,',
      'Olbano Plaza Management',
    ].join('\n'),
  },
  water: {
    subject: 'Water billing — Unit {{unit}}',
    message: [
      'Dear {{name}},',
      '',
      'Your monthly water charge for Unit {{unit}} has been billed to your account for the current month.',
      '',
      'Water is billed monthly from the reading recorded for your unit, and appears on your statement alongside rent. It can be paid together with your rent via M-Pesa, using your unit number ({{unit}}) as the account reference.',
      '',
      'If you believe the reading is incorrect, please contact the management office within 7 days of this notice.',
      '',
      'Kind regards,',
      'Olbano Plaza Management',
    ].join('\n'),
  },
  latefee: {
    subject: 'Late payment fee — Unit {{unit}}',
    message: [
      'Dear {{name}},',
      '',
      'Our records show that rent for Unit {{unit}} was not received by the due date, so a late payment fee has been applied to your account in line with your tenancy agreement.',
      '',
      'To avoid further charges, please settle the full amount — including the late fee — as soon as possible, using your unit number ({{unit}}) as the M-Pesa account reference.',
      '',
      'If you are having difficulty meeting your rent, please contact the management office early so that we can discuss an arrangement.',
      '',
      'Kind regards,',
      'Olbano Plaza Management',
    ].join('\n'),
  },
  welcome: {
    subject: 'Welcome to Olbano Plaza — Unit {{unit}}',
    message: [
      'Dear {{name}},',
      '',
      'Welcome to Olbano Plaza, and thank you for choosing to make Unit {{unit}} your home.',
      '',
      'A few things worth noting:',
      '',
      '• Rent is due on the 1st of each month. Pay via M-Pesa using your unit number ({{unit}}) as the account reference.',
      '• Your monthly statement is available from the management office on request.',
      '• For maintenance requests or questions, contact the office during working hours.',
      '',
      'We wish you a comfortable stay.',
      '',
      'Kind regards,',
      'Olbano Plaza Management',
    ].join('\n'),
  },
};

const TEMPLATE_LABELS: Record<MessageKey, string> = {
  bulk: 'General notice',
  warning: 'Rent payment reminder',
  water: 'Water billing notice',
  latefee: 'Late payment fee',
  welcome: 'New tenant welcome',
};

export default function EmailCampaign() {
  const { toast } = useToast();
  const [mode, setMode] = useState<MessageKey>('bulk');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [subject, setSubject] = useState(TEMPLATES.bulk.subject);
  const [message, setMessage] = useState(TEMPLATES.bulk.message);
  const [busy, setBusy] = useState(false);
  const [shakeRef, fireShake] = useShake();
  const { data, loading, error } = useFetch(() => api.list<TenantOption>('/api/tenants?status=ACTIVE&limit=100'), []);
  const tenants = data?.data ?? [];
  const emailTenants = useMemo(() => tenants.filter((tenant) => tenant.email), [tenants]);
  const selectedCount = selectedIds.length === 0 ? emailTenants.length : selectedIds.length;

  function chooseMode(value: MessageKey) {
    setMode(value);
    setSubject(TEMPLATES[value].subject);
    setMessage(TEMPLATES[value].message);
  }

  function toggleTenant(id: number) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function sendCampaign() {
    if (!subject.trim() || !message.trim() || emailTenants.length === 0) {
      toast('error', 'Enter a subject and message, and ensure tenants have email addresses.');
      fireShake();
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ data: { total: number; sent: number; failed: number; skipped: number } }>('/api/emails/campaign', {
        tenantIds: selectedIds.length ? selectedIds : undefined,
        subject,
        message,
      });
      toast('success', `Email campaign processed: ${result.data.sent} sent, ${result.data.failed} failed, ${result.data.skipped} skipped.`);
    } catch (err) {
      toast('error', (err as Error).message);
      fireShake();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Tenant Email" subtitle="Send payment warnings or a message to active tenants" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
        <section ref={shakeRef} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <Mail size={20} className="text-brand-600" aria-hidden />
            <h2 className="font-semibold text-gray-900">Compose message</h2>
          </div>
          <div className="space-y-4">
            <Field label="Message type">
              <Select value={mode} onChange={(event) => chooseMode(event.target.value as MessageKey)}>
                {(Object.keys(TEMPLATE_LABELS) as MessageKey[]).map((key) => (
                  <option key={key} value={key}>{TEMPLATE_LABELS[key]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Subject"><TextInput value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
            <Field label="Message" hint="Use {{name}} and {{unit}} for each tenant's name and unit number.">
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={9} className="w-full rounded-lg border border-ash bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 md:text-sm" />
            </Field>
            <div className="rounded-lg bg-fog px-3 py-2 text-sm text-graphite">
              This will send to <strong>{selectedCount}</strong> tenant{selectedCount === 1 ? '' : 's'} with email addresses. Emails are recorded in Email History.
            </div>
            <Button onClick={sendCampaign} disabled={busy || loading} loading={busy} className="w-full">
              <Send size={16} aria-hidden /> {busy ? 'Sending…' : 'Send Email'}
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900">Recipients</h2>
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setSelectedIds(selectedIds.length === 0 ? emailTenants.map((tenant) => tenant.id) : [])}>
              {selectedIds.length === 0 ? 'Select specific' : 'Send to all'}
            </button>
          </div>
          {loading && <SkeletonTable cols={2} rows={5} />}
          {error && <div className="text-sm text-red-600">{error}</div>}
          {!loading && !error && emailTenants.length === 0 && <EmptyState message="No active tenants with email addresses." />}
          {!loading && !error && emailTenants.length > 0 && (
            <div className="max-h-[32rem] space-y-2 overflow-y-auto">
              {emailTenants.map((tenant) => (
                <label key={tenant.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
                  <input type="checkbox" checked={selectedIds.length === 0 || selectedIds.includes(tenant.id)} onChange={() => toggleTenant(tenant.id)} className="h-4 w-4" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{tenant.full_name} · Unit {tenant.unit_number ?? '—'}</span>
                    <span className="block truncate text-xs text-gray-500">{tenant.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
