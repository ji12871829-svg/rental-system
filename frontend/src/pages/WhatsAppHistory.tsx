import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface WhatsappMessage {
  id: number;
  tenant_id: number | null;
  phone_number: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'ERRONEOUS';
  provider_message_id: string | null;
  template_kind: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  failure_reason: string | null;
  created_at: string;
  sent_at: string | null;
  tenant_name: string | null;
  unit_number: string | null;
}

interface WhatsappConfigInfo {
  provider: 'cloud' | 'none';
  live: boolean;
  apiVersion: string;
  templates?: { reminder: string | null; finalNotice: string | null; language: string };
}

export default function WhatsAppHistory() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [viewMsg, setViewMsg] = useState<WhatsappMessage | null>(null);
  // The fix-number-and-resend dialog: an ERRONEOUS row is stuck because the
  // number itself was refused (e.g. not on WhatsApp), so the operator corrects
  // the digits in place.
  const [resendMsg, setResendMsg] = useState<WhatsappMessage | null>(null);
  const [resendPhone, setResendPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: configResponse } = useFetch(() => api.get<{ data: WhatsappConfigInfo }>('/api/whatsapp/config'), [refreshKey]);
  const config = configResponse?.data;
  const liveMode = config?.live === true;

  const { data, loading, error } = useFetch(
    () => api.list<WhatsappMessage>(`/api/whatsapp/history${qs({ page, limit: 20, q: q || undefined, status: statusFilter || undefined })}`),
    [page, q, statusFilter, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  // An optional corrected number makes the backend re-send to it (and record
  // it on the row); omitted = the stored number, the normal retry path.
  async function send(m: WhatsappMessage, phone?: string): Promise<boolean> {
    try {
      const corrected = phone?.trim();
      const body = corrected && corrected.replace(/\D/g, '') !== m.phone_number ? { phone: corrected } : undefined;
      const res = await api.post<{ data: WhatsappMessage }>(`/api/whatsapp/${m.id}/send`, body);
      if (res.data.status === 'SENT') {
        toast('success', `WhatsApp message sent to ${res.data.phone_number}.`);
      } else {
        toast('error', `Send failed: ${res.data.failure_reason ?? 'unknown provider error'}`);
      }
      refresh();
      return res.data.status === 'SENT';
    } catch (err) {
      toast('error', (err as Error).message);
      refresh();
      return false;
    }
  }

  function openResend(m: WhatsappMessage) {
    setResendPhone(m.phone_number);
    setResendMsg(m);
  }

  async function confirmResend() {
    if (!resendMsg || sending) return;
    const corrected = resendPhone.trim();
    if (corrected.replace(/\D/g, '').length < 10) {
      toast('error', 'Enter a valid phone number (digits with country code).');
      return;
    }
    setSending(true);
    try {
      const sent = await send(resendMsg, corrected);
      if (sent) setResendMsg(null); // keep the dialog open on a fresh failure so the number can be adjusted again
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="WhatsApp History"
        subtitle="Rule reminders and Final Notices delivered through Meta's WhatsApp Cloud API"
      />

      {config && (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
            liveMode
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
          {liveMode ? (
            <span>
              <strong>Live mode</strong> — sends go out directly through Meta's WhatsApp Cloud API (Graph{' '}
              {config.apiVersion}). Failed-with-retry rows are replayed automatically by the retry sweep.{' '}
              {config.templates?.reminder || config.templates?.finalNotice
                ? (config.templates?.reminder
                    ? `Statement reminders go out as approved template \u2018${config.templates.reminder}\u2019`
                    : null) +
                  (config.templates?.reminder && config.templates?.finalNotice ? '; ' : '') +
                  (config.templates?.finalNotice
                    ? `Final Notices as \u2018${config.templates.finalNotice}\u2019`
                    : null) +
                  ' (no 24-hour window).'
                : 'Free-form sends only — the 24-hour window applies until a template is registered.'}
            </span>
          ) : (
            <span>
              <strong>Click-to-chat mode</strong> — nothing is sent automatically; reminders open WhatsApp with the text
              pre-filled for you to press send. Set{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">WHATSAPP_TOKEN</code> and{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">WHATSAPP_PHONE_NUMBER_ID</code> in{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">backend/.env</code> to send directly.
            </span>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <TextInput placeholder="Search message or recipient…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
            <option value="ERRONEOUS">Erroneous</option>
          </Select>
        </div>
      </div>

      {loading && <SkeletonTable cols={8} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Created</th><th>Recipient</th><th>Tenant</th><th>Unit</th><th>Message</th><th>Status</th><th>Attempts</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((m) => (
                  <tr key={m.id}>
                    <td className="text-xs text-gray-500">{formatDate(m.created_at)}</td>
                    <td className="text-xs">{m.phone_number}</td>
                    <td className="font-medium">{m.tenant_name ?? <span className="text-xs text-gray-400">—</span>}</td>
                    <td>{m.unit_number ? `Unit ${m.unit_number}` : '—'}</td>
                    <td className="max-w-[280px]">
                      <button
                        className="truncate text-left text-xs text-gray-600 hover:text-brand-600"
                        title="View full message"
                        onClick={() => setViewMsg(m)}
                      >
                        {m.message.length > 60 ? `${m.message.slice(0, 60)}…` : m.message}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={m.status} />
                      {(m.status === 'FAILED' || m.status === 'ERRONEOUS') && m.failure_reason && (
                        <div className="mt-1 max-w-[180px] text-[10px] text-red-500" title={m.failure_reason}>{m.failure_reason}</div>
                      )}
                    </td>
                    <td className="text-xs tabular-nums text-gray-700" title={m.next_retry_at ? `Automatic retry scheduled ${formatDate(m.next_retry_at)}` : undefined}>
                      {m.attempt_count}
                      {m.status === 'FAILED' && m.next_retry_at && (
                        <div className="text-[10px] text-gray-400">retry {formatDate(m.next_retry_at)}</div>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setViewMsg(m)}>View</Button>
                        {m.status === 'ERRONEOUS' ? (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs text-emerald-700"
                            onClick={() => openResend(m)}
                          >
                            Fix &amp; send
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs text-emerald-700"
                            title={m.status === 'SENT' ? 'This message already went out — clicking delivers a duplicate copy.' : undefined}
                            onClick={() => send(m)}
                          >
                            {m.status === 'PENDING' ? 'Send' : 'Send again'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && (
              <div className="p-6">
                <EmptyState message="No WhatsApp messages yet — they appear when a reminder or Final Notice is delivered through the Cloud API." />
              </div>
            )}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={viewMsg !== null} title={`WhatsApp message #${viewMsg?.id ?? ''}`} onClose={() => setViewMsg(null)}>
        {viewMsg && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span>To: {viewMsg.phone_number}</span>
              <span>Created: {formatDate(viewMsg.created_at)}</span>
              {viewMsg.sent_at && <span>Sent: {formatDate(viewMsg.sent_at)}</span>}
              {viewMsg.template_kind && <span>Kind: {viewMsg.template_kind.replace(/_/g, ' ')}</span>}
            </div>
            <div className="rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{viewMsg.message}</div>
            {viewMsg.provider_message_id && (
              <div className="text-xs text-gray-500">Provider reference: {viewMsg.provider_message_id}</div>
            )}
            {(viewMsg.status === 'FAILED' || viewMsg.status === 'ERRONEOUS') && viewMsg.failure_reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <strong>{viewMsg.status === 'ERRONEOUS' ? 'Permanent rejection:' : 'Delivery failed:'}</strong> {viewMsg.failure_reason}
                <div className="mt-1 text-red-600">
                  {viewMsg.status === 'ERRONEOUS' ? (
                    'The number itself was refused — automatic retries will never attempt it. Correct the number and send again from here.'
                  ) : viewMsg.next_retry_at ? (
                    `Attempt ${viewMsg.attempt_count} — automatic retry scheduled ${formatDate(viewMsg.next_retry_at)}. If the tenant has replied on WhatsApp since, sending now usually goes through.`
                  ) : (
                    `Tried ${viewMsg.attempt_count} time${viewMsg.attempt_count === 1 ? '' : 's'} — automatic retries exhausted. You can still send it manually.`
                  )}
                </div>
              </div>
            )}
            {viewMsg.status === 'SENT' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <strong>Already delivered.</strong> Sending again delivers a duplicate copy to {viewMsg.phone_number} — the new attempt replaces the stored reference and bumps the attempt count on this row.
              </div>
            )}
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  const target = viewMsg;
                  setViewMsg(null);
                  if (target.status === 'ERRONEOUS') openResend(target);
                  else send(target);
                }}
              >
                {viewMsg.status === 'PENDING' ? 'Send Now' : 'Send Again'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={resendMsg !== null} title="Fix recipient & send again" onClose={() => setResendMsg(null)}>
        {resendMsg && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <strong>Permanent rejection:</strong> {resendMsg.failure_reason ?? 'the number was refused by WhatsApp.'}
              <div className="mt-1 text-red-600">
                Correct the number below — the message goes to the fixed number and this history row is updated in place.
              </div>
            </div>
            <Field label="Recipient number" hint="Digits with country code (e.g. 254712345678). Content stays unchanged; only the recipient is corrected.">
              <TextInput
                value={resendPhone}
                onChange={(e) => setResendPhone(e.target.value)}
                placeholder="2547XXXXXXXX"
                type="tel"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setResendMsg(null)}>Cancel</Button>
              <Button loading={sending} onClick={confirmResend}>Send Again</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
