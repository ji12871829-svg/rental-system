// One-click bulk arrears reminders — the operator's "remind everyone owing"
// button. One POST queues a personalised SMS for every ACTIVE tenant with
// money owing; each tenant's message matches their own bill (balance
// statement for rent debtors, water notice for water-only debtors). The
// audience picker narrows the blast to rent debtors or water debtors only —
// the server derives the audience from the live ledger, so a paid-up tenant
// can never be included by a stale client selection, and no recipient picking
// step exists. Rows auto-send when the SMS pipeline is on, otherwise they
// wait as PENDING on the SMS page.
import { useContext, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Modal, Select, ToastContext } from './ui';
import { api } from '../lib/api';

export type BulkAudience = 'ALL' | 'RENT' | 'WATER';

type BulkSkipReason = 'NO_PHONE' | 'PAID' | 'OTHER_BILL';

interface BulkSkippedTenant {
  tenantId: number;
  tenantName: string;
  unitNumber: string | null;
  reason: BulkSkipReason;
  bill: 'RENT' | 'WATER' | null;
}

export interface BulkArrearsResponse {
  total: number;
  audience: BulkAudience;
  owing: number;
  queued: number;
  skippedPaid: number;
  skippedNoPhone: number;
  skippedOtherBill: number;
  skipped: BulkSkippedTenant[];
  autoSend: boolean;
}

const AUDIENCE_META: Record<BulkAudience, { group: string; bill: string; otherBill: string }> = {
  ALL: { group: 'owing', bill: 'rent or water', otherBill: '' },
  RENT: { group: 'owing rent', bill: 'rent', otherBill: 'owe only water' },
  WATER: { group: 'owing water', bill: 'water', otherBill: 'owe only rent' },
};

interface BulkReminderButtonProps {
  /** Outstanding count for the whole ledger — the ALL audience label. */
  owingCount?: number | null;
  /** Per-bill counts for the picker labels, when the parent knows them. */
  audienceCounts?: { rent: number; water: number } | null;
  defaultAudience?: BulkAudience;
  /** Show the All / Rent / Water audience picker beside the button. */
  showAudiencePicker?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  /** Refresh parent lists after a successful send. */
  onSent?: (result: BulkArrearsResponse) => void;
}

/** Human reason per skipped tenant for the breakdown modal. */
function skipReasonText(s: BulkSkippedTenant): string {
  if (s.reason === 'NO_PHONE') return 'No phone number';
  if (s.reason === 'PAID') return 'Already cleared';
  return s.bill === 'WATER' ? 'Owes only water' : 'Owes only rent';
}

export function BulkReminderButton({
  owingCount,
  audienceCounts,
  defaultAudience = 'ALL',
  showAudiencePicker = false,
  variant = 'primary',
  className = '',
  onSent,
}: BulkReminderButtonProps) {
  // Optional toast: the production app always provides one (main.tsx), but
  // the button must never crash a provider-less render — sending still works,
  // only the pop-up degrades.
  const toastCtx = useContext(ToastContext);
  const toast = toastCtx?.toast ?? (() => {});
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<BulkAudience>(defaultAudience);
  const [report, setReport] = useState<BulkArrearsResponse | null>(null);

  const countFor = (a: BulkAudience): number | null | undefined =>
    a === 'ALL' ? owingCount : a === 'RENT' ? audienceCounts?.rent : audienceCounts?.water;
  const count = countFor(audience);
  const meta = AUDIENCE_META[audience];

  const label =
    count === null || count === undefined
      ? `Remind ${meta.group}`
      : count === 0
        ? `Nobody owes ${meta.bill} — nothing to send`
        : `Remind ${count} ${meta.group}`;

  async function send() {
    if (busy) return;
    // One click sends — the label already names the audience, so no picker.
    // A native confirm guards the wallet: bulk SMS spends real credit.
    if (count !== undefined && count !== null && count > 0) {
      const ok = window.confirm(
        `Send a payment-reminder SMS to ${count} tenant${count === 1 ? '' : 's'} ${meta.group}? ` +
          `Each message quotes the tenant's own live ${meta.bill} balance.` +
          (audience === 'ALL'
            ? ''
            : ` Tenants who ${meta.otherBill} are skipped.`)
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: BulkArrearsResponse }>('/api/sms/reminders/bulk-arrears', { audience });
      const r = res.data;
      const skippedCount = r.skipped?.length ?? 0;
      toast(
        'success',
        r.queued === 0
          ? `Nothing to remind — no tenant owes ${meta.bill}.`
          : `${r.queued} reminder${r.queued === 1 ? '' : 's'} queued${skippedCount > 0 ? `, ${skippedCount} skipped — details below` : ''}. ${r.autoSend ? 'Sending now.' : 'Auto-send is off — they wait as Pending on the SMS page.'}`
      );
      setReport(r);
      onSent?.(r);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const button = (
    <Button
      variant={variant}
      onClick={send}
      loading={busy}
      disabled={busy || count === 0}
      className={className}
      title={`Send a personalised ${meta.bill} reminder SMS to every tenant ${meta.group}`}
    >
      <Send size={15} strokeWidth={1.75} aria-hidden />
      {busy ? 'Sending…' : label}
    </Button>
  );

  if (!showAudiencePicker) return (
    <>
      {button}
      <SkippedReportModal report={report} onClose={() => setReport(null)} />
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={audience}
        onChange={(e) => setAudience(e.target.value as BulkAudience)}
        aria-label="Reminder audience"
        className="w-40"
      >
        <option value="ALL">
          {owingCount === null || owingCount === undefined ? 'Everyone owing' : `Everyone owing (${owingCount})`}
        </option>
        <option value="RENT">
          {audienceCounts ? `Rent owing (${audienceCounts.rent})` : 'Rent owing'}
        </option>
        <option value="WATER">
          {audienceCounts ? `Water owing (${audienceCounts.water})` : 'Water owing'}
        </option>
      </Select>
      {button}
      <SkippedReportModal report={report} onClose={() => setReport(null)} />
    </div>
  );
}

/** Post-send breakdown: who got reminded and exactly who was skipped and why. */
function SkippedReportModal({ report, onClose }: { report: BulkArrearsResponse | null; onClose: () => void }) {
  if (!report) return null;
  const skipped = report.skipped ?? [];
  return (
    <Modal open title={`Bulk reminders — ${report.queued} queued`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          {report.queued === 0
            ? 'Nobody was reminded.'
            : `${report.queued} tenant${report.queued === 1 ? '' : 's'} got a personalised reminder. `}
          {report.autoSend ? 'Sending now.' : 'They wait as Pending on the SMS page.'}
        </p>
        {skipped.length > 0 ? (
          <div>
            <h3 className="mb-1 font-semibold text-gray-900">
              Skipped ({skipped.length})
            </h3>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {skipped.map((s) => (
                <li key={s.tenantId} className="flex items-baseline justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-900">
                      {s.tenantName}{s.unitNumber ? ` · Unit ${s.unitNumber}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">{skipReasonText(s)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-gray-500">Nobody was skipped — every owing tenant was reminded.</p>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
