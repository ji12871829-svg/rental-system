import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button, EmptyState, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface Email {
  id: number;
  receipt_id: number | null;
  tenant_id: number | null;
  email_address: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'ERRONEOUS';
  provider_message_id: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
  tenant_name: string | null;
  unit_number: string | null;
}

interface EmailConfigInfo {
  provider: 'mock' | 'smtp' | 'brevo';
  live: boolean;
  from: string | null;
  autoSend: boolean;
}

// Strip styles/scripts and render the stored HTML copy as plain-ish text —
// the modal is a faithful record of what went out, not a live web page.
function EmailBody({ html }: { html: string }) {
  return (
    <div
      className="rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-800"
      // Stored row content — operator-authored templates and tenant names, same
      // trust level as everywhere else the history renders these fields.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function EmailHistory() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [viewEmail, setViewEmail] = useState<Email | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // api.get resolves with the response body { data: ... } — unwrap to the
  // actual config (same latent-bug avoidance as the SMS page).
  const { data: configResponse } = useFetch(() => api.get<{ data: EmailConfigInfo }>('/api/emails/config'), [refreshKey]);
  const config = configResponse?.data;
  const liveMode = config?.live === true;

  const { data, loading, error } = useFetch(
    () => api.list<Email>(`/api/emails/history${qs({ page, limit: 20, q: q || undefined, status: statusFilter || undefined })}`),
    [page, q, statusFilter, refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  async function send(e: Email) {
    try {
      const res = await api.post<{ data: Email }>(`/api/emails/${e.id}/send`);
      if (res.data.status === 'SENT') {
        toast(
          'success',
          liveMode
            ? `Email sent to ${e.email_address}.`
            : `Email to ${e.email_address} recorded as sent (simulated mode — no provider configured).`
        );
      } else {
        toast('error', `Send failed: ${res.data.failure_reason ?? 'unknown provider error'}`);
      }
      refresh();
    } catch (err) {
      toast('error', (err as Error).message);
      refresh();
    }
  }

  return (
    <div>
      <PageHeader
        title="Email History"
        subtitle="Receipt emails and tenant correspondence prepared by the system"
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
              <strong>Live mode</strong> — email is delivered by{' '}
              {config.provider === 'brevo' ? 'Brevo' : 'SMTP'}.{' '}
              {config.autoSend
                ? 'Receipt emails are sent automatically the moment a payment is recorded.'
                : 'Auto-send is off (EMAIL_AUTO_SEND=false) — emails stay Pending until sent from this page.'}
            </span>
          ) : (
            <span>
              <strong>Simulated mode</strong> — sending is recorded in the history below but no email is actually delivered.{' '}
              {config.autoSend
                ? 'Receipt emails dispatch automatically when a payment is recorded.'
                : 'Auto-send is off (EMAIL_AUTO_SEND=false) — emails stay Pending until sent from this page.'}{' '}
              Set <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">EMAIL_PROVIDER=smtp</code> (or{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">brevo</code>) with credentials in{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">backend/.env</code> to go live.
            </span>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <TextInput placeholder="Search subject or recipient…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
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
                  <th>Created</th><th>Recipient</th><th>Tenant</th><th>Unit</th><th>Subject</th><th>Status</th><th>Attempts</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs text-gray-500">{formatDate(e.created_at)}</td>
                    <td className="text-xs">{e.email_address}</td>
                    <td className="font-medium">{e.tenant_name ?? <span className="text-xs text-gray-400">—</span>}</td>
                    <td>{e.unit_number ? `Unit ${e.unit_number}` : '—'}</td>
                    <td className="max-w-[280px]">
                      <button
                        className="truncate text-left text-xs text-gray-600 hover:text-brand-600"
                        title="View full email"
                        onClick={() => setViewEmail(e)}
                      >
                        {e.subject.length > 60 ? `${e.subject.slice(0, 60)}…` : e.subject}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={e.status} />
                      {(e.status === 'FAILED' || e.status === 'ERRONEOUS') && e.failure_reason && (
                        <div className="mt-1 max-w-[180px] text-[10px] text-red-500" title={e.failure_reason}>{e.failure_reason}</div>
                      )}
                    </td>
                    <td className="text-xs tabular-nums text-gray-700" title={e.next_retry_at ? `Automatic retry scheduled ${formatDate(e.next_retry_at)}` : undefined}>
                      {e.attempt_count}
                      {e.status === 'FAILED' && e.next_retry_at && (
                        <div className="text-[10px] text-gray-400">retry {formatDate(e.next_retry_at)}</div>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setViewEmail(e)}>View</Button>
                        {e.status === 'PENDING' && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => send(e)}>Send</Button>
                        )}
                        {(e.status === 'FAILED' || e.status === 'ERRONEOUS') && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => send(e)}>Send again</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No emails yet — they are created automatically whenever a payment is recorded." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={viewEmail !== null} title={viewEmail?.subject ?? ''} onClose={() => setViewEmail(null)}>
        {viewEmail && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span>
                To:{' '}
                <a href={`mailto:${viewEmail.email_address}`} className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
                  {viewEmail.email_address}
                </a>
              </span>
              <span>Created: {formatDate(viewEmail.created_at)}</span>
              {viewEmail.sent_at && <span>Sent: {formatDate(viewEmail.sent_at)}</span>}
            </div>
            <EmailBody html={viewEmail.body_html} />
            {viewEmail.provider_message_id && (
              <div className="text-xs text-gray-500">Provider reference: {viewEmail.provider_message_id}</div>
            )}
            {(viewEmail.status === 'FAILED' || viewEmail.status === 'ERRONEOUS') && viewEmail.failure_reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <strong>{viewEmail.status === 'ERRONEOUS' ? 'Permanent rejection:' : 'Delivery failed:'}</strong> {viewEmail.failure_reason}
                <div className="mt-1 text-red-600">
                  {viewEmail.status === 'ERRONEOUS' ? (
                    'The address itself was rejected — automatic retries will never attempt it. Fix the address and send again from here.'
                  ) : viewEmail.next_retry_at ? (
                    `Attempt ${viewEmail.attempt_count} — automatic retry scheduled ${formatDate(viewEmail.next_retry_at)}.`
                  ) : (
                    `Tried ${viewEmail.attempt_count} time${viewEmail.attempt_count === 1 ? '' : 's'} — automatic retries exhausted. You can still send it manually.`
                  )}
                </div>
              </div>
            )}
            {viewEmail.status !== 'SENT' && (
              <div className="flex justify-end">
                <Button onClick={() => { setViewEmail(null); send(viewEmail); }}>
                  {viewEmail.status === 'PENDING' ? 'Send Now' : 'Send Again'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
