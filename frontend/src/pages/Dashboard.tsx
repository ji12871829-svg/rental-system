// Dashboard page: owns the live-polling state machine and the two payloads
// every band below renders. The visual layout follows the Executive Portfolio
// Overview design:
//
//   1. Header      — title, current-cycle badge, date range, Export Pack
//   2. KPI row     — Collected (MTD) · Overdue Arrears · Prepayments · Occupancy
//   3. Chart row   — Cash Flow & Collection Trajectory + Bulk Operations
//   4. Watchlist   — high-priority arrears with per-row actions
//   5. Feed row    — Live Payment Gateway Stream + Unit Turnovers & Repairs
//   6. Delivery    — SMS/email health strip (self-gating: silent when healthy)
//
// The shared DashboardData contract (backend dashboard() → @rpms/shared) feeds
// bands 1–3 and 5; the arrears report is fetched once here and handed to both
// the KPI row and the watchlist so their totals can never disagree.
import { SkeletonDashboard, useFetch } from '../components/ui';
import {
  ExecOverviewHeader,
  ExecKpiRow,
  ExecTrajectory,
  ExecBulkOps,
  ExecWatchlist,
  ExecPaymentStream,
  ExecTurnovers,
} from '../components/dashboard/ExecSections';
import { XrmDeliveryStrip } from '../components/dashboard/XrmDeliveryStrip';
import type { DashboardData } from '@rpms/shared';
import type { ArrearRow } from './Arrears';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

// Live-poll cadence for the dashboard strip. Quiet by design: failed polls
// keep the last good data on screen (the next tick retries silently),
// hidden tabs skip ticks entirely, and returning to the tab refetches
// immediately so the strip is current the moment you look at it.
const POLL_MS = 60_000;

export default function Dashboard() {
  const { data: latest, loading, error, refresh } = useFetch<DashboardData>(() =>
    api.get<{ data: DashboardData }>('/api/reports/dashboard').then((r) => r.data),
  []);
  const [data, setData] = useState<DashboardData | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const lastJsonRef = useRef<string>('');

  // Arrears report — fetched once per reporting year (it is a per-tenant
  // computation, not something to re-run every poll) and shared by the KPI
  // row and the watchlist.
  const arrears = useFetch<ArrearRow[]>(
    () =>
      api
        .get<{ data: ArrearRow[] }>(`/api/reports/arrears?year=${data?.reportingYear ?? ''}`)
        .then((r) => r.data),
    [data?.reportingYear],
    { enabled: !!data },
  );

  useEffect(() => {
    if (!latest) return;
    const json = JSON.stringify(latest);
    if (json === lastJsonRef.current) return;
    lastJsonRef.current = json;
    setData(latest);
  }, [latest]);

  useEffect(() => {
    if (error && !data) setFatalError(error);
    else if (!error || data) setFatalError(null);
  }, [error, data]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // Skeleton and error pages are for the FIRST load only; once data exists,
  // polls refresh in place and transient failures keep last-good numbers.
  if (!data) {
    if (loading) return <SkeletonDashboard />;
    if (fatalError) return <div className="text-sm text-red-600">Unable to load dashboard: {fatalError}</div>;
    return null;
  }

  const { reportingYear, currency, property, sms, email, whatsapp } = data;

  return (
    <div>
      {/* 1. Header — cycle badge + range + Export Pack (→ /monthly) */}
      <ExecOverviewHeader reportingYear={reportingYear} />

      {/* 2. KPI row — collected MTD, arrears, prepayments, occupancy */}
      <ExecKpiRow data={data} arrears={arrears.data} />

      {/* 3. Chart row — trajectory (2/3) + bulk operations (1/3) */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ExecTrajectory data={data} />
        </div>
        <ExecBulkOps data={data} arrears={arrears.data} />
      </div>

      {/* 4. Watchlist — open balances in unit order, actions per row */}
      <div className="mt-5">
        <ExecWatchlist
          rows={arrears.data}
          loading={arrears.loading}
          error={arrears.error}
          currency={currency}
        />
      </div>

      {/* 5. Feed row — latest receipts + repairs/vacancies */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ExecPaymentStream currency={currency} />
        <ExecTurnovers vacantUnits={property.vacantUnits} />
      </div>

      {/* 6. Delivery strip — SMS · WhatsApp · email health; renders nothing when healthy */}
      <XrmDeliveryStrip data={{ sms, email, whatsapp }} />
    </div>
  );
}
