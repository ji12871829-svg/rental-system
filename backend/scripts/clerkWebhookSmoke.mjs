// Ops smoke test for POST /api/webhooks/clerk — verify the Clerk webhook
// end-to-end from a terminal, without the Clerk dashboard or a real sign-up.
//
// Plain Node ESM on purpose (same as predeploy-check.mjs): runs anywhere the
// repo is checked out, zero dependencies beyond pg (already a runtime dep).
//
//   DRY-RUN (safe on any deployment, no secret needed):
//     node scripts/clerkWebhookSmoke.mjs --url https://<host>
//
//   FULL RUN (enables the mapped probe + automatic cleanup):
//     node scripts/clerkWebhookSmoke.mjs --url https://<host> --secret whsec_... --yes
//
//   CLEANUP ONLY (if a previous full run was interrupted before its delete):
//     node scripts/clerkWebhookSmoke.mjs --database-url postgres://... --cleanup user_smoke_clerk_probe
//
// What full mode proves, in order:
//   1. the endpoint refuses UNsigned bodies (400 INVALID_SIGNATURE) — or is
//      still fail-closed (401 UNCONFIGURED, i.e. the signing secret is not
//      deployed yet);
//   2. a signed UNVERIFIED email maps nothing (and a refusal is audited);
//   3. a signed unknown email maps nothing ('no matching active staff user');
//   4. a signed VERIFIED email of a real ACTIVE staff user AUTO-MAPS (201,
//      mapping row visible in the database);
//   5. the probe mapping is DELETED again — the run leaves nothing behind.
// Exit code 0 = all green; 1 = any check failed (message says which).
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}
const has = (name) => args.includes(`--${name}`);

const BASE_URL = (flag('url') || process.env.RPMS_URL || '').replace(/\/+$/, '');
const SECRET = flag('secret') || process.env.CLERK_WEBHOOK_SIGNING_SECRET;
const DATABASE_URL = flag('database-url') || process.env.DATABASE_URL;
const CONFIRM = has('yes');
const CLEANUP_ONLY = flag('cleanup');
const EXTERNAL_ID = flag('external-id') || 'user_smoke_clerk_probe';
const EXTERNAL_PREFIX = 'user_smoke_clerk_%';
const SMOKE_EMAIL = 'clerk.webhook.smoke@rpms.local';

function die(msg) {
  console.error(`[clerk-smoke] ${msg}`);
  console.error('usage: node scripts/clerkWebhookSmoke.mjs --url <base> [--secret whsec_...] [--yes]');
  console.error('       node scripts/clerkWebhookSmoke.mjs --database-url <url> --cleanup <external_id>');
  process.exit(2);
}

