// Shared layout primitives for the dashboard's band design. Moved verbatim
// from pages/Dashboard.tsx — every class, comment and structure is unchanged.
import { Link } from 'react-router-dom';

// SectionHead is defined in ui.tsx (so any page can use it) and re-exported
// here for backward compat — existing dashboard callers import from './primitives'.
export { SectionHead } from '../../components/ui';

// Small pill badge used in card headers (collection %, margin, wallet…).
export function Badge({ tone = 'good', children, title }: { tone?: 'good' | 'bad' | 'warn' | 'neutral'; children: React.ReactNode; title?: string }) {
  const tones: Record<string, string> = {
    good: 'bg-emerald-100 text-emerald-700',
    bad: 'bg-red-100 text-red-700',
    warn: 'bg-amber-100 text-amber-700',
    neutral: 'bg-gray-100 text-gray-600',
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

// Big-number card — two entry points, one shell:
//
//   Rich mode (dashboard bands): pass `title` (+ optional badge, linkTo,
//   linkLabel, children, footer). The header row carries title + badge + deep
//   link; children renders the figure(s); footer renders a muted footnote.
//
//   Simple mode (flat metric pages): pass `label` + `value` (+ optional sub,
//   tone). The header shows the label; the body shows the value; an optional
//   sub lines up under it; tone tints the border + background the way the old
//   ui.tsx KpiCard did (so existing pages keep their look).
//
//   Do not pass both `title` and `label` — the label path wins when present,
//   so a future typo (`label` instead of `title`) renders rather than
//   silently dropping the title.
export function KpiCard({
  title,
  badge,
  linkTo,
  linkLabel,
  children,
  footer,
  label,
  value,
  sub,
  caption,
  tone = 'default',
}: {
  title?: React.ReactNode;
  badge?: React.ReactNode;
  linkTo?: string;
  linkLabel?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  // Simple-mode shape (matches the old ui.tsx KpiCard signature).
  // `caption` (KpiLink-style, text-xs text-gray-400) is preferred for new code;
  // `sub` (text-xs text-graphite) is kept for backward compat. When both are
  // present, caption wins so the card matches KpiLink's look.
  label?: string;
  value?: React.ReactNode;
  sub?: React.ReactNode;
  caption?: React.ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'warn';
}) {
  const isSimple = label != null;

  // ---- card shell (border + background) ----
  const simpleTones: Record<string, string> = {
    default: 'border-ash',
    good: 'border-emerald-300 bg-emerald-50/50',
    bad: 'border-red-300 bg-red-50/50',
    warn: 'border-amber-300 bg-amber-50/50',
  };
  const shell = (
    <div className={`flex flex-col rounded-xl border ${isSimple ? simpleTones[tone] : 'border-gray-200 bg-white'} p-5 shadow-sm`}>
      {isSimple ? (
        // ---- simple mode: label header + value body + optional caption/sub ----
        <>
          <div className="font-sans text-xs font-medium uppercase tracking-wide text-silver">{label}</div>
          {/* text-xl on narrow phones keeps currency values from overflowing a 2-col grid. */}
          <div className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">{value}</div>
          {/* caption (KpiLink-style) takes priority over sub (old ui.tsx style) so the
              simple card can replace a non-linking KpiLink with identical caption styling. */}
          {caption ? (
            <div className="mt-0.5 text-xs text-gray-400">{caption}</div>
          ) : sub ? (
            <div className="mt-1 text-xs text-graphite">{sub}</div>
          ) : null}
        </>
      ) : (
        // ---- rich mode: header row + children body + optional footer ----
        <>
          {/* flex-wrap: when the title + badge + link don't fit one row, the
              right side drops below the title instead of squeezing the title
              into three stacked lines. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500 sm:flex-none">{title}</span>
            <span className="flex shrink-0 items-center gap-2">
              {badge}
              {linkTo && (
                <Link
                  to={linkTo}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-end text-[11px] font-semibold text-brand-700 underline-offset-2 transition-colors hover:text-brand-800 hover:underline"
                >
                  {linkLabel} →
                </Link>
              )}
            </span>
          </div>
          {children && <div className="mt-3 flex-1">{children}</div>}
          {footer && <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">{footer}</div>}
        </>
      )}
    </div>
  );
  return shell;
}

export function ChartCard({ title, meta, to, children }: { title: string; meta?: React.ReactNode; to?: string; children: React.ReactNode }) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">
          {to ? (
            <Link
              to={to}
              className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </h3>
        {meta && <span className="shrink-0 text-[11px] font-medium text-gray-400">{meta}</span>}
      </div>
      {children}
    </div>
  );
}
