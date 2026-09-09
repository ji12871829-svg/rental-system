// Email provider abstraction — mirrors smsProvider.ts: the ONLY file that
// knows about a real provider (credentials in env vars, never in code/DB).
//
// Selection is env-driven via backend/.env:
//   EMAIL_PROVIDER=mock            (default) simulated send — no network call,
//                                  recorded with a MOCK-<id> reference
//   EMAIL_PROVIDER=smtp            real delivery via any SMTP server
//   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
//   EMAIL_FROM                     e.g. "RPMS <no-reply@yourdomain.com>"
//   EMAIL_FROM_NAME                display name (defaults to BUSINESS_NAME)
//
// Safety nets (same as SMS):
//   - NODE_ENV=test forces the mock provider so test runs can never send
//     real email, even if credentials are present.
//   - A live provider with missing credentials records a FAILED row with a
//     clear reason instead of crashing or silently pretending success.
import { createTransport } from 'nodemailer';
import type { SendMailOptions, SentMessageInfo } from 'nodemailer';
import { env, isTest } from '../config/env';

export interface EmailSendResult {
  ok: boolean;
  providerMessageId?: string;
  failureReason?: string;
}

export interface EmailConfig {
  provider: 'mock' | 'smtp';
  live: boolean;
  from: string | null;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Single file attachment. Text types (JSON, HTML) pass `content` as utf8
  // text; binary types (the receipt PDF) pass base64 in `content` with the
  // matching `contentType` — the provider decodes accordingly.
  attachment: { filename: string; content: string; contentType?: string } | null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

// Current mode, safe to expose to the UI — contains no secrets.
export function getEmailConfig(): EmailConfig {
  const provider: EmailConfig['provider'] =
    !isTest && env.emailProvider === 'smtp' ? 'smtp' : 'mock';
  const credsReady = Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.emailFrom);
  return {
    provider,
    live: provider === 'smtp' && credsReady,
    from: env.emailFrom || env.businessEmail || null,
  };
}

// Basic shape check — real deliverability (MX etc.) is the provider's job.
export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

// --- Mock (simulated) provider ----------------------------------------------

function mockSend(): EmailSendResult {
  return { ok: true, providerMessageId: `MOCK-${Date.now()}` };
}

// --- SMTP --------------------------------------------------------------------

function transport(): ReturnType<typeof createTransport> {
  return createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    connectionTimeout: DEFAULT_TIMEOUT_MS,
    greetingTimeout: DEFAULT_TIMEOUT_MS,
    socketTimeout: DEFAULT_TIMEOUT_MS,
  });
}

async function smtpSend(payload: EmailPayload): Promise<EmailSendResult> {
  const cfg = getEmailConfig();
  if (!cfg.live) {
    return {
      ok: false,
      failureReason:
        'EMAIL_PROVIDER=smtp but SMTP_HOST / SMTP_USER / SMTP_PASS / EMAIL_FROM are not fully set in backend/.env.',
    };
  }

  const mail: SendMailOptions = {
    from: env.emailFromName ? `"${env.emailFromName}" <${extractAddress(env.emailFrom)}>` : env.emailFrom,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  };
  if (payload.attachment) {
    const a = payload.attachment;
    const isBinary = (a.contentType ?? 'text/html').startsWith('application/pdf');
    mail.attachments = [
      {
        filename: a.filename,
        content: isBinary ? Buffer.from(a.content, 'base64') : Buffer.from(a.content, 'utf8'),
        contentType: a.contentType ?? 'text/html',
      },
    ];
  }

  try {
    const info: SentMessageInfo = await transport().sendMail(mail);
    return { ok: true, providerMessageId: info.messageId ?? 'unknown' };
  } catch (err) {
    return { ok: false, failureReason: `SMTP send failed: ${(err as Error).message}` };
  }
}

// "Display Name" may come from EMAIL_FROM_NAME while EMAIL_FROM holds the
// bare address; nodemailer would double-wrap a quoted name, so rebuild it.
function extractAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return match ? match[1] : raw.trim();
}

export async function sendEmail(payload: EmailPayload): Promise<EmailSendResult> {
  const { provider } = getEmailConfig();
  if (provider === 'mock') return mockSend();
  return smtpSend(payload);
}
