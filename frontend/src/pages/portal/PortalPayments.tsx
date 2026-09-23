import { useEffect, useState } from 'react';
import { Check, Copy, Smartphone } from 'lucide-react';
import { PageHeader, SkeletonTable, useFetch } from '../../components/ui';
import { money, formatDate } from '../../lib/format';
import { portalApi } from '../../lib/portalApi';
import type { PortalSummary } from './PortalHome';

interface PortalPayment {
  kind: 'RENT' | 'WATER';
  payment_date: string;
  billing_month: number | null;
  billing_year: number | null;
  amount: number;
  payment_method: string;
  receipt_number: string | null;
}

interface PaymentInstructions {
  businessName: string | null;
  number: string | null;
  accountName: string | null;
  instructions: string | null;
  rentReference: string | null;
  waterReference: string | null;
  rentBalance: number;
  waterBalance: number;
}

interface StkConfig {
  enabled: boolean;
  reason: string | null;
  targetPhone: string | null;
}

interface StkPushResult {
  checkoutRequestId: string;
  phone: string;
  expiresInSeconds: number;
  instructions: string;
}

interface PaymentStatusRow {
  id: number;
  amount: number;
  stage: 'CONFIRMING' | 'MATCHED' | 'POSTED' | 'NEEDS_REVIEW';
  updatedAt: string;
  payDate: string;
  allocatedMonth: number | null;
  allocatedYear: number | null;
  receiptNumber: string | null;
  pushExpiresInSeconds: number | null;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function PortalPayments() {
  const { data: summaryData } = useFetch(
    () => portalApi.get<{ data: PortalSummary }>('/api/portal/summary'),
    [],
  );
  const { data: paymentsData, loading, error } = useFetch(
    () => portalApi.get<{ data: PortalPayment[] }>('/api/portal/payments'),
    [],
  );
  const { data: instructionsData, refresh: refreshInstructions } = useFetch(
    () => portalApi.get<{ data: PaymentInstructions }>('/api/portal/payment-instructions'),
    [],
  );
  // STK availability: the pay card renders only when the backend says the
  // PayHero channel is configured AND the tenant record has a phone number.
  const { data: stkConfigData } = useFetch(
    () => portalApi.get<{ data: StkConfig }>('/api/portal/pay-rent/config'),
    [],
  );

  const currency = summaryData?.data.currency ?? 'KSh';
  const fmt = (n: number | null | undefined) => money(n ?? 0, currency);

  // Payments are "send money": copy the number + exact account reference,
  // open M-Pesa, and send that amount. There is no in-app push to a phone.
  const [copied, setCopied] = useState<string | null>(null);

  const copyValue = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1800);
  };

  // --- Pay with M-Pesa (STK push) ---
  // Pushes only INITIATE: completion is reconciled server-side when the money
  // arrives via PayHero, so while pending we simply poll the instructions
  // (balances) every 10s for up to 3 minutes and let the figures speak.
  const stkConfig = stkConfigData?.data ?? null;
  const [amount, setAmount] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<StkPushResult | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  // Prefill the amount once the rent balance is known (only on first load —
  // never clobber what the tenant is typing).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!prefilled && instructionsData && instructionsData.data.rentBalance > 0) {
      setAmount(String(instructionsData.data.rentBalance));
      setPrefilled(true);
    }
  }, [prefilled, instructionsData]);

  useEffect(() => {
    if (!awaitingConfirmation) return;
    const poll = window.setInterval(() => refreshInstructions(), 10_000);
    const stop = window.setTimeout(() => setAwaitingConfirmation(false), 3 * 60_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingConfirmation]);

  // --- Payment status timeline ---
  // Recent M-Pesa payments with their pipeline stage. While a push is
  // awaiting confirmation (or a CONFIRMING row exists) poll every 5s so the
  // timeline advances live; otherwise it rides the normal mount refresh.
  const { data: statusData, refresh: refreshStatus } = useFetch(
    () => portalApi.get<{ data: PaymentStatusRow[] }>('/api/portal/payment-status'),
    [],
  );
  const timelineRows = statusData?.data ?? [];
  const hasLiveRow = awaitingConfirmation || timelineRows.some((r) => r.stage === 'CONFIRMING');
  useEffect(() => {
    if (!hasLiveRow) return;
    const poll = window.setInterval(() => refreshStatus(), 5_000);
    return () => window.clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveRow]);

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
      refreshStatus();
    } catch (err) {
      setPushError((err as Error).message);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Pay rent and review everything you have paid" />

      {stkConfig?.enabled && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Smartphone className="h-4 w-4" /> Pay with M-Pesa
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Enter the amount and we'll send an M-Pesa request to your phone ({stkConfig.targetPhone}). Enter your PIN to complete the payment — your balance updates automatically.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setPushError(null); }}
              placeholder="Amount to pay"
              aria-label="Amount to pay"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:max-w-xs"
            />
            <button
              type="button"
              onClick={startPush}
              disabled={pushing || awaitingConfirmation || !Number(amount)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pushing ? 'Sending request…' : 'Send M-Pesa request'}
            </button>
          </div>
          {pushError && <p className="mt-2 text-sm text-red-700">{pushError}</p>}
          {pushResult && (
            <div className="mt-3 rounded-lg border border-emerald-300 bg-white p-3 text-sm">
              {awaitingConfirmation ? (
                <p className="text-gray-700">
                  <span className="font-medium">Request sent to {pushResult.phone}.</span> Check your phone and enter your M-Pesa PIN. This page refreshes your balance automatically for a few minutes while M-Pesa confirms.
                </p>
              ) : (
                <p className="text-gray-700">
                  Request sent to {pushResult.phone}. If you haven't completed it, you can send another request — the payment posts once M-Pesa confirms.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {stkConfig && !stkConfig.enabled && stkConfig.reason && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">{stkConfig.reason}</p>
      )}

      {instructionsData?.data.number && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Send money via M-Pesa</h3>
          <p className="mt-1 text-sm text-gray-600">
            Send the amount you owe to the details below, using the exact account reference for what you are paying (rent or water). The payment reflects on your account once it is confirmed.
          </p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <CopyRow label="M-Pesa number" value={instructionsData.data.number} onCopy={copyValue} copied={copied} />
            {(instructionsData.data.accountName || instructionsData.data.businessName) && (
              <CopyRow label="Account name" value={instructionsData.data.accountName || instructionsData.data.businessName!} onCopy={copyValue} copied={copied} />
            )}
            {instructionsData.data.rentReference && <CopyRow label="Rent account" value={instructionsData.data.rentReference} onCopy={copyValue} copied={copied} />}
            {instructionsData.data.waterReference && <CopyRow label="Water account" value={instructionsData.data.waterReference} onCopy={copyValue} copied={copied} />}
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {instructionsData.data.rentReference && (
              <AmountRow
                label="Rent to send"
                amount={instructionsData.data.rentBalance}
                fmt={fmt}
                positive={instructionsData.data.rentBalance > 0}
              />
            )}
            {instructionsData.data.waterReference && (
              <AmountRow
                label="Water to send"
                amount={instructionsData.data.waterBalance}
                fmt={fmt}
                positive={instructionsData.data.waterBalance > 0}
              />
            )}
          </div>
          {instructionsData.data.instructions && <p className="mt-3 text-sm text-gray-600">{instructionsData.data.instructions}</p>}
        </div>
      )}

      {timelineRows.length > 0 && <PaymentTimeline rows={timelineRows} fmt={fmt} />}

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Payment history</h3>
        </div>
        {loading && <SkeletonTable cols={5} />}
        {error && <p className="px-4 py-4 text-sm text-red-700">{error}</p>}
        {!loading && !error && (paymentsData?.data.length ?? 0) === 0 && (
          <p className="px-4 py-6 text-sm text-gray-500">No payments recorded yet.</p>
        )}
        {!loading && !error && (paymentsData?.data.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">For month</th>
                  <th className="px-4 py-2 font-medium">Method</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {paymentsData!.data.map((p, i) => (
                  <tr key={`${p.kind}-${p.payment_date}-${i}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 text-gray-900">{formatDate(p.payment_date)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{p.kind === 'RENT' ? 'Rent' : 'Water'}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {p.billing_month ? `${MONTHS[p.billing_month]} ${p.billing_year ?? ''}`.trim() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{p.payment_method}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900">{fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AmountRow({ label, amount, fmt, positive }: {
  label: string;
  amount: number;
  fmt: (n: number) => string;
  positive: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
      <span className="text-gray-500">{label}</span>
      <b className={positive ? 'text-red-700' : 'text-green-700'}>{positive ? fmt(amount) : 'Nothing — you are up to date'}</b>
    </div>
  );
}

function CopyRow({ label, value, onCopy, copied }: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
  copied: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
      <span><span className="text-gray-500">{label}:</span> <b className="text-gray-900">{value}</b></span>
      <button type="button" onClick={() => onCopy(label, value)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-900" aria-label={`Copy ${label}`}>
        {copied === label ? <Check size={14} /> : <Copy size={14} />}
        {copied === label ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

// --- Payment status timeline --------------------------------------------------
//
// "Push initiated → M-Pesa confirmed → posted to ledger" for each recent
// M-Pesa payment. Stages are derived server-side; this component only renders
// them. A CONFIRMING row pulses and notes the ~60s prompt expiry; NEEDS_REVIEW
// points at the office (never at an error detail) because resolution is a
// staff action, not something the tenant can do.

const TIMELINE_STAGES = [
  { key: 'initiated', label: 'Request sent' },
  { key: 'confirmed', label: 'M-Pesa confirmed' },
  { key: 'posted', label: 'Posted to ledger' },
] as const;

function timelineStageIndex(stage: PaymentStatusRow['stage']): number {
  switch (stage) {
    case 'CONFIRMING':
      return 0;
    case 'MATCHED':
      return 1;
    case 'POSTED':
      return 2;
    case 'NEEDS_REVIEW':
      return 1; // confirmed, but held before posting
  }
}

function PaymentTimeline({ rows, fmt }: { rows: PaymentStatusRow[]; fmt: (n: number) => string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white" aria-label="Payment status">
      <div className="border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Payment status</h3>
        <p className="mt-0.5 text-xs text-gray-500">Your recent M-Pesa payments and where they are</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {rows.map((row) => {
          const stageIndex = timelineStageIndex(row.stage);
          const needsReview = row.stage === 'NEEDS_REVIEW';
          return (
            <li key={row.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-gray-900">{fmt(row.amount)}</span>
                <span className="text-xs text-gray-500">{formatDate(row.payDate)}</span>
              </div>
              {needsReview ? (
                <p className="mt-1 text-xs text-amber-700">
                  Being reviewed by the office — we'll match it to your account shortly.
                </p>
              ) : (
                <ol className="mt-2 flex items-center" aria-label={`Stage ${stageIndex + 1} of 3` }>
                  {TIMELINE_STAGES.map((stage, i) => {
                    const done = i < stageIndex;
                    const current = i === stageIndex;
                    const isPosted = current && row.stage === 'POSTED';
                    return (
                      <li key={stage.key} className={`flex items-center ${i < TIMELINE_STAGES.length - 1 ? 'flex-1' : ''}`}>
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                              done || isPosted
                                ? 'bg-emerald-600 text-white'
                                : current
                                  ? 'animate-pulse bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500'
                                  : 'bg-gray-100 text-gray-400'
                            }`}
                            aria-current={current ? 'step' : undefined}
                          >
                            {done || isPosted ? '✓' : i + 1}
                          </span>
                          <span className={`whitespace-nowrap text-[10px] leading-tight ${done || isPosted ? 'text-emerald-700' : current ? 'font-medium text-emerald-700' : 'text-gray-400'}`}>{stage.label}</span>
                        </div>
                        {i < TIMELINE_STAGES.length - 1 && (
                          <span className={`mx-1 h-px flex-1 ${i < stageIndex ? 'bg-emerald-400' : 'bg-gray-200'}`} aria-hidden />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {row.stage === 'CONFIRMING' && (
                <p className="mt-1 text-xs text-gray-500">Check your phone and enter your M-Pesa PIN (the request expires in about a minute).</p>
              )}
              {row.stage === 'MATCHED' && (
                <p className="mt-1 text-xs text-gray-500">Payment received — being posted to your account.</p>
              )}
              {row.stage === 'POSTED' && (
                <p className="mt-1 text-xs text-gray-600">
                  Posted{row.allocatedMonth ? ` to ${MONTHS[row.allocatedMonth]} ${row.allocatedYear ?? ''}`.trim() : ''}
                  {row.receiptNumber ? ` · Receipt ${row.receiptNumber}` : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
