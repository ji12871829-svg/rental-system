// Integration tests for the one-time portal setup link flow (2026-10-13
// security review, OWASP #7/#2 — no plaintext passwords in email): issuing
// access without a custom password mints a single-use token (stored only as
// a SHA-256 hash), the tenant picks their own password through it, and the
// link dies on completion, on replay, on expiry, and on re-issue. The HTTP
// endpoint /api/portal/setup is exercised end-to-end with a fresh tenant so
// no other suite's fixtures are touched.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query, queryOne } from '../../src/config/db';
import {
  completePortalSetup,
  issuePortalAccess,
  portalLogin,
  portalSetupUrl,
} from '../../src/services/tenantPortalService';

const app = createApp();

const EMAIL = `portal.setup.${Date.now()}@example.com`;
const STAFF_CHOSSEN = 'StaffChosen!88';

let tenantId = 0;
let accessId = 0;
let userId = 0;

beforeAll(async () => {
  const user = await queryOne<{ id: number }>('SELECT id FROM users ORDER BY id LIMIT 1');
  if (!user) throw new Error('No seeded staff user for the audit trail');
  userId = user.id;

  const tenant = await queryOne<{ id: number }>(
    `INSERT INTO tenants (full_name, email, status, move_in_date)
     VALUES ('Portal Setup Tenant', $1, 'ACTIVE', CURRENT_DATE)
     RETURNING id`,
    [EMAIL]
  );
  if (!tenant) throw new Error('Could not create the setup-flow tenant');
  tenantId = tenant.id;
});

afterAll(async () => {
  if (tenantId) {
    // Audit rows key on the portal-access row id (and the tenant id for the
    // self-register action this flow never uses) — collect before the cascade
    // deletes the access rows. Keep the privacy register tidy like
    // reminderChannels does.
    const accessRows = await query<{ id: number }>(
      'SELECT id FROM tenant_portal_access WHERE tenant_id = $1',
      [tenantId]
    );
    const auditIds = [tenantId, ...accessRows.map((r) => r.id)];
    await pool.query(
      `DELETE FROM audit_logs WHERE entity = 'tenant_portal_access' AND entity_id = ANY($1::int[])`,
      [auditIds]
    );
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  }
  await pool.end();
});

describe('one-time portal setup link (service)', () => {
  let token1 = '';

  it('issues a link token and no knowable password when none is supplied', async () => {
    const issued = await issuePortalAccess(tenantId, userId, EMAIL);
    accessId = issued.id;
    expect(issued.setupToken).toMatch(/^[0-9a-f]{64}$/);
    token1 = issued.setupToken!;
    expect(portalSetupUrl(token1)).toContain('/portal/setup?token=');

    // The stored password_hash is a placeholder nobody knows — login is
    // impossible until the tenant completes setup.
    await expect(portalLogin(EMAIL, 'AnyGuess123')).rejects.toMatchObject({ status: 401 });
    // The database keeps only the SHA-256 hash of the token, never plaintext.
    const stored = await queryOne<{ setup_token_hash: string }>(
      'SELECT setup_token_hash FROM tenant_portal_access WHERE id = $1',
      [accessId]
    );
    expect(stored?.setup_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.setup_token_hash).not.toBe(token1);
  });

  it('lets the tenant complete the link and sign in with their own password', async () => {
    await completePortalSetup(token1, 'TenantChosen!42');
    const login = await portalLogin(EMAIL, 'TenantChosen!42');
    expect(login.tenantId).toBe(tenantId);

    // Completion clears the token — the row no longer holds a hash.
    const stored = await queryOne<{ setup_token_hash: string | null }>(
      'SELECT setup_token_hash FROM tenant_portal_access WHERE id = $1',
      [accessId]
    );
    expect(stored?.setup_token_hash).toBeNull();
  });

  it('rejects replay of a completed link', async () => {
    await expect(completePortalSetup(token1, 'ReplayPass!99')).rejects.toMatchObject({
      status: 409,
      code: 'PORTAL_SETUP_INVALID',
    });
  });

  it('rejects an expired link', async () => {
    const issued = await issuePortalAccess(tenantId, userId, EMAIL);
    await query(
      'UPDATE tenant_portal_access SET setup_token_expires_at = NOW() - INTERVAL \'1 minute\' WHERE id = $1',
      [issued.id]
    );
    await expect(completePortalSetup(issued.setupToken!, 'ExpiryPass!9')).rejects.toMatchObject({
      status: 409,
      code: 'PORTAL_SETUP_INVALID',
    });
  });
});

describe('POST /api/portal/setup (HTTP)', () => {
  it('validates body shape', async () => {
    const res = await request(app)
      .post('/api/portal/setup')
      .send({ token: 't'.repeat(64), password: 'short' });
    expect(res.status).toBe(400);
  });

  it('409s an unknown token', async () => {
    const res = await request(app)
      .post('/api/portal/setup')
      .send({ token: 'f'.repeat(64), password: 'PerfectlyFine1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PORTAL_SETUP_INVALID');
  });

  it('completes a real link and the tenant can then log in', async () => {
    const issued = await issuePortalAccess(tenantId, userId, EMAIL);
    const res = await request(app)
      .post('/api/portal/setup')
      .send({ token: issued.setupToken!, password: 'HttpChosen!77' });
    expect(res.status).toBe(200);
    const login = await portalLogin(EMAIL, 'HttpChosen!77');
    expect(login.tenantId).toBe(tenantId);
  });
});

describe('re-issue rotates the link away', () => {
  it('a custom-password reissue kills any pending link and needs no email', async () => {
    const pending = await issuePortalAccess(tenantId, userId, EMAIL);
    expect(pending.setupToken).toMatch(/^[0-9a-f]{64}$/);

    const custom = await issuePortalAccess(tenantId, userId, EMAIL, STAFF_CHOSSEN);
    expect(custom.setupToken).toBeUndefined();

    // The pending link from the previous issue is dead.
    await expect(completePortalSetup(pending.setupToken!, 'WhateverPass1')).rejects.toMatchObject({
      status: 409,
      code: 'PORTAL_SETUP_INVALID',
    });
    // And the staff-chosen password is live immediately.
    const login = await portalLogin(EMAIL, STAFF_CHOSSEN);
    expect(login.tenantId).toBe(tenantId);
  });
});
