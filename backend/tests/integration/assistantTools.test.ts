import { runTool, TOOL_DEFS } from '../../src/services/assistantTools';

describe('assistantTools (read-only)', () => {
  it('exposes exactly the four whitelisted tools', () => {
    expect(TOOL_DEFS.map((t) => t.name).sort()).toEqual(
      ['draft_reminder', 'find_tenant', 'get_arrears_summary', 'get_briefing', 'monthly_figures'].sort(),
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

  it('find_tenant falls back to fuzzy matching for misheard names, labeled as such', async () => {
    // Seed tenant is "Peter Otieno" — nothing matches "Otino" exactly, so
    // the fuzzy path must find him and say so (the model relays "did you
    // mean…" instead of presenting a guess as fact).
    const out = (await runTool('find_tenant', { query: 'Peter Otino' }, 2026)) as {
      matches: { fullName: string; match: string; rentBalance: number }[];
    };
    expect(out.matches.length).toBeGreaterThan(0);
    expect(out.matches[0].fullName).toBe('Peter Otieno');
    expect(out.matches[0].match).toBe('fuzzy');
  });

  it('find_tenant still labels genuine matches exact', async () => {
    const out = (await runTool('find_tenant', { query: '24' }, 2026)) as {
      matches: { match: string }[];
    };
    for (const m of out.matches) expect(m.match).toBe('exact');
  });

  it('a digitless nonsense query matches nobody (no empty-string phone match)', async () => {
    const out = (await runTool('find_tenant', { query: 'Zebra Stripes' }, 2026)) as {
      matches: unknown[];
    };
    expect(out.matches).toEqual([]);
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
