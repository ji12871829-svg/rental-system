import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from './app';
import { env } from './config/env';
import { pool } from './config/db';
import { bootstrapIfEmpty } from './db/bootstrap';
import { applyMigrations } from './db/migrations';
import { getSmsConfig } from './services/smsProvider';
import { startSmsRetryJob, stopSmsRetryJob } from './services/smsRetryJob';
import { startEmailRetryJob, stopEmailRetryJob } from './services/emailRetryJob';
import { startWhatsappRetryJob, stopWhatsappRetryJob } from './services/whatsappRetryJob';
import { getWhatsappConfig } from './services/whatsappProvider';
import { startTenantRetentionJob, stopTenantRetentionJob } from './services/tenantRetentionJob';
import { startStaleUnmatchedAlertJob, stopStaleUnmatchedAlertJob } from './services/staleUnmatchedAlertJob';
import { startRecurringExpenseJob, stopRecurringExpenseJob } from './services/recurringExpenseJob';
import { startAutoReminderJob, stopAutoReminderJob } from './services/autoReminderJob';

const app = createApp();

async function main() {
  try {
    // Boot probe with retry — the free Neon pooler's first connections after
    // idle can intermittently return a mangled response (pg v3 "syntax error
    // at or near //"), even interleaved with successes. The pre-deploy gate
    // (scripts/predeploy-check.mjs) already retries its probe for exactly
    // this; the app must too, or a cold pooler aborts a good deploy right
    // after the gate passed. Same policy: 5 attempts, short backoff.
    const BOOT_PROBE_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= BOOT_PROBE_ATTEMPTS; attempt += 1) {
      try {
        if (attempt > 1) await sleep(Math.min(2000 * (attempt - 1), 6000));
        await pool.query('SELECT 1');
        break;
      } catch (err) {
        if (attempt === BOOT_PROBE_ATTEMPTS) throw err;
        // eslint-disable-next-line no-console
        console.warn(`[boot] DB probe attempt ${attempt} failed (${(err as Error).message}) — retrying…`);
      }
    }
    // First-boot bootstrap (prod deploys onto a fresh, empty database): no-op
    // on every subsequent boot. Awaited so the health check only turns green
    // on a ready service.
    await bootstrapIfEmpty();
    await applyMigrations();
    app.listen(env.port, () => {
      // eslint-disable-next-line no-console
      console.log(`RPMS API listening on http://localhost:${env.port} (${env.nodeEnv})`);
      startSmsRetryJob();
      startEmailRetryJob();
      startWhatsappRetryJob();
      startTenantRetentionJob();
      startStaleUnmatchedAlertJob();
      startRecurringExpenseJob();
      startAutoReminderJob();
      // Fire-and-forget boot log: getSmsConfig is async now (it may read the
      // DB override) and the listener callback must not block on it.
      void getSmsConfig().then((sms) => {
        if (sms.provider === 'mock') {
          // eslint-disable-next-line no-console
          console.log('SMS: simulated mode — sends are recorded, not delivered (choose a provider in Settings → SMS provider, or set SMS_PROVIDER in backend/.env to go live).');
        } else if (!sms.live) {
          // eslint-disable-next-line no-console
          console.warn(
            sms.provider === 'twilio'
              ? 'SMS: provider is twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and a sender (TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID) are missing — sends will FAIL until configured.'
              : 'SMS: provider is africastalking but SMS_USERNAME/SMS_API_KEY are missing — sends will FAIL until configured.'
          );
        } else {
          const label = sms.provider === 'twilio' ? 'Twilio' : sms.provider === 'textbee' ? 'textbee (own-SIM)' : "Africa's Talking";
          // eslint-disable-next-line no-console
          console.log(`SMS: live via ${label}${sms.senderId ? ` (sender: ${sms.senderId})` : ''}.`);
        }
      });
      // WhatsApp boot hint — synchronous (env-only config), so inline.
      const wa = getWhatsappConfig();
      // eslint-disable-next-line no-console
      console.log(
        wa.live
          ? `WhatsApp: live via Meta Cloud API (Graph ${wa.apiVersion}) — reminders and Final Notices send directly.`
          : 'WhatsApp: click-to-chat mode — set WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID in backend/.env to send directly.'
      );
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Could not connect to PostgreSQL:', (err as Error).message);
    process.exit(1);
  }
}

// Stop the retry interval on shutdown so the process can exit cleanly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopSmsRetryJob();
    stopEmailRetryJob();
    stopWhatsappRetryJob();
    stopTenantRetentionJob();
    stopStaleUnmatchedAlertJob();
    stopRecurringExpenseJob();
    stopAutoReminderJob();
    process.exit(0);
  });
}

main();