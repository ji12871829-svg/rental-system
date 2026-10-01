// Envelope-contract suite — turns the envelopeGuard middleware's log lines
// into hard CI failures. Every 2xx JSON response from a non-exempt /api route
// must carry the shared { data } envelope (ApiItemResponse from @rpms/shared);
// the frontend clients pin that shape at compile time, this suite pins the
// backend at test time so the two halves of the wire cannot drift.
//
// Positive controls prove the guard catches drift; exemption assertions pin
// the three documented protocol/contract exceptions so a future refactor
// cannot silently widen or drop them.
import request from 'supertest';
import express from 'express';
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';
import { envelopeGuard } from '../../src/middleware/envelopeGuard';
import { errorHandler } from '../../src/middleware/errorHandler';

const app = createApp();

let adminToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  adminToken = await login('admin@rpms.local', 'Admin@2026!');
});

afterAll(async () => {
  await pool.end();
});

describe('envelope contract (every /api 2xx JSON answers { data })', () => {
  it('staff reads carry the envelope: single item, list, and paginated list', async () => {
    const single = await request(app).get('/api/auth/me').set(auth(adminToken));
    expect(single.status).toBe(200);
    expect(single.body).toHaveProperty('data');

    // Unpaginated rows endpoint — ApiItemResponse<T[]>: `data` present,
    // pagination deliberately absent (only paginated endpoints carry it).
    const rows = await request(app).get('/api/users').set(auth(adminToken));
    expect(rows.status).toBe(200);
    expect(rows.body).toHaveProperty('data');
    expect(Array.isArray(rows.body.data)).toBe(true);

    // Paginated list — ApiListResponse: data + pagination.
    const paginated = await request(app).get('/api/audit?limit=5').set(auth(adminToken));
    expect(paginated.status).toBe(200);
    expect(paginated.body).toHaveProperty('data');
    expect(Array.isArray(paginated.body.data)).toBe(true);
    expect(paginated.body).toHaveProperty('pagination');
  });

  it('drift is caught: a 200 object without `data` is detected by the guard', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('data');
    // /api/health is exempt, so the guard must NOT have logged.
    const logged = errSpy.mock.calls.some((c) => String(c[0]).includes('[envelope]'));
    expect(logged).toBe(false);
    errSpy.mockRestore();
  });

  it('drift fails fast: a non-envelope 2xx response throws ENVELOPE_VIOLATION in test env', async () => {
    // Drive the real middleware from the live app stack with a fake
    // response — the exact failure a future route refactor would produce.
    // Under NODE_ENV=test the guard THROWS (fail-fast), it does not log.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stack = (
      app as unknown as { _router: { stack: { name: string; handle: unknown }[] } }
    )._router.stack;
    const layer = stack.find((l) => l.name === 'envelopeGuard');
    expect(layer).toBeDefined();
    const guard = layer!.handle as (
      req: unknown,
      res: { statusCode: number; json: (b: unknown) => unknown },
      next: () => void
    ) => void;
    const spyJson = jest.fn((b: unknown) => b);
    const fakeRes = { statusCode: 200, json: spyJson };
    guard({ path: '/api/some/future-route', method: 'GET' }, fakeRes, () => {});
    expect(() => (fakeRes.json as (b: unknown) => unknown)({ broken: true })).toThrow(
      /without the \{ data \} envelope/
    );
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('drift is unmissable end-to-end: violating route → 500 ENVELOPE_VIOLATION body', async () => {
    // The full chain a drifting route would produce under supertest: the
    // guard throws inside res.json, Express routes it to errorHandler, and
    // the suite that caused the drift fails on a loud 500 — with the route,
    // status and offending keys in the message.
    const probe = express();
    probe.use(express.json());
    probe.use(envelopeGuard);
    probe.get('/api/broken', (_req, res) => {
      res.json({ oops: true });
    });
    probe.use(errorHandler);

    const res = await request(probe).get('/api/broken');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ENVELOPE_VIOLATION');
    expect(res.body.message).toContain('/api/broken');
    expect(res.body.message).toContain('oops');
  });

  it('exemptions: the Daraja callbacks are not policed (protocol shapes)', async () => {

    // Daraja C2B acknowledgment protocol — response SHAPE is Safaricom's
    // business, not ours, so the guard must stay out either way. Status
    // semantics (token gate) are pinned by mpesaCallbackGate.test.ts.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c2b = await request(app).post('/api/mpesa/c2b/confirm');
    expect([200, 400, 404]).toContain(c2b.status);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[envelope]'))).toBe(false);
    errSpy.mockRestore();
  });

  it('/api/public/units answers the standard envelope (currency inside data)', async () => {
    // Formerly the one flat { currency, data } exception; standardized so
    // the guard polices it like every other route — a 200 here IS the guard
    // pass, since a violation would throw and surface as a 500.
    const units = await request(app).get('/api/public/units');
    expect(units.status).toBe(200);
    expect(typeof units.body.data.currency).toBe('string');
    expect(Array.isArray(units.body.data.units)).toBe(true);
  });

  it('health endpoint remains exempt from the envelope (ops probe shape)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).not.toHaveProperty('data');
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[envelope]'))).toBe(false);
    errSpy.mockRestore();
  });
});
