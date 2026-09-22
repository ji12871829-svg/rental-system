// The Clerk bridge must fail CLOSED. With no CLERK_SECRET_KEY configured the
// route still exists (same app builds it), but it refuses every call with a
// generic 401 — it must never mint a staff session from nothing, and its
// message must not reveal whether an account exists.
//
// The with-keys path (real Clerk session → mapped user → staff cookie) needs
// a live Clerk instance to sign anything, so it is verified manually per
// docs/RUNBOOK-clerk-setup.md, not here.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('POST /api/auth/clerk/session', () => {
  it('rejects when Clerk is not configured (fails closed)', async () => {
    const res = await request(app).post('/api/auth/clerk/session');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not configured/i);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects an anonymous call even with a body present (no enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/clerk/session')
      .send({ email: 'admin@rpms.local' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
