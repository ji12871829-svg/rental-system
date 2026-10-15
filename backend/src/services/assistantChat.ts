// One chat turn: model → tools → model, capped at 5 iterations. Drafts are
// collected from draft_reminder results and returned for human approval —
// NOTHING here sends, writes, or deletes. Figures in the reply must come
// from tool results; the system prompt forbids inventing balances.
import { chatCompletion, type ChatMsg } from './assistantProvider';
import { TOOL_DEFS, runTool } from './assistantTools';

const MAX_TOOL_ITERATIONS = 5;

const SYSTEM_PROMPT = [
  'You are Olbano, the in-app assistant for Olbano Plaza property staff (Kenya, currency KSh, English).',
  'RULE 1: your FIRST response must ALWAYS be a tool call. Never answer from memory and never refuse before calling at least one tool.',
  'RULE 2: route every question to a tool — who owes, paid, or is unpaid goes to get_arrears_summary; a specific tenant, unit, or phone goes to find_tenant; month totals, collected, or expected go to monthly_figures; writing or sending a reminder goes to draft_reminder.',
  'RULE 3: after tool results arrive, answer ONLY from them — one direct answer plus at most 3 supporting numbers. If a tool result came back empty, say you cannot see it; never invent tenant names, units, or balances.',
  'RULE 4: draft_reminder only PREPARES texts. Tell the user they must review and press send; never claim a message was sent.',
].join(' ');

export interface ReminderDraft {
  tenantId: number;
  tenantName: string | null;
  phoneNumber: string | null;
  text: string;
}

function isDraftList(value: unknown): value is ReminderDraft[] {
  return (
    Array.isArray(value) &&
    value.every(
      (d) =>
        typeof d === 'object' &&
        d !== null &&
        Number.isInteger((d as { tenantId: unknown }).tenantId) &&
        typeof (d as { text: unknown }).text === 'string',
    )
  );
}

export async function chatWithAssistant(input: {
  message: string;
  history: ChatMsg[];
  year: number;
}): Promise<{ reply: string; drafts: ReminderDraft[]; toolCalls: string[] }> {
  const drafts: ReminderDraft[] = [];
  const toolCalls: string[] = [];
  const transcript: ChatMsg[] = [...input.history.slice(-10), { role: 'user', content: input.message }];
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const out = await chatCompletion({ system: SYSTEM_PROMPT, messages: transcript, tools: TOOL_DEFS });
    transcript.push({ role: 'assistant', content: out.content ?? '' });
    if (out.toolCalls.length === 0) {
      const reply = (out.content ?? '').trim();
      return {
        reply: reply.length > 0 ? reply : 'I couldn\u2019t get a clear answer — please rephrase the question.',
        drafts,
        toolCalls,
      };
    }
    for (const call of out.toolCalls) {
      toolCalls.push(call.name);
      try {
        const result = await runTool(call.name, call.args, input.year);
        if (call.name === 'draft_reminder' && isDraftList(result)) drafts.push(...result);
        transcript.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(result).slice(0, 4000) });
      } catch (error) {
        transcript.push({
          role: 'tool', toolCallId: call.id, name: call.name,
          content: `Tool failed: ${(error as Error).message}`,
        });
      }
    }
  }
  return { reply: 'I could not finish that in time — please ask a narrower question.', drafts, toolCalls };
}
