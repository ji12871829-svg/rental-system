// Automatic retry of FAILED WhatsApp messages.
//
// The WHATSAPP binding of the shared retry sweep (retrySweep.ts): every
// direct Cloud API send that fails transiently gets a next_retry_at deadline
// (exponential backoff, set by sendWhatsappNotification), and the sweep
// re-sends due rows on an interval. This is what makes the 24-hour
// customer-service window recover without operator attention: the row sits
// FAILED with a deadline, and if the tenant replies in the meantime the next
// pass goes through.
//
// ERRONEOUS rows are never swept — the number itself was refused, so only an
// operator-corrected manual send can recover them.
// Claim semantics, error containment and the shared SMS_* knobs live in the
// factory; everything WhatsApp-specific here is the table, the claimable
// status, the sender and the log labels.
import { createRetrySweep } from './retrySweep';
import { sendWhatsappNotification } from './whatsappService';

const sweep = createRetrySweep({
  table: 'whatsapp_notifications',
  claimStatuses: ['FAILED'],
  sender: sendWhatsappNotification,
  logPrefix: '[whatsapp-retry]',
  label: 'WhatsApp retry job',
  runningSubject: 'FAILED WhatsApp messages',
});

export const startWhatsappRetryJob = sweep.start;
export const stopWhatsappRetryJob = sweep.stop;
