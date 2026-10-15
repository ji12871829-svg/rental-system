// Staff copilot memory: threads owned by one staff user, messages carrying
// the model-visible history (tool calls + drafts as JSON). DELETE is a hard
// erase (privacy); listing lazily prunes threads idle over
// ASSISTANT_THREAD_RETENTION_DAYS (no scheduler to operate).
import { pool } from '../config/db';
import type { ReminderDraft } from './assistantChat';

export const ASSISTANT_THREAD_RETENTION_DAYS = 365;

export interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: { id: string; name: string; args: unknown }[];
  drafts: ReminderDraft[];
}

export interface ThreadSummary {
  id: number;
  title: string;
  messageCount: number;
  updatedAt: string;
}

export async function createThread(userId: number, title: string): Promise<{ id: number }> {
  const clean = title.trim().slice(0, 120) || 'New chat';
  const row = await pool.query('INSERT INTO assistant_threads (user_id, title) VALUES ($1, $2) RETURNING id', [userId, clean]);
  return { id: row.rows[0].id as number };
}

async function pruneThreads(userId: number): Promise<void> {
  await pool.query(
    `DELETE FROM assistant_threads WHERE user_id = $1 AND updated_at < NOW() - ($2 || ' days')::interval`,
    [userId, String(ASSISTANT_THREAD_RETENTION_DAYS)],
  );
}

export async function listThreads(userId: number): Promise<ThreadSummary[]> {
  await pruneThreads(userId);
  const rows = await pool.query(
    `SELECT t.id, t.title, t.updated_at,
            (SELECT COUNT(*)::int FROM assistant_messages m WHERE m.thread_id = t.id) AS message_count
     FROM assistant_threads t WHERE t.user_id = $1 ORDER BY t.updated_at DESC`,
    [userId],
  );
  return rows.rows.map((r) => ({ id: r.id as number, title: r.title as string, messageCount: r.message_count as number, updatedAt: r.updated_at as string }));
}

export async function getThread(userId: number, threadId: number): Promise<{ id: number; title: string; messages: ThreadMessage[] } | null> {
  const head = await pool.query('SELECT id, title FROM assistant_threads WHERE id = $1 AND user_id = $2', [threadId, userId]);
  if (head.rows.length === 0) return null;
  const msgs = await pool.query(
    'SELECT role, content, tool_calls, drafts FROM assistant_messages WHERE thread_id = $1 ORDER BY id',
    [threadId],
  );
  return {
    id: head.rows[0].id as number,
    title: head.rows[0].title as string,
    messages: msgs.rows.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
      toolCalls: (m.tool_calls ?? []) as ThreadMessage['toolCalls'],
      drafts: (m.drafts ?? []) as ThreadMessage['drafts'],
    })),
  };
}

export async function appendMessage(
  threadId: number,
  msg: { role: 'user' | 'assistant'; content: string; toolCalls?: unknown; drafts?: unknown },
): Promise<void> {
  await pool.query(
    `INSERT INTO assistant_messages (thread_id, role, content, tool_calls, drafts)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [threadId, msg.role, msg.content, JSON.stringify(msg.toolCalls ?? []), JSON.stringify(msg.drafts ?? [])],
  );
  await pool.query('UPDATE assistant_threads SET updated_at = NOW() WHERE id = $1', [threadId]);
}

export async function deleteThread(userId: number, threadId: number): Promise<void> {
  const res = await pool.query('DELETE FROM assistant_threads WHERE id = $1 AND user_id = $2', [threadId, userId]);
  if ((res.rowCount ?? 0) === 0) throw new Error('Thread not found.');
}
