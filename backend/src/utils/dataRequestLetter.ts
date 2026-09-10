// Server-side rendering of the data-request response letter as EMAIL HTML
// (inline styles — email clients strip <style> blocks). The same letter the
// frontend previews/prints, formatted for an email body; the machine-readable
// data file rides along as the attachment.
import type { DataRequestLetter } from '../services/privacyService';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (value: number): string =>
  `KSh ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** The JSON enclosure filename — shared by the route, the email and the UI. */
export function dataEnclosureName(tenantId: number): string {
  return `tenant-${tenantId}-personal-data.json`;
}

export interface DataLetterEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderDataLetterEmail(letter: DataRequestLetter): DataLetterEmail {
  const { branding, bundle, summary, registerRef, generatedAt, responseDays } = letter;
  const subject = bundle.subject as Record<string, unknown>;
  const name = String(subject.full_name ?? 'the data subject');
  const privacyContact = branding.privacy_email ?? branding.contact_email ?? null;
  const deadline = responseDays ?? '30';

  const summaryRows: [string, number, string | null][] = [
    ['Rent payments', summary.rentPayments.count, money(summary.rentPayments.total)],
    ['Water payments', summary.waterPayments.count, money(summary.waterPayments.total)],
    ['Water meter readings', summary.waterReadings.count, money(summary.waterReadings.total)],
    ['Receipts issued', summary.receipts.count, money(summary.receipts.total)],
    ['SMS messages sent', summary.smsNotifications.count, null],
    ['Audit trail entries', summary.auditTrail.count, null],
  ];

  const td = 'padding:6px 10px;border:1px solid #e5e7eb;font-size:13px;vertical-align:top;';
  const th = `${td}background:#f3f4f6;text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:0.03em;`;

  const html = `
<div style="max-width:640px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;color:#111827;font-size:14px;line-height:1.55;">
  <div style="border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:20px;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-size:16px;font-weight:700;">${esc(branding.legal_name ?? 'the operator')}</div>
    <div style="color:#6b7280;font-size:12px;margin-top:3px;">
      ${[branding.address, branding.contact_phone, branding.contact_email].filter(Boolean).map(esc).join(' &middot; ')}
      ${branding.privacy_email ? `<div>Privacy contact: ${esc(branding.privacy_email)}</div>` : ''}
    </div>
  </div>

  <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;"><strong>Response to your personal-data request</strong></p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:12.5px;font-family:Arial,Helvetica,sans-serif;">Our ref: ${esc(registerRef)} &middot; Dated ${esc(fmtDate(generatedAt))}</p>

  <p>Dear ${esc(name)},</p>

  <p>We refer to your request for access to the personal data we hold about you. This email contains our
  formal response together with a machine-readable copy of the data (<strong>${esc(dataEnclosureName(Number(subject.id ?? 0)))}</strong>)
  attached. Our formal response letter is also attached as a printable PDF for your records.</p>

  <p>This response is provided under the Data Protection Act, 2019 (Kenya) and, where applicable, the General
  Data Protection Regulation (EU) 2016/679. Data-subject requests are answered within ${esc(deadline)} days of
  receipt, as stated in our Privacy Policy.</p>

  <p style="margin:16px 0 6px;font-family:Arial,Helvetica,sans-serif;font-weight:700;">Summary of the data provided</p>
  <table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif;">
    <thead><tr><th style="${th}">Category</th><th style="${th}">Records</th><th style="${th}">Total</th></tr></thead>
    <tbody>
      ${summaryRows
        .map(
          ([label, count, total]) =>
            `<tr><td style="${td}">${esc(label)}</td><td style="${td}">${count}</td><td style="${td}">${total ?? '—'}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>

  <p style="margin-top:14px;color:#6b7280;font-size:12.5px;">${esc(String(bundle.retentionNote))}</p>

  <p>If you believe any data is inaccurate, or you wish to exercise any other data-subject right, please contact
  ${privacyContact ? `<a href="mailto:${esc(privacyContact)}" style="color:#2563eb;">${esc(privacyContact)}</a>` : 'the property office'}.</p>

  <p style="margin-top:26px;">Yours faithfully,<br><span style="color:#6b7280;font-size:12.5px;">For and on behalf of ${esc(branding.legal_name ?? 'the operator')}</span></p>
