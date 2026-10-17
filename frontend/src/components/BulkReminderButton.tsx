// One-click bulk arrears reminders — one button per bill. Each button POSTs
// one audience (everyone owing, rent debtors, or water debtors) and the
// server queues a personalised SMS per tenant, each message matching its own
// bill. The server derives the audience from the live ledger, so a paid-up
// tenant can never be included by a stale client selection, and no recipient
// picking step exists. Rows auto-send when the SMS pipeline is on, otherwise
// they wait as PENDING on the SMS page.
import { useContext, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Modal, ToastContext } from './ui';
import { api } from '../lib/api';

type BulkAudience = 'ALL' | 'RENT' | 'WATER';

type BulkSkipReason = 'NO_PHONE' | 'PAID' | 'OTHER_BILL' | 'ALREADY_REMINDed';

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
  skippedAlreadyReminded: number;
  skipped: BulkSkippedTenant[];
  autoSend: boolean;
}

const AUDIENCE_META: Record<BulkAudience, { group: string; bill: string; otherBill: string }> = {
  ALL: { group: 'owing', bill: 'rent or water', otherBill: '' },
  RENT: { group: 'owing rent', bill: 'rent', otherBill: 'owe only water' },
  WATER: { group: 'owing water', bill: 'water', otherBill: 'owe only rent' },
};

interface BulkReminderButtonProps {
  /** Which bill this button reminds. Defaults to everyone owing. */
  audience?: BulkAudience;
  /** Owing count for this button's audience — names it in the label. */
  owingCount?: number | null;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  /** Refresh parent lists after a successful send. */
  onSent?: (result: BulkArrearsResponse) => void;
}

/** Human reason per skipped tenant for the breakdown modal. */
function skipReasonText(s: BulkSkippedTenant): string {
  if (s.reason === 'NO_PHONE') return 'No phone number';
  if (s.reason === 'PAID') return 'Already cleared';
  if (s.reason === 'ALREADY_REMINDed') return 'Already reminded 3 times this month';
  return s.bill === 'WATER' ? 'Owes only water' : 'Owes only rent';
}

export function BulkReminderButton({
  audience = 'ALL',
  owingCount,
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
  const [report, setReport] = useState<BulkArrearsResponse | null>(null);

  const meta = AUDIENCE_META[audience];

  const label =
    owingCount === null || owingCount === undefined
      ? `Remind ${meta.group}`
      : owingCount === 0
        ? `Nobody owes ${meta.bill} — nothing to send`
        : `Remind ${owingCount} ${meta.group}`;

  async function send() {
    if (busy) return;
    // One click sends — the label already names the audience.
    // A native confirm guards the wallet: bulk SMS spends real credit.
    if (owingCount !== undefined && owingCount !== null && owingCount > 0) {
      const ok = window.confirm(
        `Send a payment-reminder SMS to ${owingCount} tenant${owingCount === 1 ? '' : 's'} ${meta.group}? ` +
          `Each message quotes the tenant's own live ${meta.bill} balance.` +
          (audience === 'ALL'
            ? ' Tenants already reminded 3 times this month are skipped.'
            : ` Tenants who ${meta.otherBill} are skipped, and tenants already reminded 3 times this month are skipped.`)
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: BulkArrearsResponse }>('/api/sms/reminders/bulk-arrears', { audience });
      const r = res.data;
      const skippedCount = r.skipped?.length ?? 0;
      const already = r.skippedAlreadyReminded ?? 0;
      toast(
        'success',
        r.queued === 0
          ? already > 0
            ? `Nothing new sent — everyone owing was already reminded 3 times this month (${already} skipped).`
            : `Nothing to remind — no tenant owes ${meta.bill}.`
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

  return (
    <>
      <Button
        variant={variant}
        onClick={send}
        loading={busy}
        disabled={busy || owingCount === 0}
        className={className}
        title={`Send a personalised ${meta.bill} reminder SMS to every tenant ${meta.group}`}
      >
        <Send size={15} strokeWidth={1.75} aria-hidden />
        {busy ? 'Sending…' : label}
      </Button>
      <SkippedReportModal report={report} onClose={() => setReport(null)} />
    </>
  );
}

interface BulkBillReminderButtonsProps {
  /** Owing counts per bill for the two labels. Unknown while loading. */
  rentCount?: number | null;
  waterCount?: number | null;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Refresh parent lists after a successful send. */
  onSent?: (result: BulkArrearsResponse) => void;
}

/** The per-bill pair: one button reminding rent debtors, one for water
 * debtors. Each sends only its own audience in a single click. */
export function BulkBillReminderButtons({ rentCount, waterCount, variant = 'primary', onSent }: BulkBillReminderButtonsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <BulkReminderButton audience="RENT" owingCount={rentCount} variant={variant} onSent={onSent} />
      <BulkReminderButton audience="WATER" owingCount={waterCount} variant={variant} onSent={onSent} />
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
