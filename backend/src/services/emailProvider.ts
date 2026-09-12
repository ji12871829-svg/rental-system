// Email provider abstraction — mirrors smsProvider.ts: the ONLY file that
// knows about a real provider (credentials in env vars, never in code/DB).
//
// Selection is env-driven via backend/.env:
//   EMAIL_PROVIDER=mock            (default) simulated send — no network call,
//                                  recorded with a MOCK-<id> reference
//   EMAIL_PROVIDER=smtp            real delivery via any SMTP server
//   SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS
//   EMAIL_PROVIDER=brevo          Brevo transactional email API
//   BREVO_API_KEY / BREVO_TEST_RECIPIENTS
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
  provider: 'mock' | 'smtp' | 'brevo';
  live: boolean;
  from: string | null;
  autoSend: boolean;
}

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Attachments in send order. Text types (JSON, HTML) pass `content` as
  // utf8 text; binary types (PDFs) pass base64 in `content` with the matching
  // `contentType` — the provider decodes accordingly.
  attachments: { filename: string; content: string; contentType?: string }[];
}

const DEFAULT_TIMEOUT_MS = 15_000;

// Current mode, safe to expose to the UI — contains no secrets.
export function getEmailConfig(): EmailConfig {
  const provider: EmailConfig['provider'] =
    !isTest && (env.emailProvider === 'smtp' || env.emailProvider === 'brevo') ? env.emailProvider : 'mock';
  const credsReady = Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.emailFrom);
  const brevoReady = Boolean(env.brevoApiKey && env.emailFrom && env.emailFromName);
  return {
    provider,
    live: provider === 'smtp' ? credsReady : provider === 'brevo' && brevoReady,
    from: env.emailFrom || env.businessEmail || null,
    autoSend: env.emailAutoSend,
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
  if (payload.attachments.length > 0) {
    mail.attachments = payload.attachments.map((a) => ({
      filename: a.filename,
      // application/pdf is stored base64 (binary); every other type is utf8.
      content: (a.contentType ?? 'text/html').startsWith('application/pdf')
        ? Buffer.from(a.content, 'base64')
        : Buffer.from(a.content, 'utf8'),
      contentType: a.contentType ?? 'text/html',
    }));
  }

  try {
    const info: SentMessageInfo = await transport().sendMail(mail);
    return { ok: true, providerMessageId: info.messageId ?? 'unknown' };
  } catch (err) {
    return { ok: false, failureReason: `SMTP send failed: ${(err as Error).message}` };
  }
}

async function brevoSend(payload: EmailPayload): Promise<EmailSendResult> {
  const cfg = getEmailConfig();
  if (!cfg.live) {
    return { ok: false, failureReason: 'EMAIL_PROVIDER=brevo requires BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME.' };
  }
  const recipient = payload.to.trim().toLowerCase();
  if (env.brevoTestRecipients.length > 0 && !env.brevoTestRecipients.includes(recipient)) {
    return { ok: false, failureReason: `Brevo test mode blocked recipient ${payload.to}; add it to BREVO_TEST_RECIPIENTS.` };
  }
  const attachments = payload.attachments.map((attachment) => ({
    name: attachment.filename,
    content: attachment.contentType?.startsWith('application/pdf')
      ? attachment.content
      : Buffer.from(attachment.content, 'utf8').toString('base64'),
  }));
  try {
    const response = await fetch(env.brevoApiUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': env.brevoApiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: extractAddress(env.emailFrom), name: env.emailFromName },
        to: [{ email: payload.to }],
        subject: payload.subject,
        textContent: payload.text,
        htmlContent: payload.html,
        ...(attachments.length > 0 ? { attachment: attachments } : {}),
      }),
    });
    const body = await response.json().catch(() => ({})) as { messageId?: string; message?: string };
    if (!response.ok) return { ok: false, failureReason: `Brevo send failed (${response.status}): ${body.message ?? 'provider error'}` };
    return { ok: true, providerMessageId: body.messageId ?? 'brevo-accepted' };
  } catch (error) {
    return { ok: false, failureReason: `Brevo send failed: ${(error as Error).message}` };
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
  return provider === 'brevo' ? brevoSend(payload) : smtpSend(payload);
}
