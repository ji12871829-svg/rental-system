// Payment status timeline for the tenant portal.
//
// "Push initiated → M-Pesa confirmed → posted to ledger" for each recent
// M-Pesa payment. Stages are derived server-side; this component only renders
// them. A CONFIRMING row pulses and notes the ~60s prompt expiry; NEEDS_REVIEW
// points at the office (never at an error detail) because resolution is a
// staff action, not something the tenant can do.
import { formatDate, monthLabel } from '../../lib/format';

export interface PaymentStatusRow {
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

export function PaymentTimeline({ rows, fmt }: { rows: PaymentStatusRow[]; fmt: (n: number) => string }) {
  return (
    <div className="rounded-xl border border-ash bg-white" aria-label="Payment status">
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
                                ? 'bg-brand-500 text-white'
                                : current
                                  ? 'animate-pulse bg-brand-50 text-brand-600 ring-2 ring-brand-400'
                                  : 'bg-gray-100 text-gray-400'
                            }`}
                            aria-current={current ? 'step' : undefined}
                          >
                            {done || isPosted ? '✓' : i + 1}
                          </span>
                          <span className={`whitespace-nowrap text-[10px] leading-tight ${done || isPosted ? 'text-brand-600' : current ? 'font-medium text-brand-600' : 'text-gray-400'}`}>{stage.label}</span>
                        </div>
                        {i < TIMELINE_STAGES.length - 1 && (
                          <span className={`mx-1 h-px flex-1 ${i < stageIndex ? 'bg-brand-300' : 'bg-gray-200'}`} aria-hidden />
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
                  Posted{row.allocatedMonth ? ` to ${monthLabel(row.allocatedMonth)} ${row.allocatedYear ?? ''}`.trim() : ''}
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
