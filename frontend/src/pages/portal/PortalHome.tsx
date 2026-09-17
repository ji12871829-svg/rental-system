import { Link } from 'react-router-dom';
import { PageHeader, SkeletonTable, StatGroupCard, useFetch } from '../../components/ui';
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
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
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
        className={`rounded-xl border px-4 py-4 ${
          owing ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
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
          <Link to="/portal/payments" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
            Pay rent now →
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
