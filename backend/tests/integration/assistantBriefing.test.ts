import { getBriefing } from '../../src/services/assistantBriefing';
import { runTool, TOOL_DEFS, BRIEFING_TOOL_DEF } from '../../src/services/assistantTools';

describe('assistantBriefing (deterministic, no LLM)', () => {
  it('registers BRIEFING_TOOL_DEF in the assistant tool list', () => {
    expect(BRIEFING_TOOL_DEF.name).toBe('get_briefing');
    expect(TOOL_DEFS).toContainEqual(BRIEFING_TOOL_DEF);
  });
  it('returns at most 6 ranked items with stable shapes', async () => {
    const items = await getBriefing(2026);
    expect(items.length).toBeLessThanOrEqual(6);
    for (const it of items) {
      expect(typeof it.kind).toBe('string');
      expect(it.title.length).toBeGreaterThan(0);
      expect(it.detail.length).toBeGreaterThan(0);
    }
  });

  it('is exposed as the get_briefing tool with identical payload', async () => {
    const via = (await runTool('get_briefing', {}, 2026)) as unknown[];
    const direct = await getBriefing(2026);
    expect(via).toEqual(direct);
  });

  it('flags a water spike: a unit consuming over 2x its previous reading', async () => {
    const items = await getBriefing(2026);
    const spikes = items.filter((i) => i.kind === 'water_spike');
    for (const s of spikes) {
      const m = s.detail.match(/(\d+(?:\.\d+)?)\s+units vs (\d+(?:\.\d+)?)/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(2 * Number(m![2]));
    }
  });
});
