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

// ---------------------------------------------------------------- SectionHead
// Small section eyebrow: tiny uppercase label (left) with an optional context
// caption (right). Used by the dashboard bands (KpiBand, ChartGrid, HealthCards,
// stats strips) and available to any page that wants the same chapter-heading
// rhythm without importing from the dashboard primitives.
export function SectionHead({ label, caption }: { label: string; caption?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{label}</h2>
      {caption && <div className="text-[11px] text-gray-400">{caption}</div>}
    </div>
  );
}

// ------------------------------------------------------------------- KpiCard
// Unified KPI card — single component covering both the simple metric shape
// (label/value/sub/tone, used by Arrears/Water/Expenses/etc.) and the rich
// dashboard shape (title/badge/link*/children/footer, used by KpiBand).
//
// The canonical definition lives in primitives.tsx. This re-export keeps the
// `import { KpiCard } from '../components/ui'` contract working for the simple
// callers; new code should import from primitives directly.
//
// Deprecated: the old inline body (border-ash / bg-white / p-4 shell) is
// replaced by the primitives.tsx definition, which renders the same visual
// for the simple shape and adds the rich shape. Remove this alias once every
// import points at primitives.
export { KpiCard } from './dashboard/primitives';

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
    <div className="rounded-xl border border-ash bg-white p-4 shadow-sm">
      {title && <div className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-silver">{title}</div>}
      <div className="flex flex-wrap gap-y-3">
        {stats.map((s, i) => (
          <div
            key={i}
            className={`min-w-[7.5rem] flex-1 px-3 first:pl-0 ${i > 0 ? 'border-l border-gray-100' : ''}`}
          >
            <div className="text-xs font-medium text-graphite">
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
            <div className={`mt-0.5 text-lg font-bold text-gray-900 sm:text-xl ${toneText[s.tone ?? 'default']}`}>{s.value}</div>
            {s.sub && <div className="mt-0.5 text-[11px] text-silver">{s.sub}</div>}
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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-graphite">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// --- Shake (validation-failure feedback) -------------------------------------
// A short horizontal shake on a form (or any element) when submission fails —
// client-side validation rejection or a server error. Web Animations API, so
// re-triggering cancels the running animation and restarts cleanly; no CSS
// class juggling, no remounts. Respects prefers-reduced-motion by not running.
function shakeEl(el: HTMLElement | null): void {
  if (!el) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(7px)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 400, easing: 'ease-out' },
  );
}

// For inline (non-Modal) forms: attach the ref to the form's container and
// call fire() wherever a submission fails. Generic so the ref can attach to
// the form element itself (useShake<HTMLFormElement>()) or any container.
export function useShake<T extends HTMLElement = HTMLDivElement>(): [React.RefObject<T>, () => void] {
  const ref = useRef<T>(null);
  const fire = useCallback(() => shakeEl(ref.current), []);
  return [ref, fire];
}

// Button feedback icons (stroke = currentColor: correct on every variant and
// in both themes with zero theme-specific code).
function SpinnerIcon({ className = '', ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...rest}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function CheckmarkIcon({ className = '', ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...rest}>
      <path className="btn-check-mark" d="M4 12.5l5.2 5.2L20 6.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// -------------------------------------------------------------------- Button
export function Button({
  children,
  variant = 'primary',
  className = '',
  loading = false,
  success = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  // loading: spinner replaces content, button disabled. success: drawn
  // checkmark replaces content. Pass success for a beat AFTER the await
  // resolves (setBusy->setSuccess) so the mark is visible before any
  // close/reset; use loading during the await itself.
  loading?: boolean;
  success?: boolean;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-brand-500 text-white shadow-sm hover:bg-brand-600',
    secondary: 'bg-white text-graphite border border-ash shadow-sm hover:bg-fog',
    danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
    ghost: 'text-brand-600 hover:bg-brand-50',
  };
  // Both icons stroke currentColor — correct on every variant and theme with
  // zero theme-specific code. Spinner: pure CSS/SVG, no dependency. Success:
  // animated by index.css (@keyframes btn-check-draw) via the .btn-check class.
  const icon = success
    ? <CheckmarkIcon aria-hidden className="h-4 w-4 btn-check" />
    : <SpinnerIcon aria-hidden className="h-4 w-4 animate-spin" />;
  return (
    <button
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium press transition-[background-color,box-shadow,color,transform] duration-150 hover:shadow active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 md:min-h-[40px] ${variants[variant]} ${className}`}
      {...props}
      disabled={loading || success || props.disabled}
    >
      {/* Icon rides alongside the label text (pages swap the text themselves
          via busy/saved state), so nothing disappears — clearer than an
          icon-only swap and readable by screen readers. */}
      {loading || success ? <>{icon}{children}</> : children}
    </button>
  );
}

// -------------------------------------------------------------------- Inputs
// error (when shown) replaces hint — one line of guidance at a time, red for
// validation problems.
export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-medium text-red-700">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-graphite">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  // text-base (<16px) on touch devices prevents iOS Safari's focus auto-zoom.
  'min-h-[44px] w-full rounded-lg border border-ash bg-white px-3 py-2 text-base text-gray-900 transition-[border-color,box-shadow] duration-150 placeholder:text-silver focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 disabled:cursor-not-allowed disabled:bg-fog disabled:text-silver';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

// --------------------------------------------------------------------- Modal
export function Modal({ open, title, onClose, children, wide, shakeSignal = 0 }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean;
  // Bump this counter to shake the panel — pass it from a form component's
  // failure state (setShakeN(n => n + 1)) so a failed submit visibly shakes
  // the dialog. 0 (initial) never fires.
  shakeSignal?: number }) {
  // Shake the panel whenever the signal increments past the initial 0.
  useEffect(() => {
    if (shakeSignal > 0) shakeEl(panelRef.current);
  }, [shakeSignal]);
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
  // The scrim click is a mouse-only convenience; keyboard users close the
  // dialog via the Escape listener above or the visible Close button.
  /* eslint-disable jsx-a11y/click-events-have-key-events */
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-gray-900/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`mx-auto my-auto w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl bg-white shadow-xl outline-none animate-in slide-in-from-bottom-4 duration-200 md:mt-12 md:mb-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-silver transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 active:scale-95"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
  /* eslint-enable jsx-a11y/click-events-have-key-events */
}

// ---------------------------------------------------------------- EmptyState
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-ash bg-white p-10 text-center text-sm text-graphite">
      <Toon size={84} pose="wave" animated className="shrink-0" />
      <p className="max-w-sm">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Skeleton
// Loading placeholders that mirror the real layout's geometry, so the page
// doesn't jump when data arrives. Pure Tailwind pulse — no dependencies.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-fog ${className}`} />;
}

function SkeletonStatGroupCard({ title, stats = 3 }: { title?: boolean; stats?: number }) {
  return (
    <div className="rounded-xl border border-ash bg-white p-4 shadow-sm">
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
    <div className="rounded-xl border border-ash bg-white p-4 shadow-sm">
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
      {/* Toasts — deliberately quiet: a white card with a coloured icon and a
          hairline, not a full-bleed red slab. The container has no fixed width
          so a short message stays short (it used to be forced to
          calc(100vw-2rem), which looked unfinished on phones). */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'success' ? 'status' : 'alert'}
            className={`pointer-events-auto flex w-fit max-w-full items-start gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-sm shadow-lg animate-in slide-in-from-right-4 duration-200 ${
              t.type === 'success' ? 'border-gray-200' : 'border-red-400'
            }`}
          >
            {t.type === 'success'
              ? <CheckCircle2 size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              : <AlertCircle size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-red-600" aria-hidden />}
            <span className="text-gray-900">
              {t.message}
              {t.action && (
                <Link to={t.action.to} className="mt-1 block font-semibold text-brand-600 transition-colors duration-150 hover:text-brand-700">
                  {t.action.label}
                </Link>
              )}
            </span>
            <button
              type="button"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              aria-label="Dismiss notification"
              className="-mr-1 shrink-0 rounded-md p-1 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600"
            >
              <X size={13} strokeWidth={2} aria-hidden />
            </button>
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

// ---------------------------------------------------------------- TopbarSearch
// Re-exported from the dedicated file below. Kept in ui.tsx's export surface
// so pages keep importing from '../components/ui' like every other card.
export { TopbarSearch } from './TopbarSearch';

// ---------------------------------------------------------------- NotifPanel
// Re-exported from the dedicated file below. Kept in ui.tsx's export surface
// so pages keep importing from '../components/ui' like every other card.
export { NotifPanel, type NotifSummary } from './NotifPanel';

// ---------------------------------------------------------------- MetricCardWithActions
// Metric card with icon slot + action buttons row — modeled on the xampp RMS
// `.metric-card` pattern (design-system.css §METRIC CARDS). Extends the local
// KpiCard simple shape with an icon + a row of action links/buttons.
export interface MetricAction {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: 'outline' | 'primary';
}

export function MetricCardWithActions({
  label,
  value,
  sub,
  icon,
  iconVariant = 'default',
  actions,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  iconVariant?: 'default' | 'red' | 'green';
  actions?: MetricAction[];
  tone?: 'default' | 'good' | 'bad' | 'warn';
}) {
  const iconStyles: Record<string, string> = {
    default: 'bg-gray-100 text-gray-600',
    red: 'bg-red-50 text-red-600',
    green: 'bg-emerald-50 text-emerald-600',
  };
  const valueStyles: Record<string, string> = {
    default: 'text-gray-900',
    good: 'text-emerald-700',
    bad: 'text-red-700',
    warn: 'text-amber-700',
  };
  return (
    <div className="rounded-xl border border-ash bg-white p-5 shadow-sm">
      {icon && (
        <div className="mb-3 flex items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base ${iconStyles[iconVariant]}`}>
            {icon}
          </div>
          <div className="font-sans text-xs font-medium uppercase tracking-wide text-silver">{label}</div>
        </div>
      )}
      <div className={`text-xl font-bold tabular-nums ${valueStyles[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-400">{sub}</div>}
      {actions && actions.length > 0 && (
        <div className="mt-4 flex gap-2">
          {actions.map((a) =>
            a.to ? (
              <Link
                key={a.label}
                to={a.to}
                className="flex-1 rounded-lg border border-ash bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 hover:border-gray-300 active:scale-[0.98]"
              >
                {a.label}
              </Link>
            ) : a.onClick ? (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-150 active:scale-95 ${
                  a.variant === 'primary'
                    ? 'bg-brand-500 text-white hover:bg-brand-600'
                    : 'border border-ash bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {a.label}
              </button>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

