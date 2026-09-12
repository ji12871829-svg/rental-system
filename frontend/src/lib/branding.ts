// Single source of truth for the business identity shown in the UI chrome,
// printed receipts and the legal pages. Fill in the operator's real details
// here ONCE — every surface updates. Note: index.html (title + meta
// description) and public/favicon.svg are static files and must be updated
// alongside this one.
//
// The remaining bracketed values (registration number and contact details)
// are still template placeholders — they are never invented; fill them in
// with the real details when available.
export const branding = {
  // --- Product name (sidebar, login, page titles, banner, receipts) ------
  appName: 'Olbano Plaza',
  // Short form used as a heading where space is tight (login, printed receipt).
  appNameLong: 'Olbano Property Management',
  // Full form used in the footer tagline.
  appNameFull: 'Olbano Property Management System',

  // --- Legal identity -------------------------------------------------------
  // Reg. no. and contact details stay template text until the real values
  // arrive — they are never invented.
  legalName: 'Olbano Property Management',
  registrationNumber: '[registration number]',
  address: '123 Riverside Drive, Nairobi, Kenya',
  // General queries — printed receipts, refund/payment queries.
  contactEmail: '[general queries email]',
  // Privacy questions and data-subject requests (Privacy Policy).
  privacyEmail: '[privacy contact email]',
  contactPhone: '[phone]',

  // --- Legal page details --------------------------------------------------
  // The SMS provider configured in backend/.env (SMS_PROVIDER).
  smsProviderName: "Africa's Talking",
  // How long financial records are kept (accounting/tax requirement).
  retentionPeriod: '7 years',
  // Days to respond to a data access/correction/deletion request.
  responseDays: '30',
  // Governing law for the Terms & Conditions.
  jurisdiction: 'Kenya',
  // Property the refund policy covers.
  propertyScope: 'Olbano Apartments, 123 Riverside Drive, Nairobi',
  // Ways tenants pay (shown in the refund policy).
  paymentChannels: 'M-Pesa, cash or bank transfer',
  // Days to process a verified refund.
  refundWindowDays: '7–14',
};

const isTemplate = (v: string) => v.trim().startsWith('[');

// Brand used in browser-tab titles is composed in BrandingContext.tsx from
// the live identity ("App — Legal Name"), as are the login identity line and
// the 404-page support contacts.

// Every business/legal field that is still a [placeholder] is surfaced to
// admins by BrandingContext (derived live from the /api/branding response),
// not from these build-time helpers.

// Printed-receipt identity footer: line 1 = legal name · Reg. No.,
// line 2 = address · phone · email. Each part stays hidden until the real
// value is filled in above; empty lines are dropped. Values are escaped and
// phone/email become tel:/mailto: links so they stay clickable in PDF-saved
// receipts. Entries are HTML strings — the receipt template joins them.
const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const text = (v: string): string | null => (isTemplate(v) ? null : esc(v));

const linkPhone = (v: string): string | null =>
  isTemplate(v) ? null : `<a href="tel:${v.replace(/[^+\d]/g, '')}">${esc(v)}</a>`;

const linkEmail = (v: string): string | null =>
  isTemplate(v) ? null : `<a href="mailto:${v.replace(/[\s"'<>]/g, '')}">${esc(v)}</a>`;

const receiptIdentityLine =
  [text(branding.legalName), text(branding.registrationNumber) ? `Reg. No. ${esc(branding.registrationNumber)}` : null]
    .filter((s): s is string => s !== null)
    .join(' · ');

const receiptContactLine =
  [text(branding.address), linkPhone(branding.contactPhone), linkEmail(branding.contactEmail)]
    .filter((s): s is string => s !== null)
    .join(' · ');

export const receiptFooterLines: string[] = [receiptIdentityLine, receiptContactLine].filter((l) => l !== '');
