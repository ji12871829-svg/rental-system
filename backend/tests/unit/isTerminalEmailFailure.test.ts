// The failure classifier behind the email channel's ERRONEOUS vs FAILED
// decision (sendEmailNotification) — the email twin of smsService's DND
// carve-out. A terminal verdict means the ADDRESS is wrong: retrying can
// never help, so the row must not recharge the retry window.
import { isTerminalEmailFailure } from '../../src/services/emailProvider';

describe('isTerminalEmailFailure', () => {
  describe('transient failures — the sweep must keep retrying these', () => {
    it.each([
      ['a 4xx throttle', '450 4.2.0 mailbox temporarily unavailable'],
      ['greylisting', '451 4.7.1 Greylisted, try again later'],
      ['a provider outage', 'upstream provider temporarily unavailable'],
      ['a network timeout', 'connection timeout after 30s'],
      ['TLS negotiation failure', 'TLS handshake failed'],
      ['rate limiting', 'too many requests, slow down'],
      ['deferrals', 'queued, will try again'],
    ])('classifies %s as transient', (_label, reason) => {
      expect(isTerminalEmailFailure(reason)).toBe(false);
    });

    it('treats empty/null reasons as transient (unknown ⇒ retryable)', () => {
      expect(isTerminalEmailFailure(null)).toBe(false);
      expect(isTerminalEmailFailure(undefined)).toBe(false);
      expect(isTerminalEmailFailure('')).toBe(false);
    });

    it('does not let a 4xx code satisfy a 5xx pattern', () => {
      // '450' shares digits with none of the permanent codes, but the digit-
      // boundary guard must also stop e.g. '1550' or '5500' matching '550'.
      expect(isTerminalEmailFailure('error 1550 occurred')).toBe(false);
      expect(isTerminalEmailFailure('error 5501 occurred')).toBe(false);
    });
  });

  describe('permanent rejections — the address can never receive', () => {
    it.each([
      ['a 550 mailbox rejection', '550 5.1.1 <a@b.c>: Recipient address rejected: user unknown'],
      ['a 511 bad destination', '511 bad destination mailbox address'],
      ['a 553 not-allowed mailbox', '553 relay denied; mailbox name not allowed'],
      ['a 554 transaction failure', '554 delivery error: no such user here'],
      ['user unknown phrasing', 'user unknown in virtual mailbox table'],
      ['address-does-not-exist phrasing', 'recipient address does not exist'],
      ['invalid recipient phrasing', 'invalid recipient: nobody@nowhere.test'],
      ['mailbox-not-found phrasing', 'mailbox not found'],
    ])('classifies %s as terminal', (_label, reason) => {
      expect(isTerminalEmailFailure(reason)).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isTerminalEmailFailure('User Unknown')).toBe(true);
      expect(isTerminalEmailFailure('MAILBOX UNAVAILABLE')).toBe(true);
    });

    it('prefers the phrase match inside a mixed transient+permanent banner', () => {
      // Providers wrap the permanent reason in transient-sounding prose; the
      // phrase list wins regardless of position.
      expect(isTerminalEmailFailure('temporarily deferred: user unknown at recipient domain')).toBe(true);
    });
  });
});
