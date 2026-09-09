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
  appName: 'RPMS',
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

// Login-footer details. They stay hidden (not rendered as raw placeholders)
// until the real values are filled in above.
export const businessFooter = {
  address: isTemplate(branding.address) ? null : branding.address,
  phone: isTemplate(branding.contactPhone) ? null : branding.contactPhone,
};

// The company legal name, shown next to the RPMS product name in the app
// footer and on the legal pages — hidden until the real value is filled in.
export const legalNameDisplay: string | null = isTemplate(branding.legalName) ? null : branding.legalName;

// Monogram initials derived from the legal name (e.g. "Acme Properties Ltd"
// → "AP", "Olbano Property Management" → "OP"). Used for the brand tiles in
// the sidebar/login/legal chip and for the generated favicon. Common legal
// suffixes and filler words are ignored; hidden while the name is a
// placeholder.
const NAME_STOP_WORDS = new Set(['ltd', 'limited', 'llc', 'inc', 'co', 'company', 'group', 'holdings', 'the', 'of', 'and', '&']);
export const brandInitials: string | null = (() => {
  if (!legalNameDisplay) return null;
  const words = legalNameDisplay
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}&]/gu, ''))
    .filter((w) => w && !NAME_STOP_WORDS.has(w.toLowerCase()));
  const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return initials || null;
})();

// Brand used in browser-tab titles: "RPMS" alone until the legal name is
// filled in, then "RPMS — Acme Properties Ltd" across the whole app.
export const tabTitleBrand = legalNameDisplay
  ? `${branding.appName} — ${legalNameDisplay}`
  : branding.appName;

// Login-page identity line under the product name: "Operated by <legal name>"
// (same semantics as the app footer) plus "Reg. No. X" once the registration
// number is filled in. Hidden entirely while no legal name exists; missing
// parts never render as bracket placeholders.
export const loginIdentityLine: string | null = legalNameDisplay
  ? [
      `Operated by ${legalNameDisplay}`,
      ...(isTemplate(branding.registrationNumber) ? [] : [`Reg. No. ${branding.registrationNumber}`]),
    ].join(' · ')
  : null;

// Support contacts shown on the 404 page (mailto links) — hidden until the
// real emails are filled in above.
export const supportContacts: { label: string; email: string }[] = [
  ...(isTemplate(branding.contactEmail) ? [] : [{ label: 'Support', email: branding.contactEmail }]),
  ...(isTemplate(branding.privacyEmail) ? [] : [{ label: 'Privacy', email: branding.privacyEmail }]),
];

// Every business/legal field that is still a [placeholder] — surfaced to
// admins as a dismissible banner so nothing silently stays template text.
const PLACEHOLDER_LABELS: { key: keyof typeof branding; label: string }[] = [
  { key: 'legalName', label: 'company legal name' },
  { key: 'registrationNumber', label: 'registration number' },
  { key: 'address', label: 'address' },
  { key: 'contactEmail', label: 'general queries email' },
  { key: 'privacyEmail', label: 'privacy email' },
  { key: 'contactPhone', label: 'phone number' },
  { key: 'retentionPeriod', label: 'record retention period' },
  { key: 'responseDays', label: 'privacy request response days' },
  { key: 'jurisdiction', label: 'governing law jurisdiction' },
  { key: 'propertyScope', label: 'property name/address (refund policy)' },
  { key: 'paymentChannels', label: 'payment channels (refund policy)' },
  { key: 'refundWindowDays', label: 'refund processing window' },
];

export const missingBrandingFields: string[] = PLACEHOLDER_LABELS
  .filter(({ key }) => isTemplate(branding[key] as string))
  .map(({ label }) => label);

// Every identity field with its current value and filled/missing status —
// rendered as the building-plate identity card on the Settings page.
export const brandingFieldStatus: { label: string; value: string; filled: boolean }[] =
  PLACEHOLDER_LABELS.map(({ key, label }) => {
    const value = branding[key] as string;
    return { label, value: isTemplate(value) ? '' : value, filled: !isTemplate(value) };
  });

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
