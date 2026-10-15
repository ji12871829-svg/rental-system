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

// Speech-to-text for the mic button: recorded audio goes to Groq's Whisper
// (far stronger on accented speech than the browser's built-in recognizer,
// which garbled even short English queries). Audio arrives as base64 inside
// JSON (no multipart dependency); the 60-second client cap keeps payloads
// small. Same fail-closed rule: no key, no call.
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const MAX_AUDIO_BASE64_CHARS = 3_500_000;

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  if (!getAssistantConfig().enabled) throw new Error('GROQ_API_KEY is not set — the assistant is disabled.');
  if (!mimeType.startsWith('audio/')) throw new Error('Only audio recordings can be transcribed.');
  if (audioBase64.length === 0 || audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    throw new Error('Recording too long — keep it under a minute and try again.');
  }
  const bytes = Buffer.from(audioBase64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), 'recording');
  form.append('model', WHISPER_MODEL);
  let response: Response;
  try {
    response = await fetch(`${env.groqBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.groqApiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new Error(`Transcription failed: ${(error as Error).message}`);
  }
  const body = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!response.ok || typeof body.text !== 'string') {
    throw new Error(`Transcription failed (${response.status}): ${body.error?.message ?? 'provider error'}`);
  }
  return body.text.trim();
}
