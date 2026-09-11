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
  emailProvider: (process.env.EMAIL_PROVIDER || 'mock').toLowerCase() as 'mock' | 'smtp',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailFrom: process.env.EMAIL_FROM || '',
  // Business identity appended to tenant receipt SMS (optional — see .env.example).
  businessName: process.env.BUSINESS_NAME || '',
  businessRegNo: process.env.BUSINESS_REG_NO || '',
  // Contact details appended to the SMS identity block (optional — plain text;
  // smartphones auto-linkify them, and the SMS history modal renders links).
  businessPhone: process.env.BUSINESS_PHONE || '',
  businessEmail: process.env.BUSINESS_EMAIL || '',
  // Sender identity for emailed receipts (defaults to BUSINESS_EMAIL).
  emailFromName: process.env.EMAIL_FROM_NAME || process.env.BUSINESS_NAME || '',
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
  mpesaBaseUrl: process.env.MPESA_BASE_URL || 'https://sandbox.safaricom.co.ke',
  mpesaTimeoutMs: Number(process.env.MPESA_TIMEOUT_MS) || 15_000,
};

export const isTest = env.nodeEnv === 'test';
export const isProd = env.nodeEnv === 'production';