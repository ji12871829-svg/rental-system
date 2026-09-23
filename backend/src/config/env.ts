// Central environment configuration. Secrets (JWT_SECRET, SMS_API_KEY, DB
// password) are read ONLY from process.env — never from source code and never
// sent to the frontend.
import dotenv from 'dotenv';
import path from 'path';

// Load backend/.env when running from the repo root or backend dir.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  // Render injects PORT (default 10000); local dev keeps 4000.
  port: Number(process.env.PORT) || 4000,
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://rms_user:rms_password@localhost:5432/rpms',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  // Per-token-population signing secrets. The staff app and the tenant portal
  // both mint JWTs; historically they shared JWT_SECRET and the two auth
  // domains were separated only by the audience claim. Each population now
  // has its own key so a leaked or mis-verified token from one side cannot be
  // replayed against the other even if an audience check is ever lost.
  // Backward compatibility: when the specific key is unset it falls back to
  // JWT_SECRET, so existing deployments keep working unchanged (same key as
  // today, audience still enforced). Set both in production to harden —
  // see the startup warning below.
  jwtStaffSecret: process.env.JWT_STAFF_SECRET || process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtPortalSecret: process.env.JWT_PORTAL_SECRET || process.env.JWT_SECRET || 'dev-only-secret-change-me',
  // Clerk (staff sign-in): when CLERK_SECRET_KEY is set the backend accepts
  // Clerk sessions on staff routes (mapped to local users by email, see
  // user_external_ids) and the staff tab of /login renders Clerk's hosted
  // sign-in. Empty = the legacy JWT/bcrypt flow only — nothing else changes.
  clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
  // Comma-separated allowlist. On same-origin deploys (frontend served by
  // this process) CORS never triggers — the origin matches nothing but the
  // browser makes no cross-origin request. This keeps split deploys working.
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  smsProvider: (process.env.SMS_PROVIDER || 'mock').toLowerCase() as 'mock' | 'africastalking' | 'twilio',
  // Auto-send receipt SMS right after the payment commits (set false to keep
  // them PENDING for manual sending from the SMS history page).
  smsAutoSend: (process.env.SMS_AUTO_SEND || 'true').toLowerCase() !== 'false',
  // Automatic retry of FAILED SMS (see smsRetryJob). Base delay is the first
  // wait; each further attempt multiplies it (1m → 5m → 25m by default).
  smsRetryEnabled: (process.env.SMS_RETRY_ENABLED || 'true').toLowerCase() !== 'false',
  smsMaxSendAttempts: Number(process.env.SMS_MAX_SEND_ATTEMPTS) || 3,
  smsRetryBaseDelayMs: Number(process.env.SMS_RETRY_BASE_DELAY_MS) || 60_000,
  // Email receipt delivery (optional — see .env.example).
  emailProvider: (process.env.EMAIL_PROVIDER || 'mock').toLowerCase() as 'mock' | 'smtp' | 'brevo',
  emailAutoSend: (process.env.EMAIL_AUTO_SEND || 'true').toLowerCase() !== 'false',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailFrom: process.env.EMAIL_FROM || '',
  emailFromName: process.env.EMAIL_FROM_NAME || process.env.BUSINESS_NAME || '',
  brevoApiKey: process.env.BREVO_API_KEY || '',
  brevoApiUrl: process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email',
  brevoTestRecipients: (process.env.BREVO_TEST_RECIPIENTS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  // Absolute URL of the tenant portal login page, used in credential
  // delivery emails. Must be reachable from the tenant's device.
  portalUrl: process.env.PORTAL_URL || 'http://localhost:5173/portal/login',
  // Business identity appended to tenant receipt SMS (optional — see .env.example).
  businessName: process.env.BUSINESS_NAME || '',
  businessRegNo: process.env.BUSINESS_REG_NO || '',
  // Contact details appended to the SMS identity block (optional — plain text;
  // smartphones auto-linkify them, and the SMS history modal renders links).
  businessPhone: process.env.BUSINESS_PHONE || '',
  businessEmail: process.env.BUSINESS_EMAIL || '',
  // Sender identity for emailed receipts (defaults to BUSINESS_EMAIL).
  smsApiKey: process.env.SMS_API_KEY || '',
  smsUsername: process.env.SMS_USERNAME || '',
  smsSenderId: process.env.SMS_SENDER_ID || '',
  // Low-balance warning threshold (provider currency units) for the SMS
  // account-balance check. Unset or 0 disables the warning entirely.
  smsLowBalanceThreshold: Number(process.env.SMS_LOW_BALANCE_THRESHOLD) || 0,
  // Twilio credentials (SMS_PROVIDER=twilio): send from a verified number or
  // a Messaging Service (recommended — handles number pooling for you).
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFrom: process.env.TWILIO_FROM || '',
  twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
  mpesaProvider: (process.env.MPESA_PROVIDER || 'mock').toLowerCase() as 'mock' | 'daraja',
  mpesaConsumerKey: process.env.MPESA_CONSUMER_KEY || '',
  mpesaConsumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
  mpesaShortcode: process.env.MPESA_SHORTCODE || '',
  mpesaPasskey: process.env.MPESA_PASSKEY || '',
  mpesaCallbackUrl: process.env.MPESA_CALLBACK_URL || '',
  // Shared secret Daraja can echo back so /api/mpesa/* callbacks are not
  // open to the internet. Configure the Daraja callback URL as
  // <host>/api/mpesa/…?token=<value>; the token rides in the query string
  // (Daraja cannot set custom headers) and routes/mpesa.ts verifies it
  // timing-safe. Empty in dev/test keeps callbacks open for local mocking.
  mpesaCallbackToken: process.env.MPESA_CALLBACK_TOKEN || '',
  mpesaBaseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
  mpesaTimeoutMs: Number(process.env.MPESA_TIMEOUT_MS) || 15_000,
  // --- PayHero (payment collection layer) --------------------------------
  // With no credentials the poller never starts and nothing else changes —
  // Daraja/mock flows keep working untouched.
  payheroApiUsername: process.env.PAYHERO_API_USERNAME || '',
  payheroApiPassword: process.env.PAYHERO_API_PASSWORD || '',
  payheroChannelId: process.env.PAYHERO_CHANNEL_ID || '',
  payheroBaseUrl: process.env.PAYHERO_BASE_URL || '',
  payheroPollSeconds: Math.max(30, Number(process.env.PAYHERO_POLL_SECONDS) || 60),
  payheroTimeoutMs: Number(process.env.PAYHERO_TIMEOUT_MS) || 15_000,
  // Optional public callback URL for tenant-portal STK pushes. PayHero's
  // callback is an optimization — the poller reconciles pushes regardless —
  // so the portal STK flow works without it.
  payheroStkCallbackUrl: process.env.PAYHERO_STK_CALLBACK_URL || '',
};

