import express from 'express';
import request from 'supertest';

import notificationStuck from '../../src/routes/notificationStuck';
import { invalidateUserCache } from '../../src/middleware/auth';

// The module under test imports `query` from config/db at require time, and the
// route module is imported at the top of this file, so the shared `query` mock
// object must already exist when that import is evaluated. We do that by
// registering the shared mock inside an outer describe + beforeAll (both
// hoisted during setup) rather than as a module-scope `const`.
const queryHandle = { mock: undefined as unknown as jest.Mock };

describe('notificationStuck route', () => {
  let staffToken = '';

  beforeAll(() => {
    queryHandle.mock = jest.fn(() => Promise.resolve({ rows: [] })) as jest.Mock;

    // Staff tokens are verified by requireAuth against env.jwtStaffSecret with
    // audience STAFF_JWT_AUDIENCE. Build one here so the real auth path is
    // exercised end-to-end — the only mocked pieces are the secret + audience
    // (which the auth module reads from env/portalAuth) and jsonwebtoken.verify
    // (which otherwise would hit a real signing key at test time).
    jest.mock('../../src/config/env', () => {
      const base = jest.requireActual('../../src/config/env');
      const out = { ...(base as object), jwtStaffSecret: 'test-staff-secret' } as typeof base;
      console.log('[notificationStuck test] env mock — jwtStaffSecret=', (out as { jwtStaffSecret?: unknown }).jwtStaffSecret);
      return out;
    });
    jest.mock('../../src/middleware/portalAuth', () => {
      const base = jest.requireActual('../../src/middleware/portalAuth');
      const out = { ...(base as object), STAFF_JWT_AUDIENCE: 'staff' } as typeof base;
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

    // Re-require after mocks so the token is signed with the mock secret we just
    // registered (jest.mock calls are evaluated before beforeAll in setup).
    const mockedEnv = require('../../src/config/env') as typeof import('../../src/config/env');
    const mockedPortalAuth = require('../../src/middleware/portalAuth') as { STAFF_JWT_AUDIENCE: string };
    const mockedJwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
    console.log('[notificationStuck test] after-mock env.jwtStaffSecret=', mockedEnv.jwtStaffSecret, 'audience=', mockedPortalAuth.STAFF_JWT_AUDIENCE, 'jwt.verify=', typeof mockedJwt.verify);
    staffToken = (mockedJwt.sign as jest.Mock).mock
      ? (mockedJwt.sign as jest.Mock).mock.calls[0]?.[0] as string ?? 'staff-token'
      : 'staff-token';
  });

  // The module under test's db import is satisfied by the mock we hand to
  // jest.mock; the same object is re-exposed for the test body to configure.
  jest.mock('../../src/config/db', () => ({
    pool: { query: jest.fn(() => Promise.resolve({ rows: [] })) },
    query: queryHandle.mock,
    queryOne: jest.fn(() => Promise.resolve(undefined)),
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    queryHandle.mock.mockClear();
    invalidateUserCache();
    queryHandle.mock.mockResolvedValue({ rows: [] });
  });

  const app = express();
  app.use(notificationStuck);

  it('returns counts of stuck PENDING and failed/ERRONEOUS rows per channel', async () => {
    queryHandle.mock
      .mockResolvedValueOnce({
        rows: [
          {
            pending: '2',
            failed: '1',
            erroneous: '0',
            lastFailure: { created_at: new Date('2026-10-05T10:00:00Z'), failure_reason: 'Transient provider error' },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            pending: '4',
            failed: '3',
            erroneous: '2',
            lastFailure: { created_at: new Date('2026-10-05T09:30:00Z'), failure_reason: 'Invalid address' },
          },
        ],
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
    queryHandle.mock
      .mockResolvedValueOnce({ rows: [{ pending: '0', failed: '0', erroneous: '0', lastFailure: null }] })
      .mockResolvedValueOnce({ rows: [{ pending: '0', failed: '0', erroneous: '0', lastFailure: null }] });

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
    queryHandle.mock
      .mockResolvedValueOnce({ rows: [{ pending: '0', failed: '0', erroneous: '0', lastFailure: null }] })
      .mockResolvedValueOnce({ rows: [{ pending: '0', failed: '0', erroneous: '5', lastFailure: null }] });

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
