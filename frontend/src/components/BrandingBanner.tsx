import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListChecks } from 'lucide-react';
import { useBranding } from '../lib/BrandingContext';
import { useAuth } from '../lib/auth';

const STORAGE_KEY = 'rpms.branding-banner-ack';

/**
 * One-time admin banner listing every business-identity field that is still
 * unfilled. Values now live in the database (Settings page) — the banner
 * links there instead of pointing at source code. Dismissal persists in
 * localStorage, so it nags exactly once per browser (per fill-state).
 */
export default function BrandingBanner() {
  const { isAdmin } = useAuth();
  const { missingLabels } = useBranding();
  const [acknowledged, setAcknowledged] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  if (!isAdmin || acknowledged || missingLabels.length === 0) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    setAcknowledged(true);
  }

  return (
    <div
      role="status"
      aria-label="Missing business details"
      className="border-b border-amber-200 bg-amber-50"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-amber-900 md:px-6">
        <ListChecks size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
        <p className="min-w-0 flex-1 leading-5">
          <strong>{missingLabels.length} business detail{missingLabels.length === 1 ? ' is' : 's are'} still missing:</strong>{' '}
          {missingLabels.join(', ')}.{' '}
          <Link to="/settings" className="font-semibold underline underline-offset-2 hover:text-amber-700">
            Fill them in Settings →
          </Link>{' '}
          Completing them activates the legal pages, printed receipts, footers, PDFs and SMS messages.
        </p>
        <button
          onClick={dismiss}
          className="inline-flex min-h-[32px] shrink-0 items-center rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 active:scale-[0.96]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
