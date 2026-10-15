import { pool } from '../../src/config/db';
import { createThread, listThreads, getThread, appendMessage, deleteThread, ASSISTANT_THREAD_RETENTION_DAYS } from '../../src/services/assistantThreads';

async function userIdFor(email: string): Promise<number> {
  const row = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return row.rows[0].id as number;
}

describe('assistantThreads store', () => {
  it('isolates threads per user: B cannot read, list, or delete A\'s thread', async () => {
    const a = await userIdFor('admin@rpms.local');
    const b = await userIdFor('staff@rpms.local');
    const t = await createThread(a, 'A private chat');
    expect((await listThreads(b)).find((x) => x.id === t.id)).toBeUndefined();
    expect(await getThread(b, t.id)).toBeNull();
    await expect(deleteThread(b, t.id)).rejects.toThrow(/not found/i);
    await deleteThread(a, t.id);
    expect(await getThread(a, t.id)).toBeNull();
  });

  it('round-trips messages with tool calls and drafts intact', async () => {
    const a = await userIdFor('admin@rpms.local');
    const t = await createThread(a, 'Round trip');
    await appendMessage(t.id, { role: 'user', content: 'who owes?' });
    await appendMessage(t.id, {
      role: 'assistant', content: 'Two tenants owe.',
      toolCalls: [{ id: 'c1', name: 'get_arrears_summary', args: { year: 2026 } }],
      drafts: [{ tenantId: 7, tenantName: 'Abdi N', phoneNumber: '0700000001', text: 'hi' }],
    });
    const full = await getThread(a, t.id);
    expect(full?.messages).toHaveLength(2);
    expect(full?.messages[1].toolCalls).toEqual([{ id: 'c1', name: 'get_arrears_summary', args: { year: 2026 } }]);
    expect(full?.messages[1].drafts).toHaveLength(1);
    await deleteThread(a, t.id);
  });

  it('prunes threads older than 365 days on list (retention)', async () => {
    expect(ASSISTANT_THREAD_RETENTION_DAYS).toBe(365);
    const a = await userIdFor('admin@rpms.local');
    const t = await createThread(a, 'Ancient chat');
    await pool.query(`UPDATE assistant_threads SET updated_at = NOW() - INTERVAL '400 days' WHERE id = $1`, [t.id]);
    const rows = await listThreads(a);
    expect(rows.find((x) => x.id === t.id)).toBeUndefined();
    const gone = await pool.query('SELECT id FROM assistant_threads WHERE id = $1', [t.id]);
    expect(gone.rows).toHaveLength(0);
  });
});
