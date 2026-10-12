// Validate the live provider credentials configured in backend/.env —
// a pre-flight check usable locally AND against production (pass a URL to
// override where .env is read from). Reads ONLY backend/.env + process env;
// never prints secret values.
//
// Usage:
//   node scripts/check-providers.mjs            # check whatever is configured
//   node scripts/check-providers.mjs --no-send  # skip the Brevo validation email
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- minimal .env loader (no dependency) ------------------------------------
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
const get = (k, d = '') => vars[k] ?? d;
const mask = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)` : '(unset)');

const emailProvider = get('EMAIL_PROVIDER', 'mock').toLowerCase();
const smsProvider = get('SMS_PROVIDER', 'mock').toLowerCase();
const emailFromRaw = get('EMAIL_FROM');
const fromAddr = (emailFromRaw.match(/<([^>]+)>/)?.[1] ?? emailFromRaw).trim();
const fromName = get('EMAIL_FROM_NAME') || get('BUSINESS_NAME') || 'RPMS';
const noSend = process.argv.includes('--no-send');
const TIMEOUT_MS = 15_000;

let failures = 0;

// --- Brevo -------------------------------------------------------------------
if (emailProvider === 'brevo') {
  const key = get('BREVO_API_KEY');
  console.log(`\n[brevo] provider=brevo  key=${mask(key)}  from=${fromAddr.replace(/^(.).*(@.*)$/, '$1***$2')}`);
  if (!key || !fromAddr) {
    console.log('[brevo] ✗ BREVO_API_KEY or EMAIL_FROM missing'); failures++;
  } else if (noSend) {
    console.log('[brevo] --no-send: skipped live send; key unverified');
  } else {
    try {
      const res = await fetch(get('BREVO_API_URL', 'https://api.brevo.com/v3/smtp/email'), {
        method: 'POST',
        headers: { accept: 'application/json', 'api-key': key, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          sender: { email: fromAddr, name: fromName },
          to: [{ email: fromAddr }],
          subject: '[RPMS] Brevo key validation',
          textContent: 'If you can read this, the Brevo API key works from this machine.',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) console.log(`[brevo] ✓ key valid — validation email sent to ${fromAddr} (check the inbox)`);
      else { console.log(`[brevo] ✗ HTTP ${res.status}: ${body.message ?? JSON.stringify(body)}`); failures++; }
    } catch (e) {
      console.log(`[brevo] ✗ request failed: ${e.message}`); failures++;
    }
  }
} else {
  console.log(`\n[brevo] EMAIL_PROVIDER=${emailProvider} — not brevo, skipped`);
}

// --- Africa's Talking ----------------------------------------------------------
if (smsProvider === 'africastalking') {
  const username = get('SMS_USERNAME');
  const apiKey = get('SMS_API_KEY');
  console.log(`\n[africastalking] provider=africastalking  username=${username ? mask(username) : '(unset)'}  apiKey=${mask(apiKey)}`);
  if (!username || !apiKey) {
    console.log('[africastalking] ✗ SMS_USERNAME / SMS_API_KEY missing'); failures++;
  } else {
    try {
      // Wallet balance query — same credentials sending uses, costs nothing.
      // NOTE: /version1/user is known to 401 on some (esp. freshly-registered)
      // accounts even when the credentials are valid, so on auth failure we
      // fall back to a zero-cost auth probe against the messaging endpoint
      // with an intentionally invalid recipient (nothing is sent).
      const res = await fetch(`https://api.africastalking.com/version1/user?username=${encodeURIComponent(username)}`, {
        headers: { apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));
      const balance = body?.UserData?.balance;
      if (res.ok && balance) {
        console.log(`[africastalking] ✓ credentials valid — wallet balance: ${balance}`);
      } else if (res.status === 401) {
        const probe = await fetch('https://api.africastalking.com/version1/messaging', {
          method: 'POST',
          headers: { apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          body: `username=${encodeURIComponent(username)}&to=${encodeURIComponent('+000000000000')}&message=probe`,
        });
        const probeBody = await probe.json().catch(() => ({}));
        const recip = probeBody?.SMSMessageData?.Recipients?.[0];
        if (probe.ok && recip) {
          console.log(`[africastalking] ✓ credentials valid (auth probe OK; balance endpoint 401s on this account — an AT quirk)`);
          console.log(`[africastalking]   probe recipient status: ${recip.status} (expected — invalid dummy number, nothing sent)`);
        } else {
          console.log(`[africastalking] ✗ HTTP ${probe.status}: ${JSON.stringify(probeBody).slice(0, 200)}`); failures++;
        }
      } else {
        console.log(`[africastalking] ✗ HTTP ${res.status}: ${body?.message ?? 'no balance in response'}`); failures++;
      }
    } catch (e) {
      console.log(`[africastalking] ✗ request failed: ${e.message}`); failures++;
    }
  }
} else {
  console.log(`\n[africastalking] SMS_PROVIDER=${smsProvider} — not africastalking, skipped`);
}

