// GET /api/mpesa/config — the Rent page's liveness probe for the STK prompt
// button. Mock mode answers success without sending anything to a phone, so
// the UI hides the button unless live. Guards under test:
//   1. 401 without a session (staff-only surface, like every UI probe).
//   2. Shape is exactly { provider, live } — no credentials, shortcodes,
//      callback URLs or passkeys ever leave the server.
//   3. Under NODE_ENV=test the provider is mock and live is false.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

let staffToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

beforeAll(async () => {
  staffToken = await login('staff@rpms.local', 'Staff@2026!');
});

afterAll(async () => {
  await pool.end();
});

describe('GET /api/mpesa/config', () => {
  it('401s without a session', async () => {
    const res = await request(app).get('/api/mpesa/config');
    expect(res.status).toBe(401);
  });

  it('reports provider and liveness — and nothing else', async () => {
    const res = await request(app)
      .get('/api/mpesa/config')
      .set({ Authorization: `Bearer ${staffToken}` });
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe('mock');
    expect(res.body.data.live).toBe(false);
    expect(Object.keys(res.body.data).sort()).toEqual(['live', 'provider']);
    const raw = JSON.stringify(res.body);
    for (const secret of ['passkey', 'secret', 'consumer', 'callbackUrl', 'callback_url', 'shortcode']) {
      expect(raw.toLowerCase()).not.toContain(secret);
    }
  });
});
