// Automatic retry of FAILED SMS messages.
//
// The SMS binding of the shared retry sweep (retrySweep.ts): every send
// attempt that fails transiently gets a next_retry_at deadline (exponential
// backoff, set by sendSmsNotification — base delay is SMS_MAX_SEND_ATTEMPTS
// seconds-worth of trying), and the sweep re-sends due rows on an interval.
// Claim semantics, error containment and the shared SMS_* knobs live in the
// factory; everything SMS-specific here is the table, the claimable status,
// the sender and the log labels.
import { createRetrySweep } from './retrySweep';
import { sendSmsNotification } from './smsService';

const sweep = createRetrySweep({
  table: 'sms_notifications',
  claimStatuses: ['FAILED'],
  sender: sendSmsNotification,
  logPrefix: '[sms-retry]',
  label: 'SMS retry job',
  runningSubject: 'FAILED messages',
});

export const runRetrySweep = sweep.run;
export const startSmsRetryJob = sweep.start;
export const stopSmsRetryJob = sweep.stop;
