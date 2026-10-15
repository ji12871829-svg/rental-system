// The assistant's action space — deliberately read-only plus one DRAFT
// builder. Nothing here sends, writes, or deletes: draft_reminder returns
// texts the human approves through POST /api/sms/campaign. Adding a tool
// means adding its schema below AND its branch in runTool (unknown names
// throw — the model can never invoke something unwired).
import { arrears, dashboard } from './financeService';
import { tenantBalances } from './tenantLedger';
import { getBriefing } from './assistantBriefing';
import type { ToolDef } from './assistantProvider';

export const BRIEFING_TOOL_DEF: ToolDef = {
  name: 'get_briefing',
  description: 'What needs attention right now: top debtors, longest overdue, collection pace, water spikes. Call this when the user asks what to focus on, or to ground a month-end summary.',
  parameters: { type: 'object', properties: {} },
};

export const TOOL_DEFS: ToolDef[] = [
  BRIEFING_TOOL_DEF,
  {
    name: 'get_arrears_summary',
    description: 'Who owes rent/water: counts and totals by status for a reporting year, plus up to 5 sample debtors (tenantId, name, unit, balance).',
    parameters: { type: 'object', properties: { year: { type: 'number', description: 'Reporting year, e.g. 2026' } }, required: [] },
  },
  {
    name: 'find_tenant',
    description: 'Look up tenants by name fragment, unit number, or phone digits. Returns id, name, unit, phone, and current rent/water balances. Never returns credentials.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, unit number, or phone digits' } }, required: ['query'] },
  },
  {
    name: 'monthly_figures',
    description: 'Collected vs expected rent, outstanding total, and advances for a reporting year (dashboard combined + property KPIs).',
    parameters: { type: 'object', properties: { year: { type: 'number', description: 'Reporting year, e.g. 2026' } }, required: [] },
  },
  {
    name: 'draft_reminder',
    description: 'DRAFT ONLY — builds reminder SMS texts for the given tenant ids from their live balances. Returns texts for human approval; nothing is sent.',
    parameters: { type: 'object', properties: { tenantIds: { type: 'array', items: { type: 'number' }, description: 'Tenant ids to remind' } }, required: ['tenantIds'] },
  },
];

interface ArrearsRow {
  tenantId: number;
  tenantName: string;
  unitNumber: string;
  phoneNumber: string | null;
  totalOutstanding: number;
  status: string;
}

function asYear(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number((value as { year?: unknown } | null)?.year);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

export async function runTool(name: string, args: unknown, year: number): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  if (name === 'get_briefing') return getBriefing(year);
  if (name === 'get_arrears_summary') {
    const y = asYear(a.year, year);
    const rows = (await arrears(y)) as ArrearsRow[];
    const open = rows.filter((r) => r.totalOutstanding > 0);
    return {
      year: y,
      tenantsTracked: rows.length,
      openCount: open.length,
      totalOutstanding: open.reduce((s, r) => s + r.totalOutstanding, 0),
      byStatus: ['OVERDUE', 'UNPAID', 'PARTIAL', 'CLEARED', 'OVERPAID'].map((st) => ({
        status: st,
        count: rows.filter((r) => r.status === st).length,
      })),
      sampleDebtors: open.slice(0, 5).map((r) => ({
        tenantId: r.tenantId, name: r.tenantName, unit: r.unitNumber, balance: r.totalOutstanding, status: r.status,
      })),
    };
  }
  if (name === 'find_tenant') {
    const q = String(a.query ?? '').trim().toLowerCase();
    if (!q) throw new Error('find_tenant needs a query string.');
    const rows = (await arrears(year)) as ArrearsRow[];
    const hits = rows
      .filter(
        (r) =>
          r.tenantName.toLowerCase().includes(q) ||
          r.unitNumber.toLowerCase() === q ||
          (r.phoneNumber ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '')),
      )
      .slice(0, 5);
    const matches: {
      id: number; fullName: string; unitNumber: string;
      phoneNumber: string | null; rentBalance: number; waterBalance: number;
    }[] = [];
    for (const h of hits) {
      const b = await tenantBalances(h.tenantId, year);
      matches.push({
        id: h.tenantId, fullName: h.tenantName, unitNumber: h.unitNumber,
        phoneNumber: h.phoneNumber, rentBalance: b.rentBalance, waterBalance: b.waterBalance,
      });
    }
    return { matches };
  }
  if (name === 'monthly_figures') {
    const d = await dashboard(asYear(a.year, year));
    return {
      year: d.reportingYear,
      rentExpectedYtd: d.property.expectedRentYtd,
      rentCollected: d.property.rentCollected,
      rentOutstandingGross: d.combined.totalOutstanding,
      advances: d.combined.tenantAdvances ?? { count: 0, total: 0 },
    };
  }
  if (name === 'draft_reminder') {
    const ids = Array.isArray(a.tenantIds) ? a.tenantIds.filter((v): v is number => Number.isInteger(v) && v > 0).slice(0, 20) : [];
    if (ids.length === 0) throw new Error('draft_reminder needs at least one tenant id.');
    const rows = (await arrears(year)) as ArrearsRow[];
    return ids.map((id) => {
      const r = rows.find((x) => x.tenantId === id);
      const owed = r ? r.totalOutstanding : 0;
      const who = r ? `${r.tenantName} (Unit ${r.unitNumber})` : `tenant ${id}`;
      return {
        tenantId: id,
        tenantName: r?.tenantName ?? null,
        phoneNumber: r?.phoneNumber ?? null,
        text: owed > 0
          ? `Dear ${r?.tenantName ?? 'tenant'}, this is Olbano Plaza. Our records show KSh ${owed.toLocaleString('en-KE')} still open on ${who}. Kindly clear it at your earliest convenience. Thank you.`
          : `Dear ${r?.tenantName ?? 'tenant'}, this is Olbano Plaza. Our records show your account clear — thank you for paying on time.`,
      };
    });
  }
  throw new Error(`Unknown assistant tool: ${name}`);
}
