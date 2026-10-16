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
import { Button, Select, ToastContext } from './ui';
import { api } from '../lib/api';

export type BulkAudience = 'ALL' | 'RENT' | 'WATER';

export interface BulkArrearsResponse {
  total: number;
  audience: BulkAudience;
  owing: number;
  queued: number;
  skippedPaid: number;
  skippedNoPhone: number;
  skippedOtherBill: number;
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
      const parts = [`${r.queued} queued`];
      if (r.skippedNoPhone > 0) parts.push(`${r.skippedNoPhone} skipped (no phone)`);
      if (r.skippedOtherBill > 0) parts.push(`${r.skippedOtherBill} ${meta.otherBill || 'owe another bill'} — skipped`);
      if (r.skippedPaid > 0) parts.push(`${r.skippedPaid} already cleared`);
      toast(
        'success',
        r.queued === 0
          ? `Nothing to remind — no tenant owes ${meta.bill}.`
          : `Reminders: ${parts.join(', ')}. ${r.autoSend ? 'Sending now.' : 'Auto-send is off — they wait as Pending on the SMS page.'}`
      );
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

  if (!showAudiencePicker) return button;

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
    </div>
  );
}
