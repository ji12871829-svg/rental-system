import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from '../charts';
import { money } from '../../lib/format';
import { ChartCard } from './primitives';
import type { DashboardData } from '@rpms/shared';

interface FinancialTrendsProps {
  charts: Pick<DashboardData['charts'], 'cashflow' | 'expectedVsCollected' | 'monthlyWaterBilledVsCollected'>;
  currency: string;
}

// xampp RMS financial-trends chart: 3 bars per month — Payments (collected,
// green), Invoices (billed, navy), Expenses (light blue). Local adaptation:
//   • Payments   = rent collected + water collected that month (cashflow.totalIn)
//   • Invoices   = expected rent + water billed that month (sum of the two
//                 "expected/billed" series in the dashboard payload)
//   • Expenses   = expenses out that month (cashflow.expensesOut)
//
// All three series come from the dashboard payload (cashflow was added to the
// shared type for exactly this chart), so the chart and the dashboard KPIs
// cannot drift apart.
export function XrmFinancialTrends({ charts, currency }: FinancialTrendsProps) {
  const rows = charts.cashflow.map((cf) => {
    const expectedRent = charts.expectedVsCollected.find((e) => e.month === cf.month);
    const waterBilled = charts.monthlyWaterBilledVsCollected.find((w) => w.month === cf.month);
    return {
      month: cf.month,
      monthName: cf.monthName,
      payments: cf.totalIn,
      invoices: (expectedRent?.expected ?? 0) + (waterBilled?.billed ?? 0),
      expenses: cf.expensesOut,
    };
  });

  const series = [
    { key: 'payments', label: 'Payments', color: '#22c55e' },
    { key: 'invoices', label: 'Invoices', color: '#000080' },
    { key: 'expenses', label: 'Expenses', color: '#93c5fd' },
  ] as const;

  return (
    <ChartCard title="Financial Trends" meta="Monthly comparison of payments, invoices, and expenses" to="/monthly">
      <div className="chart-legend flex gap-4 text-[11px] text-gray-500">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={(d: any) => d.monthName} />
          <YAxis />
          <Tooltip formatter={(v: number) => money(v, currency)} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
