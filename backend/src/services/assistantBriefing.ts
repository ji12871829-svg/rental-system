// Morning briefing: deterministic insights computed from live data — never
// LLM-generated, so a suggestion can never hallucinate a tenant, a balance,
// or an urgency that is not in the ledger. At most 6 items, severity order:
// biggest money first, then longest overdue, then collection pace, then
// water spikes. Served to the UI greeting (GET /briefing) and to the model
// (get_briefing tool) from this one function.
import { arrears } from './financeService';
import { query } from '../config/db';
import { toNumber } from '../utils/money';

export interface BriefingItem {
  kind: 'top_debtor' | 'longest_overdue' | 'collection_pace' | 'water_spike' | 'unpaid_count';
  title: string;
  detail: string;
  tenantId?: number;
  unitNumber?: string;
  linkTo?: string;
}

interface ArrearsBriefRow {
  tenantId: number;
  tenantName: string;
  unitNumber: string;
  totalOutstanding: number;
  rentBalance: number;
  waterBalance: number;
  totalAmountDue: number;
  totalPaid: number;
  monthsInArrears: number;
  status: string;
}

export async function getBriefing(year: number): Promise<BriefingItem[]> {
  const rows = (await arrears(year)) as unknown as ArrearsBriefRow[];
  const open = rows.filter((r) => r.totalOutstanding > 0);
  const items: BriefingItem[] = [];

  for (const r of [...open].sort((a, b) => b.totalOutstanding - a.totalOutstanding).slice(0, 3)) {
    items.push({
      kind: 'top_debtor',
      title: `${r.tenantName} (Unit ${r.unitNumber}) owes KSh ${r.totalOutstanding.toLocaleString('en-KE')}`,
      detail: `Rent balance KSh ${r.rentBalance.toLocaleString('en-KE')}, water KSh ${r.waterBalance.toLocaleString('en-KE')}, ${r.status.toLowerCase()}.`,
      tenantId: r.tenantId,
      unitNumber: r.unitNumber,
      linkTo: '/arrears',
    });
  }

  const longest = [...open].sort((a, b) => b.monthsInArrears - a.monthsInArrears)[0];
  if (longest && longest.monthsInArrears >= 2 && !items.some((i) => i.tenantId === longest.tenantId)) {
    items.push({
      kind: 'longest_overdue',
      title: `${longest.tenantName} (Unit ${longest.unitNumber}) is ${longest.monthsInArrears} months behind`,
      detail: `Longest open stretch on the books — consider a visit before it grows.`,
      tenantId: longest.tenantId,
      unitNumber: longest.unitNumber,
      linkTo: '/arrears',
    });
  }

  const expected = open.reduce((s, r) => s + r.totalAmountDue, 0);
  const paid = open.reduce((s, r) => s + r.totalPaid, 0);
  if (expected > 0) {
    const pct = Math.round((paid / expected) * 100);
    items.push({
      kind: 'collection_pace',
      title: `Collection at ${pct}% of what is due`,
      detail: `KSh ${paid.toLocaleString('en-KE')} in against KSh ${expected.toLocaleString('en-KE')} expected across debtors.`,
      linkTo: '/monthly',
    });
  }

  const latest = await query<{ unit_number: string; tenant_id: number | null; cur: string; prev: string | null }>(
    `SELECT u.unit_number, t.id AS tenant_id, r.current_reading AS cur, r.previous_reading AS prev
     FROM water_meter_readings r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN tenants t ON t.unit_id = u.id AND t.status = 'ACTIVE'
     WHERE r.billing_year = $1 AND r.previous_reading IS NOT NULL
     ORDER BY r.reading_date DESC LIMIT 50`,
    [year],
  );
  const seen = new Set<string>();
  let spikeCount = 0;
  for (const s of latest) {
    if (spikeCount >= 3) break;
    if (s.tenant_id == null) continue;
    if (seen.has(s.unit_number)) continue;
    seen.add(s.unit_number);
    const cur = toNumber(s.cur) - toNumber(s.prev);
    if (cur <= 0) continue;
    // Previous consumption: the reading before this one (second-latest
    // current minus third-latest current). Defaults to the current
    // consumption when history is short, which can never trigger the flag.
    const hist = await query<{ cur: string; prev: string | null }>(
      `SELECT current_reading AS cur, previous_reading AS prev FROM water_meter_readings
       WHERE unit_id = (SELECT id FROM units WHERE unit_number = $1)
       ORDER BY reading_date DESC LIMIT 3`,
      [s.unit_number],
    );
    let prevCons = cur;
    if (hist.length >= 3) {
      prevCons = toNumber(hist[1].cur) - toNumber(hist[2].cur);
    }
    if (prevCons <= 0) continue;
    if (cur > 2 * prevCons) {
      items.push({
        kind: 'water_spike',
        title: `Unit ${s.unit_number} water use spiked`,
        detail: `${cur} units vs ${prevCons} previous — possible leak, consider checking the meter.`,
        tenantId: s.tenant_id,
        unitNumber: s.unit_number,
        linkTo: '/water',
      });
      spikeCount += 1;
    }
  }

  if (open.length > 0) {
    items.push({
      kind: 'unpaid_count',
      title: `${open.length} tenant${open.length === 1 ? '' : 's'} with an open balance`,
      detail: `Full list is one click away on the arrears page.`,
      linkTo: '/arrears',
    });
  }
  return items.slice(0, 6);
}
