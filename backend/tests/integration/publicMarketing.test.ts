// Public marketing endpoints: the landing page's room-price list and the
// "Request a demo" form.
//
//   GET  /api/public/units — unit TYPES with price ranges and vacancy counts.
//     Marketing-safe projection only: no ids, no tenant data. Verifies an
//     unauthenticated caller sees numbers, never names.
//
//   POST /api/public/demo-requests — valid submissions land in demo_requests
//     and are audited (DEMO_REQUEST). Pins: invalid payloads 400; the generic
//     success body leaks nothing; the audit trail carries the submission.
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query, queryOne } from '../../src/config/db';

const app = createApp();

const UNIQUE = Date.now(); // keeps rows identifiable for hermetic cleanup

afterAll(async () => {
  await pool.end();
});

describe('GET /api/public/units (public price list)', () => {
  it('serves prices without authentication', async () => {
    const res = await request(app).get('/api/public/units');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // The operator's display currency rides along for the landing table.
    expect(typeof res.body.currency).toBe('string');
    if (res.body.data.length > 0) {
      const row = res.body.data[0];
      // Marketing-safe shape: type + numbers only.
      expect(row).toHaveProperty('unitType');
      expect(row).toHaveProperty('minRent');
      expect(row).toHaveProperty('maxRent');
      expect(typeof row.minRent).toBe('number');
      // No leakage of identifying fields.
      expect(row).not.toHaveProperty('id');
      expect(row).not.toHaveProperty('tenant_name');
      expect(row).not.toHaveProperty('tenant_name'.toUpperCase());
    }
  });

  it('never exposes tenant names, emails or unit ids', async () => {
    const res = await request(app).get('/api/public/units');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/tenant_id|full_name|email|phone_number|unit_number/i);
  });
});

describe('POST /api/public/demo-requests (landing demo form)', () => {
  it('accepts a valid submission, stores it, and audits it', async () => {
    const email = `demo.${UNIQUE}@example.test`;
    const res = await request(app)
      .post('/api/public/demo-requests')
      .send({
        name: 'Demo Seeker',
        email,
        phone: '+254700111222',
        propertyName: 'Test Heights',
        unitsCount: '6-20',
        message: 'Interested in water billing.',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.message).toMatch(/received/i);
    // The response must not echo internal identifiers.
    expect(res.body.data).not.toHaveProperty('id');

    const row = await queryOne<{ id: number; status: string; name: string }>(
      'SELECT id, status, name FROM demo_requests WHERE email = $1',
      [email],
    );
    expect(row).toBeTruthy();
    expect(row!.status).toBe('NEW');

    const audit = await queryOne<{ action: string }>(
      `SELECT action FROM audit_logs WHERE entity = 'demo_requests' AND entity_id = $1`,
      [row!.id],
    );
    expect(audit!.action).toBe('DEMO_REQUEST');

    await query('DELETE FROM audit_logs WHERE entity = $1 AND entity_id = $2', ['demo_requests', row!.id]);
    await query('DELETE FROM demo_requests WHERE id = $1', [row!.id]);
  });

  it('rejects invalid payloads with 400', async () => {
    const badEmail = await request(app)
      .post('/api/public/demo-requests')
      .send({ name: 'A B', email: 'not-an-email' });
    expect(badEmail.status).toBe(400);

    const shortName = await request(app)
      .post('/api/public/demo-requests')
      .send({ name: 'A', email: 'x@example.test' });
    expect(shortName.status).toBe(400);

    const oversize = await request(app)
      .post('/api/public/demo-requests')
      .send({ name: 'A B', email: 'x@example.test', message: 'y'.repeat(2001) });
    expect(oversize.status).toBe(400);
  });

  it('accepts a minimal submission (only required fields)', async () => {
    const email = `demo.min.${UNIQUE}@example.test`;
    const res = await request(app)
      .post('/api/public/demo-requests')
      .send({ name: 'Minimal Person', email });
    expect(res.status).toBe(201);
    const row = await queryOne<{ id: number }>('SELECT id FROM demo_requests WHERE email = $1', [email]);
    expect(row).toBeTruthy();
    await query('DELETE FROM audit_logs WHERE entity = $1 AND entity_id = $2', ['demo_requests', row!.id]);
    await query('DELETE FROM demo_requests WHERE id = $1', [row!.id]);
  });
});
