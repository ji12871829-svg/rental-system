// The three KPI bands (Property, Water, Combined) — presentational section
// extracted verbatim from pages/Dashboard.tsx. All data comes from the
// dashboard payload; the combined strip's "this month" deep link is computed
// from the current date, exactly as before.
import { money } from '../../lib/format';
import { Count, CountMoney } from '../CountUp';
import { Badge, BigFigure, CombinedCell, FigureRow, KpiCard, OccupancyBar, SectionHead } from './primitives';
import type { DashboardData } from '@rpms/shared';

export function KpiBand({ data }: { data: DashboardData }) {
  const { property: p, water: w, combined: c, currency } = data;

  // Derived presentation figures for the badges and progress bars.
  const occPct = p.totalUnits > 0 ? Math.round((p.occupiedUnits / p.totalUnits) * 100) : 0;
  const vacPct = Math.max(0, 100 - occPct);
  const revenue = p.rentCollected + w.waterCollected;
  const marginPct = revenue > 0 ? Math.round((p.netPropertyIncome / revenue) * 100) : 0;
  const waterSurplusPct = w.surplus && w.waterSupplyCost > 0 ? Math.round((w.surplusDeficit / w.waterSupplyCost) * 100) : null;

  return (
    <>
      {/* -------------------------------------------------- PROPERTY band */}
      <SectionHead label="Property" caption={`All ${p.totalUnits} units · live from the rent ledger`} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiCard
          title="Units Allocation"
          linkTo="/units"
          linkLabel="View all units"
          footer={<span><Count value={p.vacantUnits} /> vacant · turnover visible on the Units page</span>}
        >
          <BigFigure value={<Count value={p.totalUnits} />} caption="Total units" />
          <div className="mt-3">
            <OccupancyBar total={p.totalUnits} occupied={p.occupiedUnits} vacant={p.vacantUnits} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="good">{p.occupiedUnits} Occupied ({occPct}%)</Badge>
              {p.vacantUnits > 0 && <Badge tone="warn">{p.vacantUnits} Vacant ({vacPct}%)</Badge>}
            </div>
          </div>
        </KpiCard>

        <KpiCard
          title="Monthly Rent Ledger"
          badge={<Badge tone="good">{p.rentCollectionRate}% YTD Collected</Badge>}
          linkTo="/rent"
          linkLabel="Rent"
          footer={
            <span>
              Collected: <span className="font-semibold text-emerald-600">{money(p.rentCollected, currency)}</span>
              {' · '}Arrears: <span className="font-semibold text-red-600">{money(p.rentOutstanding, currency)}</span>
            </span>
          }
        >
          <BigFigure
            value={<CountMoney value={p.expectedRent} currency={currency} />}
            caption="Expected rent (this month)"
          />
        </KpiCard>

        <KpiCard
          title="Property Financial Yield"
          badge={
            <Badge tone={marginPct >= 0 ? 'good' : 'bad'} title="Net income as a share of money collected">
              {marginPct >= 0 ? '+' : ''}{marginPct}% Margin
            </Badge>
          }
          linkTo="/expenses"
          linkLabel="Expense ledger"
          footer={<span>Maintenance &amp; ops outflow: <span className="font-semibold text-amber-600">{money(p.totalExpenses, currency)}</span></span>}
        >
          <BigFigure
            value={<CountMoney value={p.netPropertyIncome} currency={currency} />}
            caption="Net property income"
            tone={p.netPropertyIncome >= 0 ? 'good' : 'bad'}
          />
        </KpiCard>
      </div>

      {/* ----------------------------------------------------- WATER band */}
      <div className="mt-8">
        <SectionHead label="Water" caption="Bulk distribution & meter yield" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <KpiCard
            title="Water Invoicing & Recovery"
            badge={<Badge tone={w.collectionRate >= 90 ? 'good' : w.collectionRate >= 70 ? 'warn' : 'bad'}>{w.collectionRate}% collection</Badge>}
            linkTo="/water-meter"
            linkLabel="Meter registry"
            footer={<span>Sub-metered usage — readings from each unit's meter</span>}
          >
            <FigureRow
              items={[
                { label: 'Total billed', value: <CountMoney value={w.waterBilled} currency={currency} /> },
                { label: 'Collected', value: <CountMoney value={w.waterCollected} currency={currency} />, tone: 'good' },
                { label: 'Outstanding', value: <CountMoney value={w.waterOutstanding} currency={currency} />, tone: w.waterOutstanding > 0 ? 'bad' : 'good' },
              ]}
            />
          </KpiCard>

          <KpiCard
            title="Bulk Inflow & Gross Margin"
            badge={
              waterSurplusPct != null ? (
                <Badge tone="good" title="Water surplus as a share of supply cost">+{waterSurplusPct}% Surplus</Badge>
              ) : w.surplus ? undefined : (
                <Badge tone="bad">Running deficit</Badge>
              )
            }
            linkTo="/water-supply"
            linkLabel="Water supply"
            footer={<span>Bulk purchase → per-unit sub-meter billing</span>}
          >
            <FigureRow
              items={[
                { label: 'Purchased', value: <><Count value={w.waterPurchased} /> units</>, caption: 'Metered volume' },
                { label: 'Supply cost', value: <CountMoney value={w.waterSupplyCost} currency={currency} />, caption: `avg ${money(w.averagePurchaseCost, currency)}/unit` },
                {
                  label: w.surplus ? 'Surplus' : 'Deficit',
                  value: <CountMoney value={Math.abs(w.surplusDeficit)} currency={currency} />,
                  tone: w.surplus ? 'good' : 'bad',
                },
              ]}
            />
          </KpiCard>
        </div>
      </div>

      {/* ------------------------------------------------- COMBINED band */}
      <div className="mt-8">
        <SectionHead label="Combined" caption="Consolidated real-time position" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <CombinedCell
            label="Rent + Water Due (this month)"
            value={<CountMoney value={c.totalDueThisMonth} currency={currency} />}
            caption="Total operational billing"
            to={`/monthly?month=${new Date().getMonth() + 1}`}
          />
          <CombinedCell
            label="Total Money Collected"
            value={<CountMoney value={c.totalCollected} currency={currency} />}
            caption={<span>Rent {money(c.rentCollected, currency)} + Water {money(c.waterCollected, currency)}</span>}
            tone="good"
            to="/receipts"
          />
          <CombinedCell
            label="Total Outstanding"
            value={<CountMoney value={c.totalOutstanding} currency={currency} />}
            caption={c.totalOutstanding > 0 ? 'Default/arrears risk' : 'All current'}
            tone={c.totalOutstanding > 0 ? 'bad' : 'good'}
            to="/arrears"
          />
          <CombinedCell
            label="Total Expenses"
            value={<CountMoney value={c.totalExpenses} currency={currency} />}
            caption="Repairs, bulk power & crew"
            tone="warn"
            to="/expenses"
          />
          <CombinedCell
            label="Net Property Income"
            value={<CountMoney value={c.netIncome} currency={currency} />}
            caption={c.netIncome >= 0 ? 'Consolidated net positive' : 'Negative — review expenses'}
            tone={c.netIncome >= 0 ? 'good' : 'bad'}
          />
        </div>
      </div>
    </>
  );
}
