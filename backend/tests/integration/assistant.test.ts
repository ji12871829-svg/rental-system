import request from 'supertest';
import { createApp } from '../../src/app';

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
