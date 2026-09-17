import { PageHeader, SkeletonTable, useFetch } from '../../components/ui';
import { money } from '../../lib/format';
import { portalApi } from '../../lib/portalApi';

// Shape produced by getPortalWaterReadings.
interface PortalWaterReading {
  reading_date: string;
  billing_month: number;
  billing_year: number;
  previous_reading: number | null;
  current_reading: number;
  consumption: number;
  water_rate: number;
  water_bill: number;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function PortalWater() {
  const { data, loading, error } = useFetch(
    () => portalApi.get<{ data: PortalWaterReading[] }>('/api/portal/water'),
    [],
  );

  if (loading) return <SkeletonTable cols={6} />;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  const readings = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Water" subtitle="Meter readings and charges for your unit" />

      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Reading history</h3>
        </div>
        {readings.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500">No readings recorded for your unit yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2 font-medium">Month</th>
                  <th className="px-4 py-2 font-medium">Read on</th>
                  <th className="px-4 py-2 font-medium">Previous</th>
                  <th className="px-4 py-2 font-medium">Current</th>
                  <th className="px-4 py-2 font-medium">Units used</th>
                  <th className="px-4 py-2 text-right font-medium">Charge</th>
                </tr>
              </thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={`${r.billing_year}-${r.billing_month}-${i}`} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{MONTHS[r.billing_month]} {r.billing_year}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.reading_date?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.previous_reading ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.current_reading}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.consumption}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="font-medium text-gray-900">{money(r.water_bill)}</span>
                      <span className="ml-2 text-xs text-gray-500">@ {money(r.water_rate)}/unit</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
