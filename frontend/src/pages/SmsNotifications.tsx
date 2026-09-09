import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Button, EmptyState, Modal, PageHeader, Pagination, Select, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate } from '../lib/format';

interface Sms {
  id: number;
  receipt_id: number | null;
  tenant_id: number;
  phone_number: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  provider_message_id: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  provider_cost: string | null;
  provider_currency: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  // Delivery-report outcome (Africa's Talking callback): DELIVERED once the
  // handset confirms receipt, FAILED_ON_NETWORK on operator-reported failure.
  delivery_status: 'DELIVERED' | 'FAILED_ON_NETWORK' | null;
  delivery_network: string | null;
  delivery_updated_at: string | null;
  created_at: string;
  tenant_name: string;
  unit_number: string | null;
}

interface SpendByCurrency {
  currency: string;
  total: number;
}

interface SmsConfigInfo {
  provider: 'mock' | 'africastalking' | 'twilio';
  live: boolean;
  senderId?: string;
  autoSend: boolean;
}

type BalanceStatus =
  | { state: 'unknown'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'ok' | 'low' | 'empty'; balance: { amount: number; currency: string }; threshold: number | null };

// The SMS body is plain text, but the history modal is a digital copy —
// render phone numbers and emails inside it as tappable tel:/mailto: links.
function SmsBody({ message }: { message: string }) {
  const parts = message.split(/((?:\+?\d[\d -]{8,}\d)|[\w.+-]+@[\w-]+\.[\w.-]+)/g);
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(part)) {
          return (
            <a key={i} href={`mailto:${part}`} className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
              {part}
            </a>
          );
        }
        if (/^\+?\d[\d -]{8,}\d$/.test(part)) {
          return (
            <a key={i} href={`tel:${part.replace(/[^+\d]/g, '')}`} className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
              {part}
            </a>
          );
        }
        return part;
      })}
    </div>
  );
}

