import { env } from '../../src/config/env';
import { chatCompletion, getAssistantConfig } from '../../src/services/assistantProvider';

const REAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = REAL_FETCH;
  delete process.env.GROQ_API_KEY;
  env.groqApiKey = '';
});

describe('assistantProvider', () => {
  it('is disabled without a key (fail-closed, never a mock)', () => {
    expect(getAssistantConfig()).toEqual({ enabled: false, model: 'openai/gpt-oss-20b' });
  });

  it('posts an OpenAI-compatible chat body and parses tool calls', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    env.groqApiKey = 'test-key';
    const apiReply = {
      choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'get_arrears_summary', arguments: '{"year":2026}' } }] } }],
    };
    const seen: { url: string; init: RequestInit }[] = [];
    global.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => apiReply };
    }) as unknown as typeof fetch;

    const out = await chatCompletion({
      system: 'sys',
      messages: [{ role: 'user', content: 'who owes?' }],
      tools: [{ name: 'get_arrears_summary', description: 'd', parameters: { type: 'object', properties: {} } }],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const sentBody = JSON.parse(seen[0].init.body as string) as { model: string; tool_choice: string };
    expect(sentBody.model).toBe('openai/gpt-oss-20b');
    expect(sentBody.tool_choice).toBe('auto');
    expect(out.toolCalls).toEqual([{ id: 'c1', name: 'get_arrears_summary', args: { year: 2026 } }]);
  });

  it('throws a readable error on provider failure (no raw stack to the client)', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    env.groqApiKey = 'test-key';
    global.fetch = (async () => ({
      ok: false, status: 429, json: async () => ({ error: { message: 'rate limit' } }),
    })) as unknown as typeof fetch;
    await expect(chatCompletion({ system: 's', messages: [], tools: [] })).rejects.toThrow(/Groq request failed \(429\)/);
  });

  it('sends tool messages as snake_case tool_call_id with no stray keys (Groq 400s otherwise)', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    env.groqApiKey = 'test-key';
    const seen: { init: RequestInit }[] = [];
    global.fetch = (async (_url: string, init: RequestInit) => {
      seen.push({ init });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'done', tool_calls: [] } }] }) };
    }) as unknown as typeof fetch;

    await chatCompletion({
      system: 'sys',
      messages: [
        { role: 'user', content: 'who owes?' },
        { role: 'assistant', content: '' },
        { role: 'tool', toolCallId: 'c1', name: 'get_arrears_summary', content: '{"openCount":2}' },
      ],
      tools: [],
    });
    const sentMessages = JSON.parse(seen[0].init.body as string).messages as Record<string, unknown>[];
    expect(sentMessages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'who owes?' },
      { role: 'assistant', content: '' },
      { role: 'tool', tool_call_id: 'c1', content: '{"openCount":2}' },
    ]);
  });

  it('carries assistant tool_calls on the wire so following tool messages resolve (Harmony rejects orphans)', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    env.groqApiKey = 'test-key';
    const seen: { init: RequestInit }[] = [];
    global.fetch = (async (_url: string, init: RequestInit) => {
      seen.push({ init });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'done', tool_calls: [] } }] }) };
    }) as unknown as typeof fetch;

    await chatCompletion({
      system: 'sys',
      messages: [
        { role: 'user', content: 'who owes?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'get_arrears_summary', args: { year: 2026 } }],
        },
        { role: 'tool', toolCallId: 'c1', name: 'get_arrears_summary', content: '{"openCount":2}' },
      ],
      tools: [],
    });
    const sentMessages = JSON.parse(seen[0].init.body as string).messages as Record<string, unknown>[];
    expect(sentMessages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'who owes?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_arrears_summary', arguments: '{"year":2026}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"openCount":2}' },
    ]);
  });
});
