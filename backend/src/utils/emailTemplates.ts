// Pure email composition — every email the Outbound Email module sends lives
// here as a function from data to { subject, html, text }. No DB, no env, no
// I/O: this module is unit-testable in isolation and is the single place
// where email wording, structure and identity branding live. The lifecycle
// (validation, persistence, attachments, send transition) belongs to
// emailService.ts — the interface is "compose", the implementation is "render".
//
// Every composer takes the data it renders — nothing is fetched here — and
// takes the Business identity fields it needs (name, regNo) as plain strings,
// so tests can pass a fixed identity. Bodies are a faithful copy of what was
// sent: the email_notification record stores exactly these strings.

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

// The identity fields the composers render. name is nullable (the DB column
// is); every composer falls back to a generic label when unset.
export interface IdentityFields {
  name: string | null;
  regNo?: string | null;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

// Shared body frame so every email renders with the same card look and the
// same identity sign-off ("Olbano Property Management · Reg. No. X").
function frame(bodyHtml: string, identity: IdentityFields): string {
  const regNo = identity.regNo?.trim();
  const displayName = identity.name?.trim() || 'Property Management';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
${bodyHtml}
<p style="margin:16px 0 0;color:#6b7280;font-size:13px">${escapeHtml(displayName)}${regNo ? ` · Reg. No. ${escapeHtml(regNo)}` : ''}</p>
</div>
</body></html>`;
}

// Helper for the recurring "Reg. No. X" suffix in plain-text sign-offs.
function textSignOff(identity: IdentityFields): string {
  return `${identity.name}${identity.regNo?.trim() ? ` · Reg. No. ${identity.regNo.trim()}` : ''}`;
}

// The receipt email's composition lives in receiptDocument.ts (already a pure
// renderer) — emailService composes that kind from there directly.

// --- Portal credentials -------------------------------------------------------

export function composePortalCredentialsEmail(input: {
  tenantName: string;
  loginEmail: string;
  password: string;
  portalUrl: string;
  identity: IdentityFields;
}): ComposedEmail {
  const name = input.identity.name?.trim() || 'Property Management';
  const subject = `Your tenant portal access — ${name}`;
  const text = [
    `Dear ${input.tenantName},`,
    '',
    'Portal access for your tenancy has been set up. Sign in at:',
    input.portalUrl,
    '',
    `Login email: ${input.loginEmail}`,
    `Password: ${input.password}`,
    '',
    'This password was generated for you — please keep this email safe,',
    'or ask the office to issue a new one if it is ever compromised.',
    '',
    textSignOff(input.identity),
  ].join('\n');
  const html = frame(
    `<p style="margin:0 0 16px">Dear ${escapeHtml(input.tenantName)},</p>
<p style="margin:0 0 16px">Portal access for your tenancy has been set up.
<a href="${escapeHtml(input.portalUrl)}" style="color:#1d6fd6">Sign in here</a> to view your balance, payments, water charges and statement, and to pay rent via M-Pesa.</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 16px">
<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">Login email</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:600">${escapeHtml(input.loginEmail)}</td></tr>
<tr><td style="padding:8px 0;font-size:14px">Password</td><td style="padding:8px 0;font-size:14px;font-weight:600;font-family:monospace">${escapeHtml(input.password)}</td></tr>
</table>
<p style="margin:0 0 16px;color:#6b7280;font-size:13px">This password was generated for you — please keep this email safe, or ask the office to issue a new one if it is ever compromised.</p>`,
    input.identity
  );
  return { subject, html, text };
}

// --- Data-request response letter ---------------------------------------------

export function composeDataLetterEmail(input: {
  tenantName: string;
  registerRef: string;
  responseDays: string | null;
  letterHtml: string;
}): ComposedEmail {
  const subject = `Response to your personal-data request — ref ${input.registerRef}`;
  const text = [
    `Dear ${input.tenantName},`,
    '',
    'We refer to your request for access to the personal data we hold about you.',
    'Our formal response letter is attached to this email as a printable PDF,',
    'together with a machine-readable (JSON) copy of the data we hold.',
    '',
    `Our reference: ${input.registerRef}`,
    `Response deadline: ${input.responseDays ?? '30'} days`,
    '',
    'This response is provided under the Data Protection Act, 2019 (Kenya) and,',
    'where applicable, the General Data Protection Regulation (EU) 2016/679.',
  ].join('\n');
  return { subject, html: input.letterHtml, text };
}

// --- Monthly financial report ---------------------------------------------------

export function composeMonthlyReportEmail(input: { year: number; identity: IdentityFields }): ComposedEmail {
  const name = input.identity.name?.trim() || 'your property manager';
  const subject = `Monthly Financial Report ${input.year}`;
  const text = [
    `Dear ${name},`,
    '',
    `The Monthly Financial Report for ${input.year} is attached as a printable PDF.`,
    'It shows expected rent, water billing, collections and outstanding balances',
    'for every month of the year, with year totals.',
    '',
    'Generated by RPMS — Rental Property Management System.',
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">
<p>Dear ${escapeHtml(name)},</p>
<p>The <strong>Monthly Financial Report for ${input.year}</strong> is attached as a printable PDF.
It shows expected rent, water billing, collections and outstanding balances for every
month of the year, with year totals.</p>
<p style="color:#6b7280;font-size:13px">Generated by RPMS — Rental Property Management System.</p>
</body></html>`;
  return { subject, html, text };
}

// --- Tenant statement -----------------------------------------------------------

export function composeStatementEmail(input: { tenantName: string; year: number; identity: IdentityFields }): ComposedEmail {
  const name = input.identity.name?.trim() || 'Property Management';
  const subject = `Tenant Statement ${input.year} — ${input.tenantName}`;
  const text = [
    `Dear ${input.tenantName},`,
    '',
    `Your rental statement for ${input.year} is attached as a printable PDF.`,
    'It lists every billing month with expected rent, water charges, payments',
    'and balances, and closes with your year balance.',
    '',
    textSignOff(input.identity),
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5">
<p>Dear ${escapeHtml(input.tenantName)},</p>
<p>Your <strong>rental statement for ${input.year}</strong> is attached as a printable PDF.
It lists every billing month with expected rent, water charges, payments and balances,
and closes with your year balance.</p>
<p style="color:#6b7280;font-size:13px">${escapeHtml(name)}${input.identity.regNo?.trim() ? ` · Reg. No. ${escapeHtml(input.identity.regNo.trim())}` : ''}</p>
</body></html>`;
  return { subject, html, text };
}

// --- Tenant campaign (one template, many tenants) --------------------------------

export function composeCampaignEmail(input: { tenantName: string; unitNumber: string | null; subject: string; message: string }): ComposedEmail & { personalSubject: string } {
  const messageText = input.message.replaceAll('{{name}}', input.tenantName).replaceAll('{{unit}}', input.unitNumber ?? 'unassigned');
  const personalSubject = input.subject.replaceAll('{{name}}', input.tenantName).replaceAll('{{unit}}', input.unitNumber ?? 'unassigned');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5"><p>Dear ${escapeHtml(input.tenantName)},</p><p>${escapeHtml(messageText).replaceAll('\n', '<br>')}</p><p style="color:#6b7280;font-size:13px">Olbano Plaza</p></div>`;
  return { subject: personalSubject, personalSubject, html, text: messageText };
}

// --- Staff access request (public landlord/agent signup) -------------------------

// Operator notification for POST /api/auth/register: someone asked for a
// staff account. The recipient is the business branding general email, so
// every field the operator needs to act (who, where to reach them, that the
// Users page is where activation happens) is baked into the body. No
// password or hash is ever included — the requester never chose a working
// secret worth knowing.
export function composeStaffRequestEmail(input: {
  name: string;
  email: string;
  phone: string | null;
  identity: IdentityFields;
}): ComposedEmail {
  const name = input.identity.name?.trim() || 'Property Management';
  const subject = `New staff access request — ${input.name}`;
  const contactRows = [
    ['Name', input.name],
    ['Email', input.email],
    ['Phone', input.phone?.trim() || '—'],
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px">${escapeHtml(label)}</td><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:600">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  const text = [
    'New staff access request',
    '',
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone?.trim() || '—'}`,
    '',
    `Review it in the app under Users — the account stays inactive (unable to`,
    `sign in) until an administrator activates it there.`,
    '',
    textSignOff(input.identity),
  ].join('\n');
  const html = frame(
    `<p style="margin:0 0 12px;font-weight:600">New staff access request</p>
<p style="margin:0 0 16px">Someone has requested a landlord/agent account through the public sign-up form. The account is created <strong>inactive</strong> and cannot sign in until it is activated.</p>
<table style="width:100%;border-collapse:collapse;margin:0 0 16px">${contactRows}</table>
<p style="margin:0;color:#6b7280;font-size:14px">Review and activate it in the app under <strong>Users</strong>.</p>`,
    input.identity,
  );
  return { subject, html, text };
}

// --- Provider self-test -----------------------------------------------------------

export function composeTestEmail(input: { provider: string; live: boolean; identity: IdentityFields }): ComposedEmail {
  const name = input.identity.name?.trim() || 'Property Management';
  return {
    subject: `Test email — ${name} property management system`,
    text: [
      'This is a test email from your property management system.',
      '',
      `If you received it, the email provider (${input.provider}${input.live ? ', live' : ', simulated'}) is configured correctly.`,
      'No action is needed — you can delete this message.',
    ].join('\n'),
    html: frame(
      `<p style="margin:0 0 12px;font-weight:600">This is a test email from your property management system.</p>
<p style="margin:0;color:#6b7280;font-size:14px">If you received it, the email provider (${escapeHtml(input.provider)}${input.live ? ', live' : ', simulated'}) is configured correctly. No action is needed — you can delete this message.</p>`,
      input.identity
    ),
  };
}
