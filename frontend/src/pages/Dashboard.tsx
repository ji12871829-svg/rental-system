// Dashboard page: owns the live-polling state machine only. Every visual
// band is a presentational component under components/dashboard/ —
// KpiBand (property/water/combined figures), HealthCards (provider strip),
// and ChartGrid (the nine charts). The payload type is the shared contract
// from @rpms/shared — the same interface the backend's dashboard() is
// annotated to return, so the two sides cannot drift apart.
import { PageHeader, useFetch, SkeletonDashboard } from '../components/ui';
import { QuickActions } from '../components/QuickActions';
import { KpiBand } from '../components/dashboard/KpiBand';
import { ChartGrid } from '../components/dashboard/ChartGrid';
import { HealthCards } from '../components/dashboard/HealthCards';
import type { DashboardData } from '@rpms/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

// Live-poll cadence for the KPI strip and provider health. Quiet by design:
// failed polls keep the last good data and retry next tick, hidden tabs skip
// ticks entirely, and returning to the tab refetches immediately.
const POLL_MS = 60_000;

export default function Dashboard() {
  // Live dashboard: refetch every 60s while the page is open. Polls stay
  // calm by design: a failed poll keeps the last good KPIs on screen (the
  // next tick retries silently) and identical payloads never re-render.
  const { data: latest, loading, error, refresh } = useFetch<DashboardData>(() =>
    api.get<{ data: DashboardData }>('/api/reports/dashboard').then((r) => r.data)
  );
  const [data, setData] = useState<DashboardData | null>(null);
  // Set only when a poll fails BEFORE anything has ever loaded — the one
  // case where there is no last-good data to keep showing.
  const [fatalError, setFatalError] = useState<string | null>(null);
  // A poll returning identical data still yields a fresh object; this ref
  // detects real change so unchanged payloads skip setData entirely.
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

  // The 60s tick pauses in hidden tabs (browsers throttle timers there
  // anyway); returning to the tab refetches immediately so the strip is
  // current the moment you look at it.
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

  // Quick actions are shared with the mobile drawer (QuickActions component):
  // each lands with ?new=1 to open or focus the target page's form.

  // Skeleton and error pages are for the FIRST load only; once data exists,
  // polls refresh in place and transient failures keep last-good numbers.
  if (!data) {
    if (loading) return <SkeletonDashboard />;
    if (fatalError) return <div className="text-sm text-red-600">Unable to load dashboard: {fatalError}</div>;
    return null;
  }

  const { reportingYear } = data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Reporting year ${reportingYear} — everything below updates automatically from recorded transactions`}
        actions={<QuickActions variant="header" />}
      />

      <KpiBand data={data} />
      <HealthCards data={data} />
      <ChartGrid
        charts={data.charts}
        currency={data.currency}
        reportingYear={reportingYear}
        water={data.water}
      />
    </div>
  );
}
