import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
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
  const { data: instructionsData } = useFetch(
    () => portalApi.get<{ data: PaymentInstructions }>('/api/portal/payment-instructions'),
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

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Pay rent and review everything you have paid" />

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
