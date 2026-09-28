import { Link } from 'react-router-dom';
import { PageHeader, SkeletonTable, StatGroupCard, useFetch } from '../../components/ui';
import { Toon } from '../../components/Toon';
import { money } from '../../lib/format';
import { portalApi } from '../../lib/portalApi';
import { usePortalAuth } from '../../lib/portalAuth';

// Shape produced by getPortalSummary (backend/src/services/tenantPortalService.ts).
export interface PortalSummary {
  identity: {
    tenantId: number;
    name: string;
    unitNumber: string | null;
    unitType: string | null;
    monthlyRent: number;
    moveInDate: string | null;
    waterEnabled: boolean;
  };
  currency: string;
  reportingYear: number;
  rentThisMonth: { billed: number; paid: number; balance: number; status: string };
  waterThisMonth: { billed: number; paid: number; balance: number; consumption: number | null };
  ytd: {
    rentPaid: number; waterPaid: number; totalPaid: number;
    rentBalance: number; waterBalance: number; totalBalance: number;
  };
  deposit: number;
}

export default function PortalHome() {
  const { tenant } = usePortalAuth();
  const { data: summary, loading, error } = useFetch(
    () => portalApi.get<{ data: PortalSummary }>('/api/portal/summary'),
    [],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Welcome…" />
      <div className="space-y-4">
        <SkeletonTable cols={4} rows={2} />
      </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-ash bg-white p-10 text-center">
        <Toon size={84} pose="idle" className="shrink-0" />
        <p className="max-w-sm text-sm leading-6 text-graphite">
          We couldn&rsquo;t load your summary just now —{' '}
          <span className="font-medium text-red-700">{error}</span>. Check your connection and try again in a
          moment; your data is safe on the server.
        </p>
      </div>
    );
  }
  if (!summary) return null;

  const s = summary.data;
  const fmt = (n: number | null | undefined) => money(n ?? 0, s.currency);
  const owing = s.ytd.totalBalance > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${s.identity.name.split(' ')[0]}`}
        subtitle={`Unit ${s.identity.unitNumber ?? '—'} · ${s.identity.unitType ?? ''} · ${tenant?.email ?? ''}`}
      />

      <div
        className={`rounded-xl border border-ash bg-white px-4 py-4 ${
          owing ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-emerald-500'
        }`}
      >
        <p className="text-sm font-medium text-gray-600">
          {owing ? 'Your total balance' : 'You are all settled up'}
        </p>
        <p className={`mt-1 text-2xl font-semibold ${owing ? 'text-red-700' : 'text-green-700'}`}>
          {fmt(Math.max(0, s.ytd.totalBalance))}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Rent {fmt(Math.max(0, s.ytd.rentBalance))}
          {s.identity.waterEnabled ? ` · Water ${fmt(Math.max(0, s.ytd.waterBalance))}` : ''} ·
          as at {s.reportingYear}
        </p>
        {owing && (
          <Link to="/portal/payments" className="press mt-2 inline-block rounded text-sm font-medium text-brand-600 hover:underline active:scale-[0.98]">
            Send money to clear this →
          </Link>
        )}
      </div>

      <StatGroupCard
        title={`This month (${new Date().toLocaleString('en', { month: 'long' })} ${s.reportingYear})`}
        stats={[
          { label: 'Rent billed', value: fmt(s.rentThisMonth.billed) },
          { label: 'Rent paid', value: fmt(s.rentThisMonth.paid) },
          { label: 'Rent balance', value: fmt(s.rentThisMonth.balance) },
          ...(s.identity.waterEnabled
            ? [
                { label: 'Water billed', value: fmt(s.waterThisMonth.billed) },
                { label: 'Water paid', value: fmt(s.waterThisMonth.paid) },
                ...(s.waterThisMonth.consumption != null
                  ? [{ label: 'Units used', value: `${s.waterThisMonth.consumption}` }]
                  : []),
              ]
            : []),
        ]}
      />

      <StatGroupCard
        title={`Year ${s.reportingYear} so far`}
        stats={[
          { label: 'Rent paid', value: fmt(s.ytd.rentPaid) },
          ...(s.identity.waterEnabled ? [{ label: 'Water paid', value: fmt(s.ytd.waterPaid) }] : []),
          { label: 'Total paid', value: fmt(s.ytd.totalPaid) },
          { label: 'Deposit held', value: fmt(s.deposit) },
        ]}
      />
    </div>
  );
}
