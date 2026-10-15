import request from 'supertest';
import { createApp } from '../../src/app';
import { env } from '../../src/config/env';
import * as assistantProviderModule from '../../src/services/assistantProvider';

const app = createApp();

let staffToken = '';

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

beforeAll(async () => {
  staffToken = await login('staff@rpms.local', 'Staff@2026!');
});

describe('Assistant routes', () => {
  it('requires staff login', async () => {
    const res = await request(app).post('/api/assistant/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it('rejects empty and oversized messages with 400', async () => {
    const empty = await request(app).post('/api/assistant/chat').set(auth(staffToken)).send({ message: '' });
    expect(empty.status).toBe(400);
    const big = await request(app)
      .post('/api/assistant/chat')
      .set(auth(staffToken))
      .send({ message: 'x'.repeat(2001) });
    expect(big.status).toBe(400);
  });

  it('fails closed with 503 when GROQ_API_KEY is unset (test env has none)', async () => {
    const res = await request(app).post('/api/assistant/chat').set(auth(staffToken)).send({ message: 'who owes?' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ASSISTANT_DISABLED');
  });

  it('config surface exposes capability, never secrets', async () => {
    const res = await request(app).get('/api/assistant/config').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(JSON.stringify(res.body.data)).not.toMatch(/key|secret|token/i);
  });
});

describe('POST /api/assistant/transcribe (Whisper)', () => {
  const audio = Buffer.from('fake-opus-bytes').toString('base64');

  it('requires staff login', async () => {
    const res = await request(app).post('/api/assistant/transcribe').send({ audioBase64: audio, mimeType: 'audio/webm' });
    expect(res.status).toBe(401);
  });

  it('rejects empty audio and non-audio mime types with 400', async () => {
    const empty = await request(app).post('/api/assistant/transcribe').set(auth(staffToken)).send({ audioBase64: '', mimeType: 'audio/webm' });
    expect(empty.status).toBe(400);
    const text = await request(app).post('/api/assistant/transcribe').set(auth(staffToken)).send({ audioBase64: audio, mimeType: 'text/plain' });
    expect(text.status).toBe(400);
  });

  it('fails closed with 503 when GROQ_API_KEY is unset', async () => {
    const res = await request(app).post('/api/assistant/transcribe').set(auth(staffToken)).send({ audioBase64: audio, mimeType: 'audio/webm' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ASSISTANT_DISABLED');
  });
});

describe('Assistant threads (per-user memory)', () => {
  let adminToken = '';
  let staffThreadId = 0;
  let modelCalls = 0;

  // Plain jest.spyOn on the module namespace (see api.test.ts): the stubbed
  // model alternates tool-call / final-answer so every POST /chat below runs
  // the real loop, the real tools, and the real persistence without network.
  const chatCompletionSpy = jest.spyOn(
    assistantProviderModule as unknown as { chatCompletion: (...args: unknown[]) => Promise<unknown> },
    'chatCompletion',
  );

  beforeAll(async () => {
    adminToken = await login('admin@rpms.local', 'Admin@2026!');
    env.groqApiKey = 'test-key';
    modelCalls = 0;
    chatCompletionSpy.mockImplementation(async () => {
      modelCalls += 1;
      if (modelCalls % 2 === 1) {
        return { content: null, toolCalls: [{ id: `c${modelCalls}`, name: 'get_arrears_summary', args: {} }] };
      }
      return { content: `canned reply ${modelCalls}`, toolCalls: [] };
    });
  });

  afterAll(async () => {
    chatCompletionSpy.mockRestore();
    env.groqApiKey = '';
    const listed = await request(app).get('/api/assistant/threads').set(auth(staffToken));
    if (Array.isArray(listed.body?.data)) {
      for (const t of listed.body.data as { id: number }[]) {
        await request(app).delete(`/api/assistant/threads/${t.id}`).set(auth(staffToken));
      }
    }
  });

  it('creates a thread with 201 and a numeric id, visible in the staff list', async () => {
    const created = await request(app).post('/api/assistant/threads').set(auth(staffToken)).send({});
    expect(created.status).toBe(201);
    expect(typeof created.body.data.id).toBe('number');
    staffThreadId = created.body.data.id as number;
    const listed = await request(app).get('/api/assistant/threads').set(auth(staffToken));
    expect(listed.status).toBe(200);
    expect((listed.body.data as { id: number }[]).some((t) => t.id === staffThreadId)).toBe(true);
  });

  it('chat with threadId persists 2 turns readable via the messages route', async () => {
    const first = await request(app)
      .post('/api/assistant/chat')
      .set(auth(staffToken))
      .send({ message: 'who owes rent?', threadId: staffThreadId });
    expect(first.status).toBe(200);
    expect(first.body.data.threadId).toBe(staffThreadId);
    expect(typeof first.body.data.reply).toBe('string');
    const second = await request(app)
      .post('/api/assistant/chat')
      .set(auth(staffToken))
      .send({ message: 'and water?', threadId: staffThreadId });
    expect(second.status).toBe(200);
    expect(second.body.data.threadId).toBe(staffThreadId);
    const msgs = await request(app).get(`/api/assistant/threads/${staffThreadId}/messages`).set(auth(staffToken));
    expect(msgs.status).toBe(200);
    expect(msgs.body.data.messages).toHaveLength(4);
    expect(msgs.body.data.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('isolates threads: admin gets 404 reading or deleting a staff thread', async () => {
    const asAdmin = await request(app).get(`/api/assistant/threads/${staffThreadId}/messages`).set(auth(adminToken));
    expect(asAdmin.status).toBe(404);
    expect(asAdmin.body.error).toBe('THREAD_NOT_FOUND');
    const delAsAdmin = await request(app).delete(`/api/assistant/threads/${staffThreadId}`).set(auth(adminToken));
    expect(delAsAdmin.status).toBe(404);
    expect(delAsAdmin.body.error).toBe('THREAD_NOT_FOUND');
  });

  it('serves the deterministic briefing as an array', async () => {
    const res = await request(app).get('/api/assistant/briefing').set(auth(staffToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('chat without threadId still works and returns a threadId', async () => {
    const res = await request(app).post('/api/assistant/chat').set(auth(staffToken)).send({ message: 'hello there' });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.threadId).toBe('number');
    const autoId = res.body.data.threadId as number;
    const msgs = await request(app).get(`/api/assistant/threads/${autoId}/messages`).set(auth(staffToken));
    expect(msgs.status).toBe(200);
    expect(msgs.body.data.messages).toHaveLength(2);
    await request(app).delete(`/api/assistant/threads/${autoId}`).set(auth(staffToken));
  });

  it('delete removes the thread: messages then 404', async () => {
    const del = await request(app).delete(`/api/assistant/threads/${staffThreadId}`).set(auth(staffToken));
    expect(del.status).toBe(204);
    const gone = await request(app).get(`/api/assistant/threads/${staffThreadId}/messages`).set(auth(staffToken));
    expect(gone.status).toBe(404);
    expect(gone.body.error).toBe('THREAD_NOT_FOUND');
  });
});
