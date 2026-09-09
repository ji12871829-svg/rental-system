// tests/integration/helpers.js — shared setup per test file.
// globalSetup has already pointed DATABASE_URL at the isolated test DB.
//
// Reset strategy: each integration FILE calls resetDatabase() in its
// beforeAll so every suite starts from the exact seeded state (ids 1..n,
// leases active, etc.). users + building_settings are kept (the seed admin
// must survive for login), everything else is truncated and re-seeded.
const { Client } = require('pg');
const { runSeed } = require('../../server/src/config/runSeed');

async function resetDatabase() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      TRUNCATE TABLE maintenance_requests, payments, leases, tenants, units
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end();
  }
  await runSeed(); // re-inserts the baseline seed rows with ids 1,2,3,…
}

// ---- Cookie-session test agent ----
//
// `loginAgent(request, app)` returns an agent that logs in once via POST
// /auth/login and keeps the returned cookies (the httpOnly JWT + the CSRF
// cookie) for subsequent requests. It also remembers the CSRF token from the
// response body and exposes `agent.csrf()` so tests can attach the
// X-CSRF-Token header to every mutating request — exactly like the web
// client does.
const request = require('supertest');

const SEED_ADMIN = { email: 'admin@olbano.example', password: 'ChangeMe123!' };

async function loginAgent(app, credentials = SEED_ADMIN) {
  const agent = request.agent(app); // supertest agent persists cookies
  const res = await agent.post('/api/auth/login').send(credentials).expect(200);
  if (!res.body.csrfToken) {
    throw new Error('loginAgent: login response did not include csrfToken');
  }
  agent._rmsCsrf = res.body.csrfToken;
  return agent;
}

function csrfHeader(agentOrToken) {
  const token = typeof agentOrToken === 'string'
    ? agentOrToken
    : (agentOrToken && agentOrToken._rmsCsrf) || '';
  return { 'X-CSRF-Token': token };
}

module.exports = { resetDatabase, loginAgent, csrfHeader, SEED_ADMIN };