</div>`;

  const text = [
    `Dear ${name},`,
    '',
    'We refer to your request for access to the personal data we hold about you.',
    'The complete machine-readable copy of the data is attached to this email',
    `(${dataEnclosureName(Number(subject.id ?? 0))}).`,
    '',
    `Our reference: ${registerRef}`,
    `Summary: rent payments ${summary.rentPayments.count}, water payments ${summary.waterPayments.count},`,
    `receipts ${summary.receipts.count}, SMS messages ${summary.smsNotifications.count}.`,
    '',
    'This response is provided under the Data Protection Act, 2019 (Kenya) and, where',
    'applicable, the General Data Protection Regulation (EU) 2016/679.',
    privacyContact ? `Contact: ${privacyContact}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: `Response to your personal-data request — ref ${registerRef}`, html, text };
}

// ---------------------------------------------------------------------------
// Printable PDF rendering of the same letter (pdf-lib, pure JS). Emailed
// responses attach this as the formal document alongside the JSON data file,
// so the tenant receives a professional letter — not just an HTML email body.
// ---------------------------------------------------------------------------

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 56;
const TEXT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

export function dataLetterPdfName(registerRef: string): string {
  return `data-request-response-${registerRef}.pdf`;
}

export async function renderDataLetterPdf(letter: DataRequestLetter): Promise<Uint8Array> {
  const { branding, summary, registerRef, generatedAt, responseDays } = letter;
  const subject = letter.bundle.subject as Record<string, unknown>;
  const name = String(subject.full_name ?? 'the data subject');
  const privacyContact = branding.privacy_email ?? branding.contact_email ?? null;
  const deadline = responseDays ?? '30';

  const doc = await PDFDocument.create();
  let page = doc.addPage([PAGE_W, PAGE_H]);
  doc.setTitle(`Response to your personal-data request — ref ${registerRef}`);
  doc.setProducer('RPMS');

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);

  // StandardFonts encode WinAnsi — degrade unknown chars instead of throwing.
  const safe = (text: string, font: PDFFont): string => {
    try {
      font.widthOfTextAtSize(text, 10);
      return text;
    } catch {
      return text.replace(/[^\x20-\x7E]/g, '?');
    }
  };

  let y = PAGE_H - MARGIN;

  const draw = (
    text: string,
    o: { x?: number; y?: number; size?: number; font?: PDFFont; color?: typeof INK }
  ) => {
    const font = o.font ?? serif;
    page.drawText(safe(text, font), {
      x: o.x ?? MARGIN,
      y: o.y ?? y,
      size: o.size ?? 10.5,
      font,
      color: o.color ?? INK,
    });
  };

  // Word-wrapping paragraph in the given font/size; returns updated y.
  const paragraph = (text: string, opts: { size?: number; font?: PDFFont; color?: typeof INK; gap?: number } = {}): number => {
    const font = opts.font ?? serif;
    const size = opts.size ?? 10.5;
    const words = safe(text, font).split(/\s+/);
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > TEXT_W && line) {
        draw(line, { size, font, color: opts.color });
        y -= size * 1.45;
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) {
      draw(line, { size, font, color: opts.color });
      y -= size * 1.45;
    }
    return y - (opts.gap ?? 0);
  };

  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN + 40) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // --- Letterhead -----------------------------------------------------------
  const legalName = branding.legal_name ?? 'the operator';
  draw(safe(legalName, sansBold), { size: 15, font: sansBold });
  y -= 18;
  const letterheadBits = [branding.address, branding.contact_phone, branding.contact_email]
    .filter(Boolean)
    .map((v) => String(v))
    .join('  ·  ');
  if (letterheadBits) paragraph(letterheadBits, { size: 8.5, font: sans, color: MUTED, gap: 2 });
  if (branding.privacy_email) paragraph(`Privacy contact: ${branding.privacy_email}`, { size: 8.5, font: sans, color: MUTED, gap: 2 });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: INK });
  y -= 22;

  // --- Reference block ---------------------------------------------------------
  draw('Response to your personal-data request', { size: 11, font: sansBold });
  y -= 16;
  paragraph(`Our ref: ${registerRef}  ·  Dated ${fmtDate(generatedAt)}`, { size: 9, font: sans, color: MUTED, gap: 14 });

  // --- Body --------------------------------------------------------------------
  paragraph(`Dear ${name},`, { gap: 6 });
  paragraph(
    `We refer to your request for access to the personal data we hold about you. This letter is our formal ` +
      `response, and the complete machine-readable copy of the data accompanies it as a separate file ` +
      `(${dataEnclosureName(Number(subject.id ?? 0))}).`,
    { gap: 10 }
  );
  paragraph(
    `This response is provided under the Data Protection Act, 2019 (Kenya) and, where applicable, the General ` +
      `Data Protection Regulation (EU) 2016/679. Data-subject requests are answered within ${deadline} days of ` +
      `receipt, as stated in our Privacy Policy.`,
    { gap: 14 }
  );

  // --- Summary table --------------------------------------------------------------
  ensureSpace(180);
  draw('Summary of the data provided', { size: 10, font: sansBold });
  y -= 14;

  const rows: [string, number, string | null][] = [
    ['Rent payments', summary.rentPayments.count, summary.rentPayments.total ? money(summary.rentPayments.total) : null],
    ['Water payments', summary.waterPayments.count, summary.waterPayments.total ? money(summary.waterPayments.total) : null],
    ['Water meter readings', summary.waterReadings.count, summary.waterReadings.total ? money(summary.waterReadings.total) : null],
    ['Receipts issued', summary.receipts.count, summary.receipts.total ? money(summary.receipts.total) : null],
    ['SMS messages sent', summary.smsNotifications.count, null],
    ['Audit trail entries', summary.auditTrail.count, null],
  ];
  const colX = [MARGIN, MARGIN + 260, MARGIN + 360];
  draw('Category', { x: colX[0] + 8, size: 8, font: sansBold, color: MUTED });
  draw('Records', { x: colX[1] + 8, size: 8, font: sansBold, color: MUTED });
  draw('Total', { x: colX[2] + 8, size: 8, font: sansBold, color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: RULE });
  y -= 15;
  for (const [label, count, total] of rows) {
    ensureSpace(30);
    draw(label, { x: colX[0] + 8, size: 9.5, font: sans });
    draw(String(count), { x: colX[1] + 8, size: 9.5, font: sans });
    draw(total ?? '—', { x: colX[2] + 8, size: 9.5, font: sans });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: RULE });
    y -= 12;
  }

  // --- Retention + contact -----------------------------------------------------------
  paragraph(String(letter.bundle.retentionNote ?? ''), { size: 9, color: MUTED, gap: 10 });
  paragraph(
    privacyContact
      ? `If you believe any data is inaccurate, or you wish to exercise any other data-subject right, please contact ${privacyContact}.`
      : 'If you believe any data is inaccurate, or you wish to exercise any other data-subject right, please contact the property office.',
    { gap: 22 }
  );

  // --- Signature ------------------------------------------------------------------------
  ensureSpace(80);
  paragraph('Yours faithfully,', { gap: 26 });
  draw(safe(`For and on behalf of ${legalName}`, sans), { size: 9, color: MUTED });
  y -= 14;
  draw(safe(`Enclosure: ${dataEnclosureName(Number(subject.id ?? 0))} (machine-readable data file)`, sans), {
    size: 8.5,
    color: MUTED,
  });

  return doc.save();
}
