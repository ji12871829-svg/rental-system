// Outbound Message module — the channel-agnostic half of the outbound
// lifecycle: whether a freshly prepared message actually leaves once its
// transaction has committed, and how it is handed to the provider without the
// request that queued it ever waiting on (or failing from) the send.
//
// Channels keep their own tables and send transitions — those genuinely
// differ, on purpose: email accepts only PENDING rows and records a plain
// FAILED; SMS also accepts a manual re-send of a FAILED row, counts attempts
// and schedules exponential backoff (smsRetryJob). What the channels do NOT
// differ on is this seam. It used to exist twice — once per channel module,
// with two gating predicates — and a drift between the two is invisible to
// tests until production. There is exactly one implementation now;
// emailService.dispatchAutoEmail and smsService.dispatchAutoSend are its two
// entry points.
import { env, isTest } from '../config/env';

export type OutboundChannel = 'SMS' | 'EMAIL';

// Whether a freshly prepared message on this channel will actually be
// dispatched — lets payment and reminder responses tell the UI honestly what
// happened (queued-but-manual vs auto-sent vs not queued at all). The test
// environment always opts out so integration tests drive the manual send
// explicitly.
export function autoSendEnabled(channel: OutboundChannel): boolean {
  if (isTest) return false;
  return channel === 'SMS' ? env.smsAutoSend : env.emailAutoSend;
}

export interface PostCommitDispatch {
  channel: OutboundChannel;
  /** What is being dispatched, for the failure log: e.g. `notification 12`. */
  what: string;
  /** The channel's dispatch call. Runs on the next tick, fire-and-forget. */
  run: () => Promise<unknown>;
}

// Auto-dispatch a freshly prepared message AFTER its transaction commits.
// Fire-and-forget by design: a provider outage must never fail a recorded
// payment, and a slow provider must never hold the HTTP response. A failed
// auto-send leaves the row FAILED (reason recorded) for retry from the
// channel's history page; a crash mid-send leaves it PENDING, visible and
// still sendable manually.
export function dispatchAfterCommit(dispatch: PostCommitDispatch): void {
  if (!autoSendEnabled(dispatch.channel)) return;
  setTimeout(() => {
    dispatch.run().catch((err) => {
      console.error(
        `[${dispatch.channel.toLowerCase()}] auto-send failed for ${dispatch.what}: ${(err as Error).message}`
      );
    });
  }, 0);
}
