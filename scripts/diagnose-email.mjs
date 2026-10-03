// One-shot diagnosis for "emails are being sent but tenants aren't receiving them".
// Reads ONLY backend/.env (never prints secrets) and the local Postgres DB.
//
// Usage: node scripts/diagnose-email.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

function loadDotEnv(paths) {
  const vars = {};
  for (const p of paths) {
    try {
      const text = readFileSync(resolve(p), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !(m[1] in vars)) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* file missing — fine */ }
  }
  return vars;
}

const vars = { ...loadDotEnv(['backend/.env', '.env']), ...process.env };
const key = vars.BREVO_API_KEY || '';
const fromRaw = vars.EMAIL_FROM || '';
const fromAddr = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim();
const isTest = (vars.NODE_ENV || 'development') === 'test';
const autoSend = (vars.EMAIL_AUTO_SEND ?? 'true') !== 'false';

// --- 1. DB rows ----------------------------------------------------------------
let dbRows = null, tenantEmails = null, dbError = null;
try {
  const require = createRequire(resolve('backend/package.json'));
  const { Client } = require('pg');
  const client = new Client({ connectionString: vars.DATABASE_URL || 'postgres://rms_user:rms_password@localhost:5432/rpms' });
  await client.connect();
  dbRows = (await client.query(
    `SELECT id, email_address, subject, status, failure_reason, sent_at, created_at
       FROM email_notifications ORDER BY created_at DESC LIMIT 12`
  )).rows;
  tenantEmails = (await client.query(
    `SELECT id, full_name, email FROM tenants WHERE email IS NOT NULL AND email <> '' ORDER BY id LIMIT 15`
  )).rows;
  await client.end();
} catch (e) { dbError = e.message; }

console.log('=== RPMS config ===');
console.log(`NODE_ENV=${vars.NODE_ENV || '(unset → development)'}  EMAIL_AUTO_SEND=${vars.EMAIL_AUTO_SEND ?? '(unset → true)'}  effectiveAutoSend=${autoSend && !isTest}`);
console.log(`sender address: ${fromAddr.replace(/^(.).*(@.*)$/, '$1***$2')}\n`);

console.log('=== email_notifications (latest 12) ===');
if (dbError) console.log(`✗ DB error: ${dbError}`);
else if (!dbRows.length) console.log('(no rows — no email was ever attempted)');
else for (const r of dbRows) {
  const why = r.failure_reason ? `  reason=${r.failure_reason.slice(0, 120)}` : '';
  console.log(`#${r.id} [${r.status}] → ${r.email_address}  "${r.subject.slice(0, 50)}"  ${r.created_at?.toISOString?.() ?? r.created_at}${r.sent_at ? ` sent=${r.sent_at.toISOString?.() ?? r.sent_at}` : ''}${why}`);
}

console.log('\n=== tenant emails on file ===');
if (tenantEmails) for (const t of tenantEmails) console.log(`tenant #${t.id} ${t.full_name}: ${t.email}`);

// --- 2. Brevo's view ------------------------------------------------------------
if (!key) { console.log('\n[brevo] no API key configured — skip event log'); process.exit(0); }
console.log('\n=== Brevo event log (latest events) ===');
try {
  const res = await fetch('https://api.brevo.com/v3/smtp/statistics/events?limit=30&sort=desc', {
    headers: { accept: 'application/json', 'api-key': key },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.log(`✗ HTTP ${res.status}: ${body.message ?? JSON.stringify(body).slice(0, 200)}`); process.exit(0); }
  const events = body.events ?? [];
  if (!events.length) console.log('(Brevo has NO send events — nothing ever reached Brevo)');
  for (const ev of events) {
    console.log(`${ev.time ? new Date(ev.time * 1000).toISOString() : '?'}  ${ev.event?.toUpperCase().padEnd(10)}  to=${ev.email}  subj="${ev.subject ?? ''}"${ev.reason ? `  reason=${ev.reason}` : ''}`);
  }
} catch (e) { console.log(`✗ Brevo request failed: ${e.message}`); }