if (env.nodeEnv === 'production') {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.JWT_SECRET || env.jwtSecret === 'dev-only-secret-change-me') missing.push('JWT_SECRET');
  if (env.jwtSecret.length < 32) missing.push('JWT_SECRET (must be at least 32 characters)');
  if (missing.length > 0) {
    throw new Error(`Production configuration is invalid: ${missing.join(', ')}`);
  }
  // MPESA_CALLBACK_TOKEN is not hard-required: flipping it on is an ops
  // change (the Daraja callback URL must be updated to carry ?token=…), and
  // booting the app down until that happens would take rent collection
  // offline. Warn instead — routes/mpesa.ts enforces the token whenever it
  // is set, and the security runbook calls out setting it.
  if (!process.env.MPESA_CALLBACK_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn('[config] MPESA_CALLBACK_TOKEN is not set — /api/mpesa/* callbacks accept unauthenticated POSTs. Set the token and append ?token=<value> to the Daraja callback URL to lock this down.');
  }
  // Split JWT keys: warn while the two token populations still share one
  // secret (either explicitly or via fallback). Not hard-required — the
  // audience claim already separates the domains, and forcing a two-secret
  // deploy on every install buys nothing for single-operator setups.
  if (!process.env.JWT_STAFF_SECRET || !process.env.JWT_PORTAL_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('[config] JWT_STAFF_SECRET / JWT_PORTAL_SECRET are not both set — staff and portal tokens share one signing key. Set two distinct secrets to fully harden the auth boundary (see docs/RUNBOOK-jwt-secret-split.md).');
  }
  if (env.jwtStaffSecret.length < 32 || env.jwtPortalSecret.length < 32) {
    // eslint-disable-next-line no-console
    console.warn('[config] JWT_STAFF_SECRET / JWT_PORTAL_SECRET should each be at least 32 characters.');
  }
}

export const isTest = env.nodeEnv === 'test';
export const isProd = env.nodeEnv === 'production';