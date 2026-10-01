// Session-anomaly detector (GET /api/audit/anomalies). Uses a throwaway
// user so assertions filter to rows this suite created — the shared test
// database legitimately holds LOGIN/LOGIN_CLERK rows from other suites
// (clerkBridgeMapped logs in its fixture admin through both paths).
//
// The detector reads the client ip from new_value on login rows — the shape
// the real writers (auth.ts, clerkAuthRoutes.ts) produce. Direct inserts
// here control ip and timing precisely; one password login goes through the
// real API to pin the writer shape too.
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query, queryOne } from '../../src/config/db';
import type { PoolClient } from 'pg';

const app = createApp();
const EMAIL = 'anomaly.probe@example.test';
let victimId = 0;

interface Anomaly {
  kind: string;
  userId: number;
  firstAction: string;
  secondAction: string;
  firstIp: string | null;
  secondIp: string | null;
  at: string;
}

async function auditLogin(userId: number, action: string, ip: string | null, minutesAgo: number): Promise<void> {
  await query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_value, created_at)
     VALUES ($1, $2, 'users', $1, $3, NOW() - ($4 || ' minutes')::interval)`,
    [userId, action, JSON.stringify({ ip }), String(minutesAgo)],
  );
}

async function anomalies(cookie: string): Promise<{ mixedPath: Anomaly[]; distinctIp: Anomaly[] }> {
  const res = await request(app).get('/api/audit/anomalies').set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function adminSession(): Promise<string> {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@rpms.local', password: 'Admin@2026!' });
  expect(login.status).toBe(200);
  const cookies = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]);
  return cookies.filter((c) => c.startsWith('rpms_session='))[0];
}

beforeAll(async () => {
  const hash = await bcrypt.hash('Anomaly#2026', 4);
  const inserted = await query<{ id: number }>(
    `INSERT INTO users (name, email, phone, password_hash, role, status)
     VALUES ('Anomaly Probe', $1, NULL, $2, 'STAFF', 'ACTIVE') RETURNING id`,
    [EMAIL, hash],
  );
  victimId = inserted[0].id;
});

afterAll(async () => {
  await query('DELETE FROM audit_logs WHERE entity_id = $1 AND entity = $2', [victimId, 'users']);
  await query('DELETE FROM users WHERE id = $1', [victimId]);
  await pool.end();
});

describe('GET /api/audit/anomalies', () => {
  it('is admin-only', async () => {
    expect((await request(app).get('/api/audit/anomalies')).status).toBe(401);
    const staffLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'staff@rpms.local', password: 'Staff@2026!' });
    const staffCookie = (staffLogin.headers['set-cookie'] as unknown as string[])
      .map((c) => c.split(';')[0])
      .filter((c) => c.startsWith('rpms_session='))[0];
    expect((await request(app).get('/api/audit/anomalies').set('Cookie', staffCookie)).status).toBe(403);
  });

  it('flags a password LOGIN and a Clerk LOGIN_CLERK minutes apart (mixed path)', async () => {
    // Real API login — pins that the writer carries the ip in new_value.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'Anomaly#2026' });
    expect(res.status).toBe(200);
    const writerRow = await queryOne<{ new_value: { ip: string | null } }>(
      `SELECT new_value FROM audit_logs WHERE user_id = $1 AND action = 'LOGIN' ORDER BY id DESC LIMIT 1`,
      [victimId],
    );
    expect(writerRow).toBeTruthy();
    expect(writerRow!.new_value).toHaveProperty('ip');

    // A Clerk-path login for the same account a minute later.
    await auditLogin(victimId, 'LOGIN_CLERK', '203.0.113.9', 1);

    const cookie = await adminSession();
    const data = await anomalies(cookie);
    const mixed = data.mixedPath.filter((a) => a.userId === victimId);
    expect(mixed.length).toBeGreaterThanOrEqual(1);
    const pair = mixed[0];
    expect([pair.firstAction, pair.secondAction].sort()).toEqual(['LOGIN', 'LOGIN_CLERK'].sort());
    expect(new Date(pair.at).getTime()).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
  });

  it('flags same-account logins from two distinct IPs within the window', async () => {
    await auditLogin(victimId, 'LOGIN', '198.51.100.10', 9);
    await auditLogin(victimId, 'LOGIN', '198.51.100.99', 2); // different address, 7 minutes later

    const cookie = await adminSession();
    const data = await anomalies(cookie);
    const pair = data.distinctIp.find(
      (a) => a.userId === victimId
        && [a.firstIp, a.secondIp].sort().join('|') === ['198.51.100.10', '198.51.100.99'].sort().join('|'),
    );
    expect(pair).toBeTruthy();
  });

  it('stays quiet for same-IP repeats and for pairs entirely outside the lookback', async () => {
    // A second throwaway user: no other suite or test writes rows for it,
    // so any pair the detector produced from these inserts would be ours —
    // the earlier tests' rows must not leak into this negative case.
    const hash = await bcrypt.hash('Anomaly#2026', 4);
    const quiet = await query<{ id: number }>(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ('Anomaly Quiet', 'anomaly.quiet@example.test', NULL, $1, 'STAFF', 'ACTIVE') RETURNING id`,
      [hash],
    );
    const quietId = quiet[0].id;
    try {
      // Same IP twice, recently — the ordinary case (office NAT, re-login):
      // must never alert.
      await auditLogin(quietId, 'LOGIN', '192.0.2.50', 5);
      await auditLogin(quietId, 'LOGIN', '192.0.2.50', 2);
      // Two DIFFERENT IPs but both 8 days back — outside the 7-day lookback,
      // so the pair must not surface either.
      await auditLogin(quietId, 'LOGIN', '192.0.2.51', 60 * 24 * 8);
      await auditLogin(quietId, 'LOGIN', '192.0.2.52', 60 * 24 * 8 - 2);

      const cookie = await adminSession();
      const data = await anomalies(cookie);
      expect(data.distinctIp.find((a) => a.userId === quietId)).toBeUndefined();
      expect(data.mixedPath.find((a) => a.userId === quietId)).toBeUndefined();
    } finally {
      await query("DELETE FROM audit_logs WHERE entity_id = $1 AND entity = 'users'", [quietId]);
      await query('DELETE FROM users WHERE id = $1', [quietId]);
    }
  });

  it('never returns rows whose user is gone (anonymised trail)', async () => {
    // Rows attributed to a deleted user have user_id NULL — the detector's
    // join on user_id must simply never produce them.
    const client: PoolClient = await pool.connect();
    try {
      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_value)
         VALUES (NULL, 'LOGIN', 'users', NULL, $1)`,
        [JSON.stringify({ ip: '203.0.113.77' })],
      );
    } finally {
      client.release();
    }
    const cookie = await adminSession();
    const data = await anomalies(cookie);
    expect(data.mixedPath.every((a) => a.userId !== null)).toBe(true);
    expect(data.distinctIp.every((a) => a.userId !== null)).toBe(true);
  });
});
