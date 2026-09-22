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

export default function EmailCampaign() {
  const { toast } = useToast();
  const [mode, setMode] = useState<'bulk' | 'warning'>('bulk');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [subject, setSubject] = useState('Olbano Plaza update');
  const [message, setMessage] = useState('Dear {{name}},\n\nWe have an important update for you.\n\nRegards,\nOlbano Plaza');
  const [busy, setBusy] = useState(false);
  const [shakeRef, fireShake] = useShake();
  const { data, loading, error } = useFetch(() => api.list<TenantOption>('/api/tenants?status=ACTIVE&limit=100'), []);
  const tenants = data?.data ?? [];
  const emailTenants = useMemo(() => tenants.filter((tenant) => tenant.email), [tenants]);
  const selectedCount = selectedIds.length === 0 ? emailTenants.length : selectedIds.length;

  function chooseMode(value: 'bulk' | 'warning') {
    setMode(value);
    if (value === 'warning') {
      setSubject('Rent payment reminder - Olbano Plaza');
      setMessage('Dear {{name}},\n\nThis is a reminder that your rent account requires attention. Please contact management or make payment using your unit number as the M-Pesa account reference.\n\nRegards,\nOlbano Plaza');
    } else {
      setSubject('Olbano Plaza update');
      setMessage('Dear {{name}},\n\nWe have an important update for you.\n\nRegards,\nOlbano Plaza');
    }
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
              <Select value={mode} onChange={(event) => chooseMode(event.target.value as 'bulk' | 'warning')}>
                <option value="bulk">Bulk tenant update</option>
                <option value="warning">Rent payment warning</option>
              </Select>
            </Field>
            <Field label="Subject"><TextInput value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
            <Field label="Message" hint="Use {{name}} and {{unit}} for each tenant's name and unit number.">
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={9} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 md:text-sm" />
            </Field>
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
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
