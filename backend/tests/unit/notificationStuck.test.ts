import express from 'express';
import request from 'supertest';

// The `query` mock is created at module scope by the config/db mock factory below
// and handed to the route under test as `query`. The factory closes over a `let`
// binding it assigns to when it runs (at first require of config/db, which happens
// when notificationStuck is imported) — that keeps `query` a live reference the
// test body can reconfigure per case via queryMock.
let queryMock: jest.Mock;

// Mocks must be registered at module scope so jest evaluates them before the
// route + auth modules (imported below) reach their own require() calls. For
// `env`, the real module exports a NAMED `env` object (plus isTest/isProd), and
// auth.ts imports `{ env }` then reads `env.jwtStaffSecret` — so the mock must
// replace `out.env.jwtStaffSecret`, not `out.jwtStaffSecret`. For portalAuth the
// real export is a NAMED const `STAFF_JWT_AUDIENCE`, so the mock replaces that
// named export directly.
jest.mock('../../src/config/env', () => {
  const base = jest.requireActual('../../src/config/env');
  const out = { ...(base as object), env: { ...(base.env as object), jwtStaffSecret: 'test-staff-secret' } } as typeof base;
  console.log('[notificationStuck test] env mock — jwtStaffSecret=', (out.env as { jwtStaffSecret?: unknown }).jwtStaffSecret);
  return out;
});
jest.mock('../../src/middleware/portalAuth', () => {
  const base = jest.requireActual('../../src/middleware/portalAuth');
  const out = { ...(base as object), STAFF_JWT_AUDIENCE: 'staff_api' } as typeof base;
  console.log('[notificationStuck test] portalAuth mock — STAFF_JWT_AUDIENCE=', (out as { STAFF_JWT_AUDIENCE?: unknown }).STAFF_JWT_AUDIENCE);
  return out;
});
jest.mock('jsonwebtoken', () => {
  const base = jest.requireActual('jsonwebtoken');
  const out: typeof base = {
    ...(base as object),
    verify: jest.fn((_token: string, _secret: string, _opts: { audience: string }) => ({
      sub: 1,
      role: 'ADMIN',
      name: 'Admin',
      email: 'admin@example.com',
    })),
    sign: jest.fn((_payload: object, _secret: string, _opts: { audience: string }) => 'staff-token'),
  } as typeof base;
  console.log('[notificationStuck test] jsonwebtoken mock — verify=', typeof (out as { verify?: unknown }).verify, 'sign=', typeof (out as { sign?: unknown }).sign);
  return out;
});

import notificationStuck from '../../src/routes/notificationStuck';
import { invalidateUserCache } from '../../src/middleware/auth';

// The module under test's db import is satisfied by the mock we hand to
// jest.mock; the same mock function is re-exposed as `queryMock` for the
// test body to configure per case. requireAuth (used by the route under test)
// calls queryOne to reload the decoded token's `sub` user and checks status ===
// 'ACTIVE' — return a valid active ADMIN user so the auth path can pass.
jest.mock('../../src/config/db', () => {
  queryMock = jest.fn(() => Promise.resolve({ rows: [] })) as jest.Mock;
  return {
    pool: { query: queryMock },
    query: queryMock,
    queryOne: jest.fn(() => Promise.resolve({ id: 1, name: 'Admin', email: 'admin@example.com', role: 'ADMIN', status: 'ACTIVE' } as never)),
  };
});

