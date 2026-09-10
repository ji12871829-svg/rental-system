import { createApp } from './app';
import { env } from './config/env';
import { pool } from './config/db';
import { bootstrapIfEmpty } from './db/bootstrap';
import { getSmsConfig } from './services/smsProvider';
import { startSmsRetryJob, stopSmsRetryJob } from './services/smsRetryJob';
import { startTenantRetentionJob, stopTenantRetentionJob } from './services/tenantRetentionJob';

const app = createApp();

async function main() {
  try {
    await pool.query('SELECT 1');
    // First-boot bootstrap (prod deploys onto a fresh, empty database): no-op
    // on every subsequent boot. Awaited so the health check only turns green
    // on a ready service.
    await bootstrapIfEmpty();
    const server = app.listen(env.port, () => {
      // eslint-disable-next-line no-console
      console.log(`RPMS API listening on http://localhost:${env.port} (${env.nodeEnv})`);
      startSmsRetryJob();
      startTenantRetentionJob();
      const sms = getSmsConfig();
      if (sms.provider === 'mock') {
        // eslint-disable-next-line no-console
        console.log('SMS: simulated mode — sends are recorded, not delivered (set SMS_PROVIDER=africastalking or twilio in backend/.env to go live).');
      } else if (!sms.live) {
        // eslint-disable-next-line no-console
        console.warn(
          sms.provider === 'twilio'
            ? 'SMS: provider is twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and a sender (TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID) are missing — sends will FAIL until configured.'
            : 'SMS: provider is africastalking but SMS_USERNAME/SMS_API_KEY are missing — sends will FAIL until configured.'
        );
      } else {
        const label = sms.provider === 'twilio' ? 'Twilio' : "Africa's Talking";
        // eslint-disable-next-line no-console
        console.log(`SMS: live via ${label}${sms.senderId ? ` (sender: ${sms.senderId})` : ''}.`);
      }
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
    stopTenantRetentionJob();
    process.exit(0);
  });
}

main();