// --- signing (identical scheme to the route's verifyWebhook) ---------------
function signedHeaders(body, secret) {
  if (!secret.startsWith('whsec_')) die(`--secret must start with whsec_ (got something else)`);
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  if (key.length === 0) die('--secret decodes to empty bytes — copy the value verbatim from Clerk');
  const msgId = `msg_${crypto.randomBytes(12).toString('hex')}`;
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac('sha256', key).update(`${msgId}.${ts}.${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'svix-id': msgId,
    'svix-timestamp': ts,
    'svix-signature': `v1,${sig}`,
  };
}

function userCreatedBody(externalId, email, verified) {
  return JSON.stringify({
    type: 'user.created',
    data: {
      id: externalId,
      primary_email_address_id: 'email_smoke_1',
      email_addresses: [
        { id: 'email_smoke_1', email_address: email, verification: { status: verified ? 'verified' : 'unverified' } },
      ],
    },
  });
}

async function postWebhook(body, headers) {
  const res = await fetch(`${BASE_URL}/api/webhooks/clerk`, {
    method: 'POST',
    headers: headers ?? { 'content-type': 'application/json' },
    body,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON (proxy error page) */ }
  return { status: res.status, json };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function connectDb() {
  if (!DATABASE_URL) die('--yes needs --database-url (or DATABASE_URL in backend/.env)');
  const { Client } = await import('pg');
  const isLocal = /localhost|127\.0\.0\.1|::1/.test(new URL(DATABASE_URL).hostname);
  const client = new Client({ connectionString: DATABASE_URL, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function main() {
  // --- cleanup-only mode -----------------------------------------------------
  if (CLEANUP_ONLY) {
    const client = await connectDb();
    try {
      const del = await client.query(
        "DELETE FROM user_external_ids WHERE external_id = $1 AND provider = 'clerk'",
        [CLEANUP_ONLY],
      );
      console.log(`[clerk-smoke] deleted ${del.rowCount} mapping row(s) for ${CLEANUP_ONLY}`);
    } finally {
      await client.end();
    }
    process.exitCode = 0;
    return;
  }

  // --- probe modes -------------------------------------------------------------
  if (!BASE_URL) die('--url is required (e.g. --url https://rpms-gakt.onrender.com)');

  // Shared probe 1: an UNsigned body must never be accepted.
  const unsigned = await postWebhook(userCreatedBody(EXTERNAL_ID, SMOKE_EMAIL, true));
  if (unsigned.status === 401 && unsigned.json?.error === 'UNCONFIGURED') {
    console.log('INFO  webhook is fail-closed (401 UNCONFIGURED) — CLERK_WEBHOOK_SIGNING_SECRET is not deployed yet.');
    if (!SECRET) {
      console.log('      Enable it (runbook §3.A), then re-run with --secret. Nothing else was probed.');
      process.exitCode = 1;
      return;
    }
    console.log('      --secret provided; continuing against a deployment that has not restarted with it yet.');
  } else {
    check('unsigned body is rejected', unsigned.status === 400 && unsigned.json?.error === 'INVALID_SIGNATURE',
      unsigned.status === 401 ? 'got 401 without UNCONFIGURED body' : `got HTTP ${unsigned.status}`);
  }

  if (!SECRET) {
    // Refusal-only mode: proves routing + signature gate without touching data.
    const res = await postWebhook('{}');
    check('unsigned probe rejected (endpoint reachable, signature gate live)', res.status === 400, `got HTTP ${res.status}`);
    console.log(`\n[clerk-smoke] ${results.every((r) => r.ok) ? 'gate checks green' : 'FAILURES above'} — run with --secret whsec_... --yes for the full mapped-probe.`);
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    return;
  }

  // Probe 2: unverified email → mapped:null + audited refusal.
  const unverifiedBody = userCreatedBody(EXTERNAL_ID, SMOKE_EMAIL, false);
  const unverified = await postWebhook(unverifiedBody, signedHeaders(unverifiedBody, SECRET));
  check('signed unverified email maps nothing',
    unverified.status === 200 && unverified.json?.data?.mapped === null && unverified.json?.data?.reason === 'no verified email',
    `got HTTP ${unverified.status} ${JSON.stringify(unverified.json)}`);

  // Probe 3: verified but unknown email → mapped:null + audited refusal.
  const nobody = userCreatedBody(EXTERNAL_ID, 'clerk.webhook.smoke.nobody@nowhere.test', true);
  const nobodyRes = await postWebhook(nobody, signedHeaders(nobody, SECRET));
  check('signed unknown email maps nothing',
    nobodyRes.status === 200 && nobodyRes.json?.data?.reason === 'no matching active staff user',
    `got HTTP ${nobodyRes.status} ${JSON.stringify(nobodyRes.json)}`);

  // Probe 4+5 need a database connection and change data — require --yes.
  if (!CONFIRM) {
    console.log('\n[clerk-smoke] gate checks green. The mapped probe inserts a temporary');
    console.log('mapping row against a real staff user — re-run with --yes to perform it');
    console.log('(it cleans up after itself).');
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    return;
  }

  const client = await connectDb();
  try {
    // The local user the probe will map to: the first ACTIVE admin with NO
    // existing Clerk mapping, on their PRIMARY email (what the webhook
    // matches on). Pre-provisioned admins are skipped on purpose — inserting
    // their mapping would conflict, and the row check below would misreport.
    const admin = await client.query(
      `SELECT u.id, u.email FROM users u
        WHERE u.role = 'ADMIN' AND u.status = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM user_external_ids x WHERE x.user_id = u.id AND x.provider = 'clerk')
        ORDER BY u.id LIMIT 1`,
    );
    if (admin.rowCount === 0) {
      console.log('SKIP  mapped probe — every ACTIVE admin already has a Clerk mapping (nothing left to prove it with).');
      console.log(`      If a previous run was interrupted, clean up: node scripts/clerkWebhookSmoke.mjs --database-url ... --cleanup ${EXTERNAL_ID}`);
    } else {
      const adminId = admin.rows[0].id;
      const adminEmail = admin.rows[0].email;

      // Clear any leftovers from an interrupted earlier run.
      await client.query('DELETE FROM user_external_ids WHERE external_id LIKE $1', [EXTERNAL_PREFIX]);

      const mapped = userCreatedBody(EXTERNAL_ID, adminEmail, true);
      const mappedRes = await postWebhook(mapped, signedHeaders(mapped, SECRET));
      check('signed verified admin email auto-maps',
        (mappedRes.status === 201 && mappedRes.json?.data?.mapped === adminId) ||
          (mappedRes.status === 200 && mappedRes.json?.data?.alreadyMapped === true),
        `got HTTP ${mappedRes.status} ${JSON.stringify(mappedRes.json)} (expected 201 mapped=${adminId} for ${adminEmail})`);

      const row = await client.query(
        `SELECT user_id FROM user_external_ids WHERE provider = 'clerk' AND external_id = $1`,
        [EXTERNAL_ID],
      );
      check('mapping row exists in the database', row.rowCount === 1 && row.rows[0].user_id === adminId,
        row.rowCount === 0 ? 'row missing' : `user_id=${row.rows[0].user_id}`);

      // Cleanup: DELETE first (the documented admin op), then verify gone.
      const del = await client.query(
        `DELETE FROM user_external_ids WHERE provider = 'clerk' AND external_id = $1`,
        [EXTERNAL_ID],
      );
      const gone = await client.query(
        `SELECT 1 FROM user_external_ids WHERE provider = 'clerk' AND external_id = $1`,
        [EXTERNAL_ID],
      );
      check('probe mapping cleaned up (row deleted and verified gone)',
        del.rowCount === 1 && gone.rowCount === 0,
        del.rowCount !== 1 ? 'delete matched no row' : gone.rowCount !== 0 ? 'row still present after delete' : undefined);
    }
  } finally {
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[clerk-smoke] ${failed.length === 0 ? 'ALL GREEN — the webhook is live and auto-mapping' : `${failed.length} check(s) FAILED`} (${results.length} checks)`);
  // exitCode + natural drain instead of process.exit(): on Windows, exiting
  // while pg's sockets are closing trips a libuv assertion and mangles the code.
  process.exitCode = failed.length === 0 ? 0 : 1;
}

await main();
