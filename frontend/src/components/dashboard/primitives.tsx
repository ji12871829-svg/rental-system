// Shared layout primitives for the dashboard's band design. Moved verbatim
// from pages/Dashboard.tsx — every class, comment and structure is unchanged.
import { Link } from 'react-router-dom';
import { money } from '../../lib/format';

// Section eyebrow: tiny uppercase label left, context caption right — every
// band on the page gets one so the eye can parse the page as chapters.
export function SectionHead({ label, caption }: { label: string; caption?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</h2>
      {caption && <div className="text-[11px] text-gray-400">{caption}</div>}
    </div>
  );
}

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

// Big-number card: uppercase mini title row (with optional right-side badge /
// link), a huge money/count figure, then a muted footer line. The shell the
// whole KPI band uses.
export function KpiCard({
  title,
  badge,
  linkTo,
  linkLabel,
  children,
  footer,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  linkTo?: string;
  linkLabel?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
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
              className="text-[11px] font-semibold text-brand-700 underline-offset-2 transition-colors hover:text-brand-800 hover:underline"
            >
              {linkLabel} →
            </Link>
          )}
        </span>
      </div>
      <div className="mt-3 flex-1">{children}</div>
      {footer && <div className="mt-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">{footer}</div>}
    </div>
  );
}

// Huge figure + optional caption underneath, the KpiCard body workhorse.
export function BigFigure({ value, caption, tone = 'default' }: { value: React.ReactNode; caption?: React.ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' }) {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  return (
    <div>
      <div className={`text-2xl font-bold tracking-tight tabular-nums sm:text-[1.7rem] ${tones[tone]}`}>{value}</div>
      {caption && <div className="mt-0.5 text-[11px] text-gray-400">{caption}</div>}
    </div>
  );
}

// Multi-column stat row inside a card (the reference's 3-up figures with a
// caption under each number).
export function FigureRow({ items }: { items: { label: string; value: React.ReactNode; caption?: React.ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' }[] }) {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="text-[11px] font-medium text-gray-500">{it.label}</div>
          <div className={`mt-0.5 text-lg font-bold tabular-nums sm:text-xl ${tones[it.tone ?? 'default']}`}>{it.value}</div>
          {it.caption && <div className="mt-0.5 text-[11px] text-gray-400">{it.caption}</div>}
        </div>
      ))}
    </div>
  );
}

// Occupancy progress: brand segment for occupied, amber tail for vacant.
export function OccupancyBar({ total, occupied, vacant }: { total: number; occupied: number; vacant: number }) {
  const occPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100"
      role="img"
      aria-label={`${occPct}% occupied, ${vacant} vacant of ${total} units`}
    >
      <div className="h-full bg-brand-600 transition-[width] duration-700" style={{ width: `${occPct}%` }} />
      <div className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: `${total > 0 ? (vacant / total) * 100 : 0}%` }} />
    </div>
  );
}

// Ranked outstanding list — the reference's horizontal red/purple bars with
// the amount right-aligned on each row. Bars scale to the largest debt; each
// row deep-links into the arrears page pre-filtered to that unit.
export function OutstandingList({
  rows,
  currency,
  barClass,
  onSelect,
}: {
  rows: { unitNumber: string; outstanding?: number; waterOutstanding?: number }[];
  currency: string;
  barClass: string;
  onSelect: (row: { unitNumber: string }) => void;
}) {
  const key = rows.length > 0 && 'outstanding' in rows[0] ? 'outstanding' : 'waterOutstanding';
  // Only units that actually owe, worst first, capped like the reference's
  // five-row lists — a clean property shows the all-current message, not
  // ten rows of KSh 0.
  const debtors = rows.filter((r) => Number(r[key]) > 0).slice(0, 5);
  const max = Math.max(...debtors.map((r) => Number(r[key])), 1);
  if (debtors.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">Nothing outstanding — every unit is current.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {debtors.map((r) => {
        const amount = Number(r[key]);
        return (
          <li key={r.unitNumber}>
            <button
              type="button"
              onClick={() => onSelect({ unitNumber: r.unitNumber })}
              className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-gray-50"
              title={`Open arrears for unit ${r.unitNumber}`}
            >
              <span className="w-24 shrink-0 truncate text-xs font-semibold text-gray-700 sm:w-28">{r.unitNumber}</span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span
                  className={`block h-full rounded-full ${barClass} transition-[width] duration-700`}
                  style={{ width: `${Math.max(4, (amount / max) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 sm:w-28">
                {money(amount, currency)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// One cell of the combined strip: tiny label, big colored figure, caption —
// the whole cell deep-links to the page behind the number.
export function CombinedCell({
  label,
  value,
  caption,
  tone = 'default',
  to,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  to?: string;
}) {
  const tones: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  const body = (
    <>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {caption && <div className="mt-0.5 text-[11px] text-gray-400">{caption}</div>}
    </>
  );
  return to ? (
    <Link
      to={to}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors duration-150 hover:bg-gray-50"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">{body}</div>
  );
}

export function ChartCard({ title, meta, to, children }: { title: string; meta?: React.ReactNode; to?: string; children: React.ReactNode }) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
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
