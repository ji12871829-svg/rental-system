// Building cost estimator — free public tool. Indicative 2026 Nairobi-market
// rate bands per square metre, adjusted by finish level and county zone.
// Pure estimateCost() is unit-tested; the page is a thin form over it.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Field, PageHeader, Select, TextInput } from '../components/ui';

export interface EstimateInput {
  dwelling: 'bedsitter' | '1br' | '2br' | '3br' | 'maisonette';
  sizeSqm: number;
  finish: 'basic' | 'standard' | 'executive';
  zone: 'nairobi' | 'metro' | 'upcountry';
}

// Indicative construction rates (KES per sqm) — ranges, not quotes.
const RATES: Record<EstimateInput['finish'], [number, number]> = {
  basic: [35000, 45000],
  standard: [50000, 65000],
  executive: [75000, 95000],
};

const ZONE_FACTOR: Record<EstimateInput['zone'], number> = {
  nairobi: 1,
  metro: 0.95,
  upcountry: 0.9,
};

export const ZONE_LABEL: Record<EstimateInput['zone'], string> = {
  nairobi: 'Nairobi',
  metro: 'Kiambu / Kajiado / Machakos / Nakuru / Mombasa / Kisumu',
  upcountry: 'Other counties',
};

export interface EstimateResult {
  low: number;
  high: number;
  breakdown: { label: string; share: number; low: number; high: number }[];
}

export function estimateCost(input: EstimateInput): EstimateResult | null {
  if (!Number.isFinite(input.sizeSqm) || input.sizeSqm <= 0 || input.sizeSqm > 10000) return null;
  const [rl, rh] = RATES[input.finish];
  const f = ZONE_FACTOR[input.zone];
  const low = Math.round(input.sizeSqm * rl * f);
  const high = Math.round(input.sizeSqm * rh * f);
  const parts: [string, number][] = [
    ['Structure & shell', 0.55],
    ['Finishes (floor, paint, joinery)', 0.25],
    ['Services (electrical, plumbing)', 0.12],
    ['Contingency', 0.08],
  ];
  return {
    low,
    high,
    breakdown: parts.map(([label, share]) => ({
      label,
      share,
      low: Math.round(low * share),
      high: Math.round(high * share),
    })),
  };
}

export const fmt = (n: number): string => `KES ${n.toLocaleString()}`;

export default function CostEstimator() {
  const [dwelling, setDwelling] = useState<EstimateInput['dwelling']>('2br');
  const [size, setSize] = useState('80');
  const [finish, setFinish] = useState<EstimateInput['finish']>('standard');
  const [zone, setZone] = useState<EstimateInput['zone']>('nairobi');

  const result = useMemo(
    () => estimateCost({ dwelling, sizeSqm: Number(size), finish, zone }),
    [dwelling, size, finish, zone]
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/landing" className="text-sm font-bold text-gray-900">Olbano Plaza</Link>
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <PageHeader
          title="Building Cost Estimator"
          subtitle="Indicative ranges for Kenyan residential construction — free, no signup"
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <Field label="Dwelling type">
              <Select value={dwelling} onChange={(e) => setDwelling(e.target.value as EstimateInput['dwelling'])}>
                <option value="bedsitter">Bedsitter</option>
                <option value="1br">1 bedroom</option>
                <option value="2br">2 bedroom</option>
                <option value="3br">3 bedroom</option>
                <option value="maisonette">Maisonette</option>
              </Select>
            </Field>
            <Field label="Plinth area (square metres)" hint="Measure wall-to-wall floor area across all floors.">
              <TextInput type="number" min="10" max="10000" value={size} onChange={(e) => setSize(e.target.value)} placeholder="80" />
            </Field>
            <Field label="Finish level">
              <Select value={finish} onChange={(e) => setFinish(e.target.value as EstimateInput['finish'])}>
                <option value="basic">Basic — standard materials</option>
                <option value="standard">Standard — mid-range fittings</option>
                <option value="executive">Executive — premium finishes</option>
              </Select>
            </Field>
            <Field label="Location">
              <Select value={zone} onChange={(e) => setZone(e.target.value as EstimateInput['zone'])}>
                {(Object.keys(ZONE_LABEL) as EstimateInput['zone'][]).map((z) => (
                  <option key={z} value={z}>{ZONE_LABEL[z]}</option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/templates" className="text-xs font-medium text-brand-600 hover:text-brand-700">Document templates →</Link>
              <Link to="/tenancy-agreement" className="text-xs font-medium text-brand-600 hover:text-brand-700">Tenancy generator →</Link>
            </div>
            <p className="text-[11px] text-gray-500">Indicative 2026 market bands for budgeting only — not a quotation. Land cost, approvals and professional fees are excluded.</p>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Estimate</div>
            {!result ? (
              <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Enter a plinth area between 1 and 10,000 m².</div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="text-2xl font-bold text-gray-900">{fmt(result.low)} – {fmt(result.high)}</div>
                <div className="mt-4 space-y-2">
                  {result.breakdown.map((b) => (
                    <div key={b.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gray-600">{b.label} ({Math.round(b.share * 100)}%)</span>
                      <span className="font-medium tabular-nums text-gray-900">{fmt(b.low)} – {fmt(b.high)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <Button onClick={() => window.print()}>Print / Save PDF</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