describe('notificationStuck route', () => {
  let staffToken = '';

  beforeAll(() => {
    // queryMock is already created by the config/db mock factory (run at import
    // time). Re-require after mocks so the token is signed with the mock secret
    // we registered above.
    const mockedEnv = require('../../src/config/env') as typeof import('../../src/config/env');
    const mockedPortalAuth = require('../../src/middleware/portalAuth') as { STAFF_JWT_AUDIENCE: string };
    const mockedJwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
    console.log('[notificationStuck test] after-mock env.jwtStaffSecret=', mockedEnv.env.jwtStaffSecret, 'audience=', mockedPortalAuth.STAFF_JWT_AUDIENCE, 'jwt.verify=', typeof mockedJwt.verify);
    staffToken = (mockedJwt.sign as jest.Mock).mock
      ? (mockedJwt.sign as jest.Mock).mock.calls[0]?.[0] as string ?? 'staff-token'
      : 'staff-token';
  });

  beforeEach(() => {
    // reset per-test mock state (including one-time overrides from the prior
    // case) so each test sets up its own query return shape fresh.
    queryMock.mockReset();
    invalidateUserCache();
  });

  const app = express();
  app.use(notificationStuck);

  it('returns counts of stuck PENDING and failed/ERRONEOUS rows per channel', async () => {
    // The route SELECTs lastFailureAt / lastFailureReason as separate columns
    // (subqueries), not a single lastFailure object — match that shape.
    const smsData = [{
      pending: '2',
      failed: '1',
      erroneous: '0',
      lastFailureAt: new Date('2026-10-05T10:00:00Z'),
      lastFailureReason: 'Transient provider error',
    }];
    const emailData = [{
      pending: '4',
      failed: '3',
      erroneous: '2',
      lastFailureAt: new Date('2026-10-05T09:30:00Z'),
      lastFailureReason: 'Invalid address',
    }];
    let callIdx = 0;
    queryMock.mockImplementation(async () => {
      const data = callIdx++ === 0 ? smsData : emailData;
      return data;
    });

    const res = await request(app)
      .get('/notification-stuck')
      .set('Authorization', `Bearer ${staffToken}`);

    console.log('[notificationStuck test] status=', res.status, 'body=', JSON.stringify(res.body));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        sms: {
          pending: 2,
          failed: 1,
          erroneous: 0,
          lastFailure: { at: '2026-10-05T10:00:00.000Z', reason: 'Transient provider error' },
        },
        email: {
          pending: 4,
          failed: 3,
          erroneous: 2,
          lastFailure: { at: '2026-10-05T09:30:00.000Z', reason: 'Invalid address' },
        },
      },
    });
  });

  it('returns zero counts when nothing is stuck', async () => {
    queryMock.mockImplementation(async () => [
      { pending: '0', failed: '0', erroneous: '0', lastFailureAt: null, lastFailureReason: null },
      { pending: '0', failed: '0', erroneous: '0', lastFailureAt: null, lastFailureReason: null },
    ]);

    const res = await request(app)
      .get('/notification-stuck')
      .set('Authorization', `Bearer ${staffToken}`);

    console.log('[notificationStuck test] status=', res.status, 'body=', JSON.stringify(res.body));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      sms: { pending: 0, failed: 0, erroneous: 0, lastFailure: null },
      email: { pending: 0, failed: 0, erroneous: 0, lastFailure: null },
    });
  });

  it('counts ERRONEOUS email rows under email, not sms', async () => {
    // SMS query (call 0) returns zero rows; email query (call 1) returns 5
    // ERRONEOUS email rows so email.erroneous = 5 while sms.erroneous = 0.
    let callIdx = 0;
    queryMock.mockImplementation(async () => {
      const row = callIdx++ === 0
        ? { pending: '0', failed: '0', erroneous: '0', lastFailureAt: null, lastFailureReason: null }
        : { pending: '0', failed: '0', erroneous: '5', lastFailureAt: null, lastFailureReason: null };
      return [row];
    });

    const res = await request(app)
      .get('/notification-stuck')
      .set('Authorization', `Bearer ${staffToken}`);

    console.log('[notificationStuck test] status=', res.status, 'body=', JSON.stringify(res.body));

    expect(res.status).toBe(200);
    expect(res.body.data.sms.erroneous).toBe(0);
    expect(res.body.data.email.erroneous).toBe(5);
    expect(res.body.data.email.failed).toBe(0);
  });
});
