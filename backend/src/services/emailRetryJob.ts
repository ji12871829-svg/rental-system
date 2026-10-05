// Automatic retry of FAILED and ERRONEOUS emails.
//
// The EMAIL binding of the shared retry sweep (retrySweep.ts). Design notes
// mirror the SMS binding, with one deliberate difference:
//
//  - The claim covers BOTH non-final statuses. FAILED is the transient case
//    (a deadline is normally present). ERRONEOUS is the terminal case — the
//    provider rejected the address itself — and is written WITHOUT a deadline,
//    so in practice only an operator-supplied deadline ever makes one a
//    sweep candidate. Claiming both keeps the sweep honest about "anything not
//    SENT is replayable" and means a single query covers every replayable row
//    regardless of how it failed.
//  - Rows are claimed with FOR UPDATE SKIP LOCKED inside a short statement that
//    marks them PENDING again, so two server instances (or an overlap of the
//    sweep with a manual send) can never double-send the same message.
//  - A row that exhausts its attempts keeps status FAILED with next_retry_at
//    NULL — visibly "gave up" — and can still be sent manually forever.
//  - NODE_ENV=test opts out at startEmailRetryJob (integration tests drive the
//    flow explicitly); the sweep itself stays fully unit/integration-testable.
import { createRetrySweep } from './retrySweep';
import { sendEmailNotification } from './emailService';

const sweep = createRetrySweep({
  table: 'email_notifications',
  claimStatuses: ['FAILED', 'ERRONEOUS'],
  sender: sendEmailNotification,
  logPrefix: '[email-retry]',
  label: 'Email retry job',
  runningSubject: 'FAILED emails',
});

export const runEmailRetrySweep = sweep.run;
export const startEmailRetryJob = sweep.start;
export const stopEmailRetryJob = sweep.stop;
