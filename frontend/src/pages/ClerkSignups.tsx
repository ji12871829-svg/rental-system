// Admin review of Clerk sign-ups the webhook could not auto-map. Every
// CLERK_LINK_REFUSED the webhook wrote shows up here exactly once, with the
// claimed email, the reason, how many times it recurred — and a one-click
// fix: link the Clerk identity to the right staff user, so the next sign-in
// goes through the Clerk card instead of silently falling back to passwords.
import { useState } from 'react';
import { Button, EmptyState, Modal, PageHeader, Select, useFetch } from '../components/ui';
import { Count } from '../components/CountUp';
import { ClerkSignupHistory } from '../components/ClerkSignupHistory';
import { api } from '../lib/api';

interface ClerkSignupRow {
  external_id: string;
  email: string | null;
  reason: string;
  refused_at: string;
  refusals: number;
  linked_user_id: number | null;
  linked_user_name: string | null;
  linked_user_email: string | null;
  linked_at: string | null;
}

// LOGIN vs LOGIN_CLERK over the last 30 days — the adoption signal.
interface RecentLogins {
  total: number;
  clerk: number;
}

interface SignupsResponse {
  data: { signups: ClerkSignupRow[]; recentLogins: RecentLogins };
}

interface StaffOption {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
}

// Same role set the webhook auto-links (LINKABLE_ROLES on the backend).
const LINKABLE_ROLES = new Set(['ADMIN', 'PROPERTY_MANAGER', 'STAFF']);

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export default function ClerkSignups() {
  const { data, loading, error, refresh } = useFetch(
    () => api.get<SignupsResponse>('/api/webhooks/clerk/signups'),
    [],
  );

  const [linking, setLinking] = useState<ClerkSignupRow | null>(null);
  const [viewing, setViewing] = useState<ClerkSignupRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = data?.data.signups ?? [];
  const logins = data?.data.recentLogins;
  const pending = rows.filter((r) => r.linked_user_id === null);
  const linked = rows.filter((r) => r.linked_user_id !== null);

  return (
    <div>
      <PageHeader
        title="Clerk Sign-ups"
        subtitle="Sign-ups the webhook could not map automatically — link them by hand so they stop falling back to passwords"
      />

      {notice && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{notice}</div>}

      {logins && logins.total > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
            <span className="font-semibold text-gray-900">Last 30 days</span>
            <span>
              <span className="font-semibold text-gray-900"><Count value={logins.total} /></span> staff sign-ins
            </span>
            <span>
              <span className="font-semibold text-brand-700"><Count value={logins.clerk} /></span> via Clerk ({Math.round((logins.clerk / logins.total) * 100)}%)
            </span>
            <span className="h-2 w-40 overflow-hidden rounded-full bg-gray-100" aria-hidden>
              <span
                className="block h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${Math.min(100, (logins.clerk / logins.total) * 100)}%` }}
              />
            </span>
          </div>
        </div>
      )}

      {loading && <div className="p-6 text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && (
        <>
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState message="No refused Clerk sign-ups — every sign-up with a verified email matching an ACTIVE staff user mapped automatically." />
            </div>
          ) : (
            <>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Pending — not mapped ({pending.length})
              </h2>
              <div className="table-scroll mb-8">
                <table>
                  <thead>
                    <tr>
                      <th>Claimed email</th><th>Clerk ID</th><th>Reason</th><th>Last attempt</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.external_id}>
                        <td className="font-medium">{r.email ?? <span className="text-gray-400">(none verified)</span>}</td>
                        <td className="max-w-[16rem] truncate text-xs text-gray-500">{r.external_id}</td>
                        <td className="text-xs">
                          <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
                            r.reason === 'no verified email' ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {r.reason}
                          </span>
                          {r.refusals > 1 && <span className="ml-2 text-xs text-gray-400">×{r.refusals} attempts</span>}
                        </td>
                        <td className="whitespace-nowrap text-xs text-gray-500">{when(r.refused_at)}</td>
                        <td className="space-x-1 whitespace-nowrap">
                          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setLinking(r)}>
                            Link to staff user…
                          </Button>
                          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setViewing(r)}>
                            History
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {pending.length === 0 && (
                      <tr><td colSpan={6} className="p-4 text-sm text-gray-500">Nothing pending — every refused sign-up has since been linked.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {linked.length > 0 && (
                <>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Since linked ({linked.length})
                  </h2>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr><th>Claimed email</th><th>Linked staff user</th><th>Linked when</th></tr>
                      </thead>
                      <tbody>
                        {linked.map((r) => (
                          <tr key={r.external_id}>
                            <td className="font-medium">{r.email ?? <span className="text-gray-400">(none verified)</span>}</td>
                            <td className="text-sm">
                              {r.linked_user_name}
                              <span className="ml-2 text-xs text-gray-500">{r.linked_user_email}</span>
                            </td>
                            <td className="whitespace-nowrap text-xs text-gray-500">{when(r.linked_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      <LinkModal
        row={linking}
        onClose={() => setLinking(null)}
        onLinked={async (msg) => {
          setNotice(msg);
          setLinking(null);
          refresh();
        }}
      />
      <ClerkSignupHistory row={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function LinkModal({
  row,
  onClose,
  onLinked,
}: {
  row: ClerkSignupRow | null;
  onClose: () => void;
  onLinked: (msg: string) => Promise<void>;
}) {
  const { data: staff } = useFetch(
    () => (row ? api.get<{ data: StaffOption[] }>('/api/users') : Promise.resolve(undefined)),
    [row?.external_id],
  );
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (staff?.data ?? []).filter(
    (u) => u.status === 'ACTIVE' && LINKABLE_ROLES.has(u.role),
  );
  const selected = options.find((u) => String(u.id) === userId);

  async function submit() {
    if (!row || !selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/webhooks/clerk/signups/${encodeURIComponent(row.external_id)}/link`, {
        userId: selected.id,
        refusalReason: row.reason,
      });
      await onLinked(`${row.email ?? row.external_id} linked to ${selected.name} — their next Clerk sign-in will work.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Linking failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={row !== null} title="Link Clerk sign-up to a staff user" onClose={onClose}>
      {row && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Claimed email</div>
              <div className="font-medium text-gray-800">{row.email ?? '(none verified)'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-400">Refusal reason</div>
              <div className="font-medium text-gray-800">{row.reason}</div>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-gray-400">Staff user to link</div>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full">
              <option value="">Choose an ACTIVE staff user…</option>
              {options.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email} ({u.role})
                </option>
              ))}
            </Select>
            {selected && (
              <p className="mt-2 text-xs text-gray-500">
                The Clerk identity <span className="font-mono">{row.external_id}</span> will be mapped to{' '}
                <span className="font-medium">{selected.name}</span>
                {row.email && selected.email.toLowerCase() === row.email.toLowerCase()
                  ? ' — their emails match now.'
                  : ` (${selected.email}). They can change their email in Clerk later; the mapping stays.`}
              </p>
            )}
          </div>
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={submit} disabled={!selected || busy}>
              {busy ? 'Linking…' : 'Create mapping'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
