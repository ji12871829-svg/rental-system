import { chatWithAssistant } from '../../src/services/assistantChat';

const mockChat = jest.fn();

jest.mock('../../src/services/assistantProvider', () => ({
  getAssistantConfig: () => ({ enabled: true, model: 'test-model' }),
  chatCompletion: (...args: unknown[]) => mockChat(...args),
}));

jest.mock('../../src/services/assistantTools', () => {
  const actual = jest.requireActual('../../src/services/assistantTools');
  return {
    TOOL_DEFS: actual.TOOL_DEFS,
    runTool: jest.fn(async (name: string) => {
      if (name === 'get_arrears_summary') return { openCount: 2, totalOutstanding: 8000, sampleDebtors: [] };
      if (name === 'draft_reminder') return [{ tenantId: 7, tenantName: 'Abdi N', phoneNumber: '0700000001', text: 'draft text' }];
      return {};
    }),
  };
});

beforeEach(() => mockChat.mockReset());

describe('assistantChat loop', () => {
  it('runs tools and answers from their results', async () => {
    mockChat
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: 'c1', name: 'get_arrears_summary', args: {} }] })
      .mockResolvedValueOnce({ content: 'Two tenants owe KSh 8,000 in total.', toolCalls: [] });
    const out = await chatWithAssistant({ message: 'who owes?', history: [], year: 2026 });
    expect(out.reply).toBe('Two tenants owe KSh 8,000 in total.');
    expect(out.toolCalls).toEqual(['get_arrears_summary']);
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it('collects draft_reminder output as drafts without executing anything', async () => {
    mockChat
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: 'c1', name: 'draft_reminder', args: { tenantIds: [7] } }] })
      .mockResolvedValueOnce({ content: 'Here is the draft for Abdi N.', toolCalls: [] });
    const out = await chatWithAssistant({ message: 'remind tenant 7', history: [], year: 2026 });
    expect(out.drafts).toEqual([{ tenantId: 7, tenantName: 'Abdi N', phoneNumber: '0700000001', text: 'draft text' }]);
    expect(out.reply).toBe('Here is the draft for Abdi N.');
  });

  it('stops after 5 tool iterations and says so', async () => {
    mockChat.mockResolvedValue({ content: null, toolCalls: [{ id: 'c', name: 'get_arrears_summary', args: {} }] });
    const out = await chatWithAssistant({ message: 'x', history: [], year: 2026 });
    expect(mockChat).toHaveBeenCalledTimes(5);
    expect(out.reply).toMatch(/could not finish/i);
  });

  it('falls back gracefully when the model answers with no usable content', async () => {
    mockChat.mockResolvedValue({ content: '   ', toolCalls: [] });
    const out = await chatWithAssistant({ message: 'hi', history: [], year: 2026 });
    expect(out.reply).toMatch(/couldn.t get a clear answer/i);
  });
});
