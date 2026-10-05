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
//     COMBINED). A blank or invalid recipient degrades to `emailId: null`
//     ("no email on file"), never an error — a payment must not fail because
//     a tenant has no address on file. The Outbound Email module's queueEmail
//     rejects blank recipients with a 400; the seam catches exactly that.
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

export interface PreparedNotifications {
  /** Prepared SMS row, or null when the tenant has no phone on file. */
  smsId: number | null;
  /** Prepared email row, or null when auto-send is off / no address on file. */
  emailId: number | null;
  /**
   * Fire-and-forget dispatch of both prepared channels through the Outbound
   * Message module's post-commit seam. Call exactly once, after the caller's
   * transaction has committed — never inside it.
   */
  dispatch: () => void;
}

// The single call every payment flow makes inside its transaction. Returns
// what was prepared (for honest audit/response facts) and HOW to dispatch it
// (for the moment after commit).
export async function notifyPaymentRecorded(
  receipt: ReceiptLike,
  exec: SqlExec = pool,
): Promise<PreparedNotifications> {
  const smsId = await prepareSmsReceipt(receipt, exec);

  let emailId: number | null = null;
  if (
    (receipt.receipt_type === 'RENT' || receipt.receipt_type === 'COMBINED') &&
    channelAutoSendEnabled('EMAIL')
  ) {
    emailId = await prepareEmailReceipt(receipt.id, { exec })
      .then((row) => row.id)
      .catch((err: unknown) => {
        // A tenant without (a valid) address on file is a fact, not a
        // failure — queueEmail says so with a 400 and the seam degrades to
        // "no email queued". Every other error is real: let it roll the
        // payment back, exactly like SMS preparation does.
        if (err instanceof HttpError && err.status === 400) return null;
        throw err;
      });
  }

  return {
    smsId,
    emailId,
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
