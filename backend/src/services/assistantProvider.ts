// Groq REST client (OpenAI-compatible chat completions). Deliberately NOT an
// SDK: one POST shape, zero new dependencies. Fail-closed without a key.
import { env } from '../config/env';

// Wire shape note: this interface uses camelCase internally, but the
// OpenAI-compatible wire format wants snake_case `tool_call_id` on tool
// messages (and no `name`/`toolCallId` keys at all — Groq 400s otherwise).
// toWireMessage() below is the SOLE translation point; tests pin it.
export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: { id: string; name: string; args: unknown }[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AssistantCompletion {
  content: string | null;
  toolCalls: { id: string; name: string; args: unknown }[];
}

function toWireMessage(m: ChatMsg): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })),
    };
  }
  return { role: m.role, content: m.content };
}

const TIMEOUT_MS = 20_000;

export function getAssistantConfig(): { enabled: boolean; model: string } {
  return { enabled: env.groqApiKey.length > 0, model: env.groqModel };
}

export async function chatCompletion(args: { system: string; messages: ChatMsg[]; tools: ToolDef[] }): Promise<AssistantCompletion> {
  const cfg = getAssistantConfig();
  if (!cfg.enabled) throw new Error('GROQ_API_KEY is not set — the assistant is disabled.');
  let response: Response;
  try {
    response = await fetch(`${env.groqBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.groqApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: 800,
        messages: [{ role: 'system', content: args.system }, ...args.messages.map(toWireMessage)],
        tools: args.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
        tool_choice: 'auto',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Groq request failed: ${(error as Error).message}`);
  }
  const body = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] } }[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Groq request failed (${response.status}): ${body.error?.message ?? 'provider error'}`);
  const message = body.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((c) => {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(c.function?.arguments ?? '{}');
    } catch {
      parsed = {};
    }
    return { id: c.id, name: c.function?.name ?? 'unknown', args: parsed };
  });
  return { content: message?.content ?? null, toolCalls };
}
