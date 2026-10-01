// Per-identity activity feed: the lifecycle of one Clerk identity, pulled
// from the audit trail (GET /api/webhooks/clerk/signups/:id/history) and
// rendered newest-first. Each entry shows the action, the flavor (new_value
// .event for unlinks), the actor (the admin who linked, "system" for webhook
// decisions), and the claimed email. A dedicated component so the page stays
// readable and the timeline is unit-testable.
import { Modal, useFetch } from './ui';
import { api } from '../lib/api';

export interface ClerkSignupRow {
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

interface HistoryRow {
  id: number;
  action: string;
  user_id: number | null;
  user_name: string | null;
  created_at: string;
  new_value: { event?: string; email?: string; reason?: string; old_email?: string; new_email?: string } & Record<string, unknown>;
}

const FLAVOR_LABELS: Record<string, string> = {
  'user.deleted': 'Clerk account deleted',
  account_deleted: 'staff user deleted',
  email_mismatch: 'verified email stopped matching',
};

function describe(row: HistoryRow): string {
  const v = row.new_value ?? {};
  switch (row.action) {
    case 'CLERK_LINK_REFUSED':
      return `Webhook could not map${v.reason ? ` — ${v.reason}` : ''}`;
    case 'CLERK_LINKED':
      return v.event === 'admin_link' ? 'Mapping created by an admin' : 'Mapped automatically by the webhook';
    case 'CLERK_UNLINKED': {
      const flavor = FLAVOR_LABELS[v.event ?? ''] ?? 'Mapping removed';
      const extra = v.event === 'email_mismatch' && v.old_email && v.new_email ? ` (${v.old_email} → ${v.new_email})` : '';
      return `${flavor}${extra}`;
    }
    default:
      return JSON.stringify(v);
  }
}

const DOT_TONE: Record<string, string> = {
  CLERK_LINKED: 'bg-emerald-500',
  CLERK_LINK_REFUSED: 'bg-amber-500',
  CLERK_UNLINKED: 'bg-red-500',
};

function TimelineList({ entries }: { entries: HistoryRow[] }) {
  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${DOT_TONE[e.action] ?? 'bg-gray-400'}`} aria-hidden />
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900">{e.action}</div>
            <div className="text-xs text-gray-500">
              {new Date(e.created_at).toLocaleString()} · {e.user_name ?? 'system'}
            </div>
            <div className="text-sm text-gray-700">{describe(e)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ClerkSignupHistory({ row, onClose }: { row: ClerkSignupRow | null; onClose: () => void }) {
  // The fetcher no-ops while no row is open, so useFetch never fires a
  // doomed request; the modal only renders once a row is selected.
  const { data, loading, error } = useFetch(
    () => (row ? api.get<{ data: HistoryRow[] }>(`/api/webhooks/clerk/signups/${encodeURIComponent(row.external_id)}/history`) : Promise.resolve(undefined)),
    [row?.external_id],
  );
  const entries = data?.data ?? [];

  return (
    <Modal open={row !== null} title={row ? `History — ${row.email ?? row.external_id}` : ''} onClose={onClose}>
      {loading && <div className="p-4 text-sm text-gray-500">Loading…</div>}
      {error && <div className="p-4 text-sm text-red-600">{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <div className="p-4 text-sm text-gray-500">No lifecycle events recorded for this identity yet.</div>
      )}
      {entries.length > 0 && <TimelineList entries={entries} />}
    </Modal>
  );
}
