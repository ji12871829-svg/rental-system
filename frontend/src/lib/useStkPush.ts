// State machine for the tenant portal's "Pay with M-Pesa" STK push card.
//
// Pushes only INITIATE: completion is reconciled server-side when the money
// arrives via PayHero, so after a successful push we simply poll the payment
// instructions (the balances) every 10s for up to 3 minutes and let the
// figures speak. Extracted from PortalPayments so the page renders while this
// hook owns the push lifecycle.
import { useEffect, useState } from 'react';
import { portalApi } from './portalApi';

export interface StkPushResult {
  checkoutRequestId: string;
  phone: string;
  expiresInSeconds: number;
  instructions: string;
}

export function useStkPush(opts: {
  /** Rent balance from the payment-instructions endpoint (undefined until loaded). */
  rentBalance: number | undefined;
  refreshBalances: () => void;
  refreshTimeline: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<StkPushResult | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Prefill the amount once the rent balance is known (only on first load —
  // never clobber what the tenant is typing).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!prefilled && opts.rentBalance !== undefined && opts.rentBalance > 0) {
      setAmount(String(opts.rentBalance));
      setPrefilled(true);
    }
  }, [prefilled, opts.rentBalance]);

  useEffect(() => {
    if (!awaitingConfirmation) return;
    const poll = window.setInterval(() => opts.refreshBalances(), 10_000);
    const stop = window.setTimeout(() => setAwaitingConfirmation(false), 3 * 60_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingConfirmation]);

  // The input's onChange always clears a stale validation error the moment
  // the tenant edits.
  const updateAmount = (value: string) => {
    setAmount(value);
    setPushError(null);
  };

  const startPush = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setPushError('Enter the amount you want to pay.');
      return;
    }
    if (value > 1_000_000) {
      setPushError('Amount exceeds the maximum allowed for one payment.');
      return;
    }
    setPushing(true);
    setPushError(null);
    try {
      const { data } = await portalApi.post<{ data: StkPushResult }>('/api/portal/pay-rent/stk-push', { amount: value });
      setPushResult(data);
      setAwaitingConfirmation(true);
      opts.refreshTimeline();
    } catch (err) {
      setPushError((err as Error).message);
    } finally {
      setPushing(false);
    }
  };

  return { amount, updateAmount, pushing, pushError, pushResult, awaitingConfirmation, startPush };
}
