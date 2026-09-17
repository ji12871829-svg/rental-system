import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { statusClass } from '../lib/format';
import { Toon } from './Toon';

// ---------------------------------------------------------------- StatusBadge
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(status)}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ------------------------------------------------------------------- KpiCard
export function KpiCard({ label, value, sub, tone = 'default' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' }) {
  const tones: Record<string, string> = {
    default: 'border-gray-200',
    good: 'border-emerald-300 bg-emerald-50/50',
    bad: 'border-red-300 bg-red-50/50',
    warn: 'border-amber-300 bg-amber-50/50',
  };
  return (
    <div className={`rounded-xl border ${tones[tone]} bg-white p-4 shadow-sm`}>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      {/* text-xl on narrow phones keeps currency values from overflowing a 2-col grid. */}
      <div className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

// -------------------------------------------------------------- StatGroupCard
// Groups several related numbers into ONE bordered card instead of one box
// per metric — cuts visual clutter on dashboards with many KPIs while still
// surfacing every value.
export interface GroupStat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  // Optional router link — turns the label into a link to the page behind the
  // number (e.g. Outstanding → /arrears) so a dashboard reads as a hub.
  to?: string;
}

export function StatGroupCard({ title, stats }: { title?: string; stats: GroupStat[] }) {
  const toneText: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-600',
    bad: 'text-red-600',
    warn: 'text-amber-600',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {title && <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</div>}
      <div className="flex flex-wrap gap-y-3">
        {stats.map((s, i) => (
          <div
            key={i}
            className={`min-w-[7.5rem] flex-1 px-3 first:pl-0 ${i > 0 ? 'border-l border-gray-100' : ''}`}
          >
            <div className="text-xs font-medium text-gray-500">
              {s.to ? (
                <Link
                  to={s.to}
                  className="-my-2 -mx-2.5 inline-block px-2.5 py-2 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
                >
                  {s.label}
                </Link>
              ) : (
                s.label
              )}
            </div>
            <div className={`mt-0.5 text-lg font-bold sm:text-xl ${toneText[s.tone ?? 'default']}`}>{s.value}</div>
            {s.sub && <div className="mt-0.5 text-[11px] text-gray-400">{s.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- PageHeader
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// -------------------------------------------------------------------- Button
export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const variants: Record<string, string> = {
    primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700',
    secondary: 'bg-white text-gray-700 border border-gray-200 shadow-sm hover:bg-gray-50',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
    ghost: 'text-brand-600 hover:bg-brand-50',
  };
  return (
    <button
      className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-[background-color,box-shadow,color,transform] duration-150 hover:shadow active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// -------------------------------------------------------------------- Inputs
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  // text-base (<16px) on touch devices prevents iOS Safari's focus auto-zoom.
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 shadow-sm transition-[border-color,box-shadow] duration-150 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 md:text-sm';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

// --------------------------------------------------------------------- Modal
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard support: Escape closes the dialog; focus moves into it while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-gray-900/50 p-4 animate-in fade-in" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`mx-auto my-auto w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl bg-white shadow-xl outline-none animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-200 md:mt-12 md:mb-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 active:scale-95"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- EmptyState
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
      <Toon size={84} pose="wave" animated className="shrink-0" />
      <p className="max-w-sm">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Skeleton
// Loading placeholders that mirror the real layout's geometry, so the page
// doesn't jump when data arrives. Pure Tailwind pulse — no dependencies.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

function SkeletonStatGroupCard({ title, stats = 3 }: { title?: boolean; stats?: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      {title && <Skeleton className="mb-3 h-3 w-20" />}
      <div className="flex flex-wrap gap-y-3">
        {Array.from({ length: stats }, (_, i) => (
          <div key={i} className={`min-w-[7.5rem] flex-1 px-3 first:pl-0 ${i > 0 ? 'border-l border-gray-100' : ''}`}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-1.5 h-5 w-20 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function SkeletonChartCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <Skeleton className="mb-3 h-3.5 w-40" />
      <Skeleton className="h-[260px] w-full" />
    </div>
  );
}

// Loading stand-in for the app's standard .table-scroll data table. Uses real
// table markup so it inherits the exact stylesheet geometry (padding, sticky
// first column, header tint, hairlines) — zero layout shift when data lands.
export function SkeletonTable({ cols, rows = 8 }: { cols: number; rows?: number }) {
  // Deterministic bar widths per column: mimics mixed content widths
  // (wide identity columns, narrower numeric ones) without looking uniform.
  const widths = ['w-32', 'w-20', 'w-24', 'w-16', 'w-28', 'w-20', 'w-24', 'w-16', 'w-28', 'w-24', 'w-16', 'w-20', 'w-24', 'w-16'];
  return (
    <div className="table-scroll" aria-hidden>
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>
                <Skeleton className={`h-3 ${i === 0 ? 'w-24' : 'w-14'}`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <Skeleton className={`h-3.5 ${widths[c % widths.length]} ${r % 2 === 0 ? '' : 'opacity-60'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      {[
        { heading: 'w-16', grid: 'md:grid-cols-3', cards: 3 },
        { heading: 'w-12', grid: 'md:grid-cols-2', cards: 2 },
        { heading: 'w-20', grid: '', cards: 1 },
      ].map((section, s) => (
        <div key={s} className={s === 0 ? '' : 'mt-8'}>
          <Skeleton className={`mb-3 h-3.5 ${section.heading}`} />
          <div className={`grid grid-cols-1 gap-3 ${section.grid}`}>
            {Array.from({ length: section.cards }, (_, i) => (
              <SkeletonStatGroupCard key={i} title={section.cards > 1} />
            ))}
          </div>
        </div>
      ))}

      <div className="mt-8">
        <Skeleton className="mb-3 h-3.5 w-12" />
        <Skeleton className="h-[72px] w-full rounded-xl" />
      </div>

      <div className="mt-8">
        <Skeleton className="mb-3 h-3.5 w-14" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonChartCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Pagination
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
      <span>Page <span className="tabular-nums font-medium">{page}</span> of <span className="tabular-nums font-medium">{totalPages}</span></span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Toast
interface Toast {
  id: number;
  type: 'success' | 'error';
  message: string;
  // Optional in-toast action (e.g. "View in SMS history") rendered as a
  // router Link under the message; auto-dismisses with the toast.
  action?: { label: string; to: string };
}

const ToastContext = createContext<{
  toast: (type: 'success' | 'error', message: string, action?: { label: string; to: string }) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: 'success' | 'error', message: string, action?: { label: string; to: string }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'success' ? 'status' : 'alert'}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg animate-in fade-in slide-in-from-right-4 duration-200 ${
              t.type === 'success' ? 'bg-emerald-700' : 'bg-red-600'
            }`}
          >
            {t.type === 'success'
              ? <CheckCircle2 size={17} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
              : <AlertCircle size={17} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />}
            <span>
              {t.message}
              {t.action && (
                // Block display so the link always sits on its own line.
                <Link to={t.action.to} className="mt-1 block font-semibold text-white underline underline-offset-2">
                  {t.action.label}
                </Link>
              )}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

// ------------------------------------------------------------------ useFetch
// Tiny data-fetching hook with refresh support — keeps pages small.
// Pass `enabled: false` to hold the request until a dependency is ready
// (e.g. waiting for the reporting year before querying a list).
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = [], opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refresh };
}