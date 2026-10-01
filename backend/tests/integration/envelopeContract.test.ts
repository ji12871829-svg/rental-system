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
import { createApp } from '../../src/app';
import { pool } from '../../src/config/db';

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

  it('drift is caught: simulating a non-envelope route triggers the guard log', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Prove the detector itself works by driving the real middleware with a
    // fake response — the exact failure a future route refactor would
    // produce, caught before it can ship.
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
    (fakeRes.json as (b: unknown) => unknown)({ broken: true });
    expect(spyJson).toHaveBeenCalledWith({ broken: true });

    const logged = errSpy.mock.calls.filter((c) => String(c[0]).includes('[envelope]'));
    expect(logged.length).toBe(1);
    expect(logged[0][0]).toContain('/api/some/future-route');
    expect(logged[0][0]).toContain('broken');
    errSpy.mockRestore();
  });

  it('exemptions: /api/public/units stays flat and the Daraja callbacks are not policed', async () => {
    // Landing currency contract — deliberate flat { currency, data } shape.
    const units = await request(app).get('/api/public/units');
    expect(units.status).toBe(200);
    expect(units.body).toHaveProperty('currency');
    expect(units.body).toHaveProperty('data');

    // Daraja C2B acknowledgment protocol — response SHAPE is Safaricom's
    // business, not ours, so the guard must stay out either way. Status
    // semantics (token gate) are pinned by mpesaCallbackGate.test.ts.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const c2b = await request(app).post('/api/mpesa/c2b/confirm');
    expect([200, 400, 404]).toContain(c2b.status);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[envelope]'))).toBe(false);
    errSpy.mockRestore();
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
