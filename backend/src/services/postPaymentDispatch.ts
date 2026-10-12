// Post-payment dispatch — one seam for the two channels a payment records.
//
// The payment flows (rent, water, and the M-Pesa paths that reuse them) used
// to call the SMS and email channels by hand, duplicating the gating, the
// in-transaction preparation and the post-commit timing. This module owns
// that orchestration: hand it the freshly minted receipt and it prepares both
// notifications on the caller's transaction, returning a `dispatch` closure
// the flow calls once the transaction has committed.
//
// Rules (each previously duplicated per flow, now single-sourced):
//
//   - Preparation happens INSIDE the payment transaction, on the caller's SQL
//     executor (`exec`): the receipt row was minted moments ago in that same
//     transaction, so a pool connection cannot see it yet. A crash right
//     after commit can therefore never lose a prepared notification — the
//     PENDING rows are already durable when the payment becomes visible.
//   - Dispatch happens strictly AFTER the commit, via the returned closure.
//     `dispatchAfterCommit` (Outbound Message module) is fire-and-forget: the
//     HTTP response never waits on a provider, and a provider outage can
//     never fail a recorded payment.
//   - The email row is prepared only when the EMAIL channel's auto-send is on
//     and the receipt kind carries tenant-facing money facts (RENT or
//     COMBINED). A blank or invalid recipient degrades to a "not queued"
//     fact, never an error — a payment must not fail because a tenant has no
//     address on file. The Outbound Email module's queueEmail rejects blank
//     and invalid recipients with a 400; the seam turns that into the fact's
//     reason (and skips composing the row entirely for a blank address).
//   - Failed sends leave FAILED rows carrying the provider's reason; the
//     retry jobs (smsRetryJob / emailRetryJob) and the manual "send again"
//     actions take it from there. The payment itself stays untouched.
import { pool, type SqlExec } from '../config/db';
import { autoSendEnabled as channelAutoSendEnabled, dispatchAfterCommit } from './outboundMessage';
import {
  dispatchAutoSend,
  prepareForReceipt as prepareSmsReceipt,
  type ReceiptLike,
} from './smsService';
import { prepareForReceipt as prepareEmailReceipt, sendEmailNotification } from './emailService';
import { HttpError } from '../utils/httpError';

// One channel's receipt-delivery fact: exactly what the audit entry and the
// API response report about that channel. The seam computes these from what
// it actually did — the persist points' outcomes and the gate state at the
// moment of preparation — so nothing downstream re-derives them and the audit
// trail and the API response can never drift from each other, from another
// flow's report, or from what was really persisted.
// Module-internal shapes (un-exported: knip flags exports nothing outside
// this file imports; consumers see them through PreparedNotifications).
interface SmsDeliveryFact {
  /** A PENDING sms_notifications row exists for this receipt. */
  queued: boolean;
  /** Whether the post-commit auto-dispatch will fire (gate state at prepare time). */
  autoSend: boolean;
}

interface EmailDeliveryFact {
  /** A PENDING email_notifications row exists for this receipt. */
  queued: boolean;
  /** Whether the post-commit auto-dispatch will fire (gate state at prepare time). */
  autoSend: boolean;
  /**
   * Why nothing was queued beyond the auto-send choice: 'no email on file',
   * or the address-level refusal queueEmail raised (verbatim). null when a
   * row was queued, when auto-send is simply off, or when the receipt kind is
   * never emailed (WATER) — nothing was skipped, so there is nothing to blame.
   */
  reason: string | null;
}

export interface PreparedNotifications {
  /** The SMS delivery fact, as prepared on the caller's transaction. */
  sms: SmsDeliveryFact;
  /** The email delivery fact, as prepared (or honestly skipped) on it. */
  email: EmailDeliveryFact;
  /**
   * Fire-and-forget dispatch of both prepared channels through the Outbound
   * Message module's post-commit seam. Call exactly once, after the caller's
   * transaction has committed — never inside it.
   */
  dispatch: () => void;
}

// The single call every payment flow makes inside its transaction. Returns
// the delivery facts (what was actually prepared, and why anything wasn't —
// the same objects the flow reports in its audit entry and API response) and
// HOW to dispatch what was prepared (for the moment after commit).
export async function notifyPaymentRecorded(
  receipt: ReceiptLike,
  exec: SqlExec = pool,
): Promise<PreparedNotifications> {
  const smsId = await prepareSmsReceipt(receipt, exec);
  const sms: SmsDeliveryFact = {
    queued: smsId != null,
    autoSend: channelAutoSendEnabled('SMS'),
  };

  let emailId: number | null = null;
  let email: EmailDeliveryFact = {
    queued: false,
    autoSend: channelAutoSendEnabled('EMAIL'),
    reason: null,
  };
  if (receipt.receipt_type === 'RENT' || receipt.receipt_type === 'COMBINED') {
    const emailGate = channelAutoSendEnabled('EMAIL');
    // The recipient-availability fact is read on the same transaction as the
    // payment, so it is exactly what queueEmail would see. With no address on
    // file the email row is skipped up front — no composed template or
    // rendered PDF is thrown away — and every flow reports the same canonical
    // reason the UI keys on.
    const contact = await exec.query('SELECT email FROM tenants WHERE id = $1', [receipt.tenant_id]);
    const emailOnFile = Boolean(String(contact.rows[0]?.email ?? '').trim());

    if (!emailOnFile) {
      email = { queued: false, autoSend: emailGate, reason: 'no email on file' };
    } else if (emailGate) {
      let refused: string | null = null;
      const row = await prepareEmailReceipt(receipt.id, { exec }).catch((err: unknown) => {
        // queueEmail refuses only an unusable recipient with a 400 — a fact
        // about the tenant's address, not a failure. The refusal surfaces
        // verbatim as the reason, so the audit trail records the real
        // rejection, not a guess. Every other error is real: let it roll the
        // payment back, exactly like SMS preparation does.
        if (err instanceof HttpError && err.status === 400) {
          refused = err.message;
          return null;
        }
        throw err;
      });
      emailId = row?.id ?? null;
      email = row
        ? { queued: true, autoSend: true, reason: null }
        : { queued: false, autoSend: true, reason: refused };
    }
    // Auto-send off with an address on file: the config choice, reported via
    // autoSend:false. reason stays null — the address on file is not to blame.
  }

  return {
    sms,
    email,
    dispatch: () => {
      if (smsId) dispatchAutoSend(smsId);
      if (emailId) {
        dispatchAfterCommit({
          channel: 'EMAIL',
          what: `email ${emailId} (receipt ${receipt.id})`,
          run: () => sendEmailNotification(emailId),
        });
      }
    },
  };
}
