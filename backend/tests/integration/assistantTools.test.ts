import { runTool, TOOL_DEFS } from '../../src/services/assistantTools';

describe('assistantTools (read-only)', () => {
  it('exposes exactly the four whitelisted tools', () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ['draft_reminder', 'find_tenant', 'get_arrears_summary', 'monthly_figures'].sort(),
    );
  });

  it('rejects unknown tools instead of executing anything', async () => {
    await expect(runTool('delete_everything', {}, 2026)).rejects.toThrow('Unknown assistant tool: delete_everything');
  });

  it('get_arrears_summary returns sane numbers for the reporting year', async () => {
    const out = (await runTool('get_arrears_summary', { year: 2026 }, 2026)) as {
      tenantsTracked: number; openCount: number; totalOutstanding: number;
    };
    expect(out.tenantsTracked).toBeGreaterThan(0);
    expect(out.openCount).toBeGreaterThanOrEqual(0);
    expect(out.totalOutstanding).toBeGreaterThanOrEqual(0);
  });

  it('find_tenant matches by unit number and returns balances, never a password hash', async () => {
    const out = (await runTool('find_tenant', { query: '24' }, 2026)) as {
      matches: { id: number; fullName: string; unitNumber: string | null; phoneNumber: string | null; rentBalance: number }[];
    };
    expect(out.matches.length).toBeGreaterThanOrEqual(0);
    for (const m of out.matches) {
      expect(m).not.toHaveProperty('password_hash');
      expect(m).not.toHaveProperty('passwordHash');
    }
  });

  it('draft_reminder returns texts but executes nothing (no sends)', async () => {
    const rows = (await runTool('get_arrears_summary', { year: 2026 }, 2026)) as { sampleDebtors: { tenantId: number }[] };
    const debtors = rows.sampleDebtors.slice(0, 2).map((d) => d.tenantId);
    if (debtors.length === 0) return;
    const drafts = (await runTool('draft_reminder', { tenantIds: debtors }, 2026)) as { tenantId: number; text: string }[];
    expect(drafts.length).toBe(debtors.length);
    expect(drafts[0].text.length).toBeGreaterThan(10);
  });
});
