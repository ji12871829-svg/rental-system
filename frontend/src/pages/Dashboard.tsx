// Dashboard page: owns the live-polling state machine only. Every visual
// band is a presentational component under components/dashboard/ — now
// modeled on the xampp RMS dashboard sections (design-system.css) so the
// local dashboard reads like the xampp RMS dashboard: onboarding card,
// metric row (arrears + advance), stats row (rent collection donut +
// occupancy donut), content row (arrears table + quick actions), balance
// row (net position + SMS balance), and financial-trends bar chart.
//
// The shared DashboardData contract (backend dashboard() → @rpms/shared)
// carries everything these sections need; the new `cashflow` chart field was
// added to the shared type so the financial-trends chart and the backend
// cannot drift apart.
import { PageHeader, useFetch, SkeletonDashboard } from '../components/ui';
import {
  XrmOnboardingCard,
  XrmArrearsMetricCards,
  XrmStatsDonutCards,
  XrmContentRow,
  QuickActionsCard,
  XrmBalanceRow,
  XrmFinancialTrends,
  XrmDeliveryStrip,
} from '../components/dashboard/XrmSections';
import type { DashboardData } from '@rpms/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

// Live-poll cadence for the dashboard strip. Quiet by design: failed polls
// keep the last good data on screen (the next tick retries silently),
// hidden tabs skip ticks entirely, and returning to the tab refetches
// immediately so the strip is current the moment you look at it.
const POLL_MS = 60_000;

export default function Dashboard() {
  const { user } = useAuth();
  const { data: latest, loading, error, refresh } = useFetch<DashboardData>(() =>
    api.get<{ data: DashboardData }>('/api/reports/dashboard').then((r) => r.data),
  []);
  const templatesData = useFetch(() => api.templateKinds(), []);
  const cardTemplates = templatesData.data?.data ?? [];
  const cardSelectedKinds = useMemo(() => ({
    sms: cardTemplates.filter((t) => t.channel === 'SMS' && t.customized).sort((a, b) => a.label.localeCompare(b.label)),
    email: cardTemplates.filter((t) => t.channel === 'EMAIL' && t.customized).sort((a, b) => a.label.localeCompare(b.label)),
  }), [cardTemplates]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const lastJsonRef = useRef<string>('');

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

  const { reportingYear, currency, property, charts, sms, email, combined } = data;

  // xampp RMS-style dashboard section order:
  //   1. Onboarding card (hidden at 100%)
  //   2. Metric row — Tenant Arrears + Tenant Advance
  //   3. Stats row — Rent Collection donut + Portfolio Occupancy donut
  //   4. Content row — Arrears table + Quick Actions card
  //   5. Balance row — Net Position + SMS Balance
  //   6. Financial trends bar chart (payments / invoices / expenses)
  //   7. Delivery strip (SMS + email health) — compact, replaces the local
  //      HealthCards; tucked under the balance row.
  const outstandingRentUnits = charts.outstandingRentByUnit.filter((r) => r.outstanding > 0).length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Reporting year ${reportingYear} — everything below updates automatically from recorded transactions`}
      />

      {/* 1. Onboarding card — xampp RMS .onboarding-card */}
      <div className="rise-in">
        <XrmOnboardingCard reportingYear={reportingYear} sms={sms} email={email} totalUnits={property.totalUnits} />
      </div>

      {/* 2. Metric row — xampp RMS .metric-row (Tenant Arrears + Tenant Advance) */}
      <div className="mt-5 rise-in" style={{ animationDelay: '40ms' }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" /> Tenant Overview
        </div>
        <XrmArrearsMetricCards data={{ combined, currency, reportingYear, outstandingRentUnits }} />
      </div>

      {/* 3. Stats row — xampp RMS .stats-row (Rent Collection donut + Occupancy donut) */}
      <div className="mt-5 rise-in" style={{ animationDelay: '80ms' }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" /> KPIs
        </div>
        <XrmStatsDonutCards data={{ property, currency, reportingYear }} />
      </div>

      {/* 4. Content row — xampp RMS .content-row (Arrears table + Quick Actions card) */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rise-in lg:col-span-2" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" /> Arrears
          </div>
          <XrmContentRow reportingYear={reportingYear} />
        </div>
        <div className="rise-in" style={{ animationDelay: '120ms' }}>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" /> Quick Actions
          </div>
          <QuickActionsCard userRole={user?.role ?? 'STAFF'} selectedSmsKinds={cardSelectedKinds.sms} selectedEmailKinds={cardSelectedKinds.email} />
        </div>
      </div>

      {/* 5. Balance row — xampp RMS .balance-row (Net Position + SMS Balance) */}
      <div className="mt-5 rise-in" style={{ animationDelay: '160ms' }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" /> Balances
        </div>
        <XrmBalanceRow data={{ sms, combined, currency, reportingYear }} />
      </div>

      {/* 6. Financial trends — xampp RMS .chart-card financial-trends bar chart */}
      <div className="mt-5 rise-in" style={{ animationDelay: '200ms' }}>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-300" /> Financial Trends
        </div>
        <XrmFinancialTrends charts={charts} currency={currency} />
      </div>

      {/* 7. Delivery strip — compact SMS + email health (replaces local HealthCards) */}
      <div className="mt-5 rise-in" style={{ animationDelay: '220ms' }}>
        <XrmDeliveryStrip data={{ sms, email }} />
      </div>
    </div>
  );
}