// --- textbee (own-SIM gateway) --------------------------------------------------
if (smsProvider === 'textbee') {
  const key = get('TEXTBEE_API_KEY');
  // Trailing slashes are stripped by the backend so the path never doubles;
  // do the same here so the probe hits the real endpoint.
  const apiUrl = (get('TEXTBEE_API_URL', 'https://api.textbee.dev/api/v1') || 'https://api.textbee.dev/api/v1').replace(/\/+$/, '');
  console.log(`\n[textbee] provider=textbee  apiKey=${mask(key)}  api=${apiUrl}`);
  if (!key) {
    console.log('[textbee] ✗ TEXTBEE_API_KEY missing'); failures++;
  } else {
    // No wallet to check and no free send to spend — list the registered
    // devices instead. This verifies the API key AND whether a phone is
    // actually registered and beating its heartbeat, which is the failure
    // mode that matters for an own-SIM gateway.
    try {
      const res = await fetch(`${apiUrl}/gateway/devices`, {
        headers: { 'x-api-key': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.log(`[textbee] ✗ HTTP ${res.status}: ${body.message ?? JSON.stringify(body).slice(0, 200)}`);
        failures++;
      } else {
        const devices = Array.isArray(body.data) ? body.data : [];
        if (devices.length === 0) {
          console.log('[textbee] ✗ API key valid but no phone is registered — install the textbee app on the phone and register it');
          failures++;
        } else {
          console.log(`[textbee] ✓ API key valid — ${devices.length} device(s) registered`);
          const configured = get('TEXTBEE_DEVICE_ID');
          for (const d of devices) {
            const id = d?._id ?? d?.id ?? '(unknown id)';
            const beat = d?.lastHeartbeat;
            const ageMs = beat ? Date.now() - new Date(beat).getTime() : null;
            const stale = ageMs === null || Number.isNaN(ageMs) || ageMs > 15 * 60 * 1000;
            const marker = configured && String(id) === configured ? '  <- TEXTBEE_DEVICE_ID' : '';
            console.log(`[textbee]   device ${id}${marker}: lastHeartbeat=${beat ?? 'never'}${stale ? ' ⚠ STALE (>15min or missing — the phone is likely offline, sends will queue and fail)' : ' ✓'}`);
          }
          if (configured && !devices.some((d) => String(d?._id ?? d?.id) === configured)) {
            console.log(`[textbee] ✗ TEXTBEE_DEVICE_ID=${configured} does not match any registered device`);
            failures++;
          }
        }
      }
    } catch (e) {
      console.log(`[textbee] ✗ request failed: ${e.message}`);
      failures++;
    }
  }
} else {
  console.log(`\n[textbee] SMS_PROVIDER=${smsProvider} — not textbee, skipped`);
}

console.log(failures === 0 ? '\nAll configured providers validated.' : `\n${failures} provider check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
