// One-click bulk arrears reminders — the operator's "remind everyone owing"
// button. One POST queues a personalised BALANCE_DUE SMS (live rent + water
// figures per tenant) for EVERY ACTIVE tenant with an outstanding balance.
// No recipient picking, no second step: rows auto-send when the SMS pipeline
// is on, otherwise they wait as PENDING on the SMS page.
import { useContext, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, ToastContext } from './ui';
import { api } from '../lib/api';

export interface BulkArrearsResponse {
  total: number;
  owing: number;
  queued: number;
  skippedPaid: number;
  skippedNoPhone: number;
  autoSend: boolean;
}

interface BulkReminderButtonProps {
  /** Outstanding count for the label — when known, the button names it. */
  owingCount?: number | null;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  /** Refresh parent lists after a successful send. */
  onSent?: (result: BulkArrearsResponse) => void;
}

export function BulkReminderButton({ owingCount, variant = 'primary', className = '', onSent }: BulkReminderButtonProps) {
  // Optional toast: the production app always provides one (main.tsx), but
  // the button must never crash a provider-less render — sending still works,
  // only the pop-up degrades.
  const toastCtx = useContext(ToastContext);
  const toast = toastCtx?.toast ?? (() => {});
  const [busy, setBusy] = useState(false);

  const label = owingCount === null || owingCount === undefined
    ? 'Remind all owing'
    : owingCount === 0
      ? 'Nobody owes — nothing to send'
      : `Remind ${owingCount} owing`;

  async function send() {
    if (busy) return;
    // One click sends — the label already names the audience, so no picker.
    // A native confirm guards the wallet: bulk SMS spends real credit.
    if (owingCount !== undefined && owingCount !== null && owingCount > 0) {
      const ok = window.confirm(
        `Send a payment-reminder SMS to ${owingCount} tenant${owingCount === 1 ? '' : 's'} with an outstanding rent or water balance? Each message quotes the tenant's own live balance.`
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ data: BulkArrearsResponse }>('/api/sms/reminders/bulk-arrears');
      const r = res.data;
      const parts = [`${r.queued} queued`];
      if (r.skippedNoPhone > 0) parts.push(`${r.skippedNoPhone} skipped (no phone)`);
      if (r.skippedPaid > 0) parts.push(`${r.skippedPaid} already cleared`);
      toast(
        'success',
        r.queued === 0
          ? `Nothing to remind — no tenant owes rent or water.`
          : `Reminders: ${parts.join(', ')}. ${r.autoSend ? 'Sending now.' : 'Auto-send is off — they wait as Pending on the SMS page.'}`
      );
      onSent?.(r);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} onClick={send} loading={busy} disabled={busy || owingCount === 0} className={className} title="Send a personalised balance SMS to every tenant owing rent or water">
      <Send size={15} strokeWidth={1.75} aria-hidden />
      {busy ? 'Sending…' : label}
    </Button>
  );
}
