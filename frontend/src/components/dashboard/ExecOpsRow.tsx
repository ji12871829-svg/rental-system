// Executive dashboard operations row — the chart band: "Cash Flow & Collection
// Trajectory" (expected vs collected, last 6 reported months) on the left and
// the Bulk Operations action list on the right.
//
// The chart reads `charts.expectedVsCollected` straight from the dashboard
// payload, so the bars behind the KPI cards and the KPI numbers themselves are
// the same series — they cannot drift apart. The bulk rows deep-link to the
// pages that do the work (reminders, payment capture, water totals, M-Pesa
// reconciliation) and carry live counts where a cheap source exists.
import { ChevronRight, ClipboardCheck, Droplets, MessageSquareText, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from '../charts';
import { ChartCard } from './primitives';
import { BulkReminderButton } from '../BulkReminderButton';
import { useFetch } from '../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { MONTHS, money, plural } from '../../lib/format';
import { currentReportingMonth } from './ExecOverview';
import type { DashboardData } from '@rpms/shared';
import type { ArrearRow } from '../../pages/Arrears';

// Axis ticks compact the currency: 92000 → "92k" (the tooltip shows the full
// amount, so precision is not lost — only the label is shortened).
function axisMoney(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

interface ExecTrajectoryProps {
  data: DashboardData;
}

/** Expected-vs-collected grouped bars for the last six reported months. */
export function ExecTrajectory({ data }: ExecTrajectoryProps) {
  const { charts, currency, reportingYear } = data;
  const month = currentReportingMonth(reportingYear);

  const rows = charts.expectedVsCollected
    .filter((s) => s.month <= month)
    .slice(-6)
    .map((s) => ({
      label: (MONTHS[s.month - 1] ?? '').slice(0, 3),
      expected: s.expected,
      collected: s.collected,
    }));

  const series = [
    { key: 'expected', label: 'Expected', color: '#bfdbfe' },
    { key: 'collected', label: 'Collected', color: '#11a8ff' },
  ] as const;

  return (
    <ChartCard
      title="Cash Flow & Collection Trajectory"
      to="/monthly"
      meta={
        <span className="rounded-md border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-600">
          Last {rows.length || 6} months
        </span>
      }
    >
      <div className="mb-2 flex gap-4 text-[11px] text-gray-500">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis tickFormatter={(v: number) => axisMoney(v)} />
          <Tooltip formatter={(v: number) => money(v, currency)} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

interface ExecBulkOpsProps {
  data: DashboardData;
  /** Arrears rows shared with the KPI row and watchlist (null while loading). */
  arrears: ArrearRow[] | null;
}

/** Row shape of the M-Pesa review queue — only the count is needed here. */
interface MpesaReviewRow {
  id: number;
  amount: string;
  status: string;
}

/** Bulk operations list: deep-links with live counts + saved-template chips. */
export function ExecBulkOps({ data, arrears }: ExecBulkOpsProps) {
  const { user } = useAuth();
  // The review queue is manager/admin-only; staff skip the request entirely
  // (a 403 from a widget nobody can use is noise, not feedback).
  const isManager = user?.role === 'ADMIN' || user?.role === 'PROPERTY_MANAGER';

  const inArrears = arrears ? arrears.filter((r) => r.rentBalance > 0 || r.waterBalance > 0).length : null;
  const waterUnits = data.charts.outstandingWaterByUnit.filter((w) => w.waterOutstanding > 0).length;

  // NB: the review queue is mounted at /api/mpesa/review (see routes/mpesaReview.ts
  // — it hangs off the mpesa router). The page route is the plural-looking
  // "/mpesa-review"; the API path is not, and using it 404s.
  const mpesa = useFetch<MpesaReviewRow[]>(
    () => api.list<MpesaReviewRow>('/api/mpesa/review').then((r) => r.data),
    [],
    { enabled: isManager },
  );
  const templates = useFetch(() => api.templateKinds(), []);
  const savedTemplates = templates.data?.data ?? [];
  const smsTemplates = savedTemplates.filter((t) => t.channel === 'SMS' && t.customized);
  const emailTemplates = savedTemplates.filter((t) => t.channel === 'EMAIL' && t.customized);

  const rows: { to: string; icon: React.ReactNode; title: string; meta: string }[] = [
    {
      to: '/sms?compose=arrears',
      icon: <MessageSquareText size={15} strokeWidth={1.75} />,
      title: 'Review rent reminders',
      meta: inArrears === null ? 'Checking arrears…' : inArrears === 0 ? 'Nobody is in arrears' : `${plural(inArrears, 'tenant')} in arrears`,
    },
    {
      to: '/rent?new=1',
      icon: <Wallet size={15} strokeWidth={1.75} />,
      title: 'Collect rent / STK push',
      meta: inArrears === null ? 'Record a payment' : `${plural(inArrears, 'invoice')} awaiting payment`,
    },
    {
      to: '/water',
      icon: <Droplets size={15} strokeWidth={1.75} />,
      title: 'Compute water sub-totals',
      meta: `${plural(waterUnits, 'unit')} with a balance`,
    },
    ...(isManager
      ? [
          {
            to: '/mpesa-review',
            icon: <ClipboardCheck size={15} strokeWidth={1.75} />,
            title: 'M-Pesa reconciliation',
            meta: mpesa.data ? `${mpesa.data.length} unmatched` : 'Checking queue…',
          },
        ]
      : []),
  ];

  const templateChips = [
    ...smsTemplates.map((t) => ({ key: `sms-${t.kind}`, to: `/sms?new=1&template=${t.kind}`, label: t.label, channel: 'SMS' })),
    ...emailTemplates.map((t) => ({ key: `email-${t.kind}`, to: `/emails/campaign?new=1&template=${t.kind}`, label: t.label, channel: 'Email' })),
  ];

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Bulk Operations</h3>
        <span className="text-[11px] font-medium text-gray-400">One click, straight to the task</span>
      </div>

      <div className="mt-3">
        {/* One click: personalised balance SMS to everyone owing rent or water. */}
        <BulkReminderButton owingCount={inArrears} className="w-full" />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <Link
            key={row.to}
            to={row.to}
            className="group flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-[border-color,background-color] duration-150 hover:border-brand-500 hover:bg-brand-50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors duration-150 group-hover:bg-brand-500 group-hover:text-white" aria-hidden>
              {row.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-gray-900">{row.title}</span>
              <span className="block truncate text-[11px] text-gray-500">{row.meta}</span>
            </span>
            <ChevronRight size={15} strokeWidth={2} className="shrink-0 text-gray-400 transition-colors duration-150 group-hover:text-brand-600" aria-hidden />
          </Link>
        ))}
      </div>

      {/* Saved templates — the customize-once shortcuts from the old quick
          actions, kept so a tuned message is one click away from here. */}
      {templateChips.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400">Saved templates</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {templateChips.map((chip) => (
              <Link
                key={chip.key}
                to={chip.to}
                title={`${chip.channel} template`}
                className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-700 transition-colors duration-150 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700"
              >
                {chip.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