export default function SmsNotifications() {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [viewMessage, setViewMessage] = useState<Sms | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // api.get resolves with the response body { data: ... } — unwrap to the
  // actual config. (Reading the body directly was a latent bug: every
  // config.* field was undefined, which only became visible when autoSend
  // — the first truthy-by-default field — was added.)
  const { data: configResponse } = useFetch<{ data: SmsConfigInfo }>(() => api.get('/api/sms/config'), [refreshKey]);
  const config = configResponse?.data;
  const liveMode = config?.live === true;

  // Provider wallet balance — drives the low-credit warning banner. Only
  // meaningful in live Africa's Talking mode; every other state renders nothing.
  const { data: balanceResponse } = useFetch<{ data: BalanceStatus }>(() => api.get('/api/sms/balance'), [refreshKey]);
  const balanceStatus = balanceResponse?.data;
  const lowBalance = balanceStatus && (balanceStatus.state === 'low' || balanceStatus.state === 'empty')
    ? balanceStatus
    : null;

  const { data, loading, error } = useFetch(
    () => api.list<Sms>(`/api/sms/history${qs({ page, limit: 20, q: q || undefined, status: statusFilter || undefined })}`),
    [page, q, statusFilter, refreshKey]
  );
  const spend = (data?.meta?.spendByCurrency ?? []) as SpendByCurrency[];

  const refresh = () => setRefreshKey((k) => k + 1);

  async function send(s: Sms) {
    try {
      const res = await api.post<{ data: Sms }>(`/api/sms/${s.id}/send`);
      if (res.data.status === 'SENT') {
        toast(
          'success',
          liveMode
            ? `Message sent to ${s.tenant_name}.`
            : `Message to ${s.tenant_name} recorded as sent (simulated mode — no provider configured).`
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
        title="SMS Notifications"
        subtitle="Receipt messages prepared automatically for every payment"
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
              <strong>Live mode</strong> — messages are delivered by{' '}
              {config.provider === 'twilio' ? 'Twilio' : "Africa's Talking"}
              {config.senderId ? ` using sender “${config.senderId}”` : ''}.{' '}
              {config.autoSend
                ? 'Receipt SMS are sent automatically the moment a payment is recorded.'
                : 'Auto-send is off (SMS_AUTO_SEND=false) — messages stay Pending until sent from this page.'}
            </span>
          ) : (
            <span>
              <strong>Simulated mode</strong> — sending is recorded in the history below but no SMS is actually delivered.{' '}
              {config.autoSend
                ? 'Receipt messages dispatch automatically when a payment is recorded.'
                : 'Auto-send is off (SMS_AUTO_SEND=false) — messages stay Pending until sent from this page.'}{' '}
              Set <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">SMS_PROVIDER=africastalking</code> with credentials in{' '}
              <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">backend/.env</code> to go live.
            </span>
          )}
        </div>
      )}

      {lowBalance && (() => {
        const b = lowBalance.balance;
        const empty = lowBalance.state === 'empty';
        return (
          <div
            role="alert"
            className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
              empty
                ? 'border-red-300 bg-red-50 text-red-800'
                : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}
          >
            <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              <strong>{empty ? 'SMS balance depleted' : 'Low SMS balance'}</strong> — your {' '}
              {config?.provider === 'twilio' ? 'Twilio' : "Africa's Talking"} wallet is at{' '}
              <strong className="tabular-nums">{b.currency} {b.amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</strong>.
              {' '}{empty ? 'Messages will fail to send until the wallet is topped up.' : 'Top up soon to keep receipt delivery working.'}
              {lowBalance.threshold !== null && (
                <span className="block text-xs mt-0.5 opacity-80">
                  Warning threshold: {b.currency} {lowBalance.threshold.toLocaleString('en-KE')} (SMS_LOW_BALANCE_THRESHOLD in backend/.env).
                </span>
              )}
            </span>
          </div>
        );
      })()}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <TextInput placeholder="Search message or tenant…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </Select>
        </div>
        {spend.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm">
            <span className="text-gray-500">Total SMS spend</span>{' '}
            <strong className="tabular-nums text-gray-900">
              {spend.map((s) => `${s.currency} ${s.total.toFixed(2)}`).join(' · ')}
            </strong>
          </div>
        ) : (
          !loading &&
          data && <span className="text-xs text-gray-400">No provider costs recorded — simulated sends are free.</span>
        )}
      </div>

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Created</th><th>Tenant</th><th>Unit</th><th>Phone</th><th>Message</th><th>Status</th><th>Delivery</th><th>Cost</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id}>
                    <td className="text-xs text-gray-500">{formatDate(s.created_at)}</td>
                    <td className="font-medium">{s.tenant_name}</td>
                    <td>{s.unit_number ? `Unit ${s.unit_number}` : '—'}</td>
                    <td className="text-xs">{s.phone_number}</td>
                    <td className="max-w-[280px]">
                      <button
                        className="truncate text-left text-xs text-gray-600 hover:text-brand-600"
                        title="View full message"
                        onClick={() => setViewMessage(s)}
                      >
                        {s.message.length > 80 ? `${s.message.slice(0, 80)}…` : s.message}
                      </button>
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                      {s.status === 'FAILED' && s.failure_reason && (
                        <div className="mt-1 max-w-[180px] text-[10px] text-red-500" title={s.failure_reason}>{s.failure_reason}</div>
                      )}
                    </td>
                    <td>
                      {s.delivery_status ? (
                        <StatusBadge status={s.delivery_status} />
                      ) : s.status === 'SENT' ? (
                        <span className="text-xs text-gray-400" title="No delivery report received yet">—</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                      {s.delivery_network && (
                        <div className="mt-1 text-[10px] text-gray-400" title={`Network code ${s.delivery_network}`}>{s.delivery_network}</div>
                      )}
                    </td>
                    <td className="text-xs tabular-nums text-gray-700">
                      {s.provider_cost !== null && s.provider_currency ? `${s.provider_currency} ${Number(s.provider_cost).toFixed(2)}` : '—'}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setViewMessage(s)}>View</Button>
                        {s.status === 'PENDING' && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs text-emerald-700" onClick={() => send(s)}>Send</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No SMS messages — they are created automatically whenever a payment is recorded." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <Modal open={viewMessage !== null} title={`SMS to ${viewMessage?.tenant_name ?? ''}`} onClose={() => setViewMessage(null)}>
        {viewMessage && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              <span>
                To:{' '}
                <a href={`tel:${viewMessage.phone_number.replace(/[^+\d]/g, '')}`} className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
                  {viewMessage.phone_number}
                </a>
              </span>
              <span>Created: {formatDate(viewMessage.created_at)}</span>
              {viewMessage.sent_at && <span>Sent: {formatDate(viewMessage.sent_at)}</span>}
              {viewMessage.delivery_status && (
                <span>
                  Delivery: <StatusBadge status={viewMessage.delivery_status} />
                  {viewMessage.delivery_updated_at ? ` · ${formatDate(viewMessage.delivery_updated_at)}` : ''}
                  {viewMessage.delivery_network ? ` · network ${viewMessage.delivery_network}` : ''}
                </span>
              )}
            </div>
            <SmsBody message={viewMessage.message} />
            {viewMessage.provider_message_id && (
              <div className="text-xs text-gray-500">Provider reference: {viewMessage.provider_message_id}</div>
            )}
            {viewMessage.provider_cost !== null && viewMessage.provider_currency && (
              <div className="text-xs text-gray-500">
                Cost: <span className="tabular-nums text-gray-700">{viewMessage.provider_currency} {Number(viewMessage.provider_cost).toFixed(2)}</span>{' '}(provider-reported)
              </div>
            )}
            {viewMessage.status === 'FAILED' && viewMessage.failure_reason && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <strong>Delivery failed:</strong> {viewMessage.failure_reason}
                <div className="mt-1 text-red-600">
                  {viewMessage.next_retry_at
                    ? `Attempt ${viewMessage.attempt_count} — automatic retry scheduled ${formatDate(viewMessage.next_retry_at)}.`
                    : `Tried ${viewMessage.attempt_count} time${viewMessage.attempt_count === 1 ? '' : 's'} — automatic retries exhausted. You can still send it manually.`}
                </div>
              </div>
            )}
            {viewMessage.status === 'PENDING' && (
              <div className="flex justify-end">
                <Button onClick={() => { setViewMessage(null); send(viewMessage); }}>Send Now</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
