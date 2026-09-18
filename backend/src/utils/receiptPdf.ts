// Receipt PDF builder (pdf-lib, pure JS — no headless browser). Produces the
// same document the printed/email receipt shows: brand header, receipt
// number, line rows, totals, identity footer from the env-configured
// business details.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

/**
 * Merge complete PDFs into one document (bulk export). Returns a copy —
 * the input byte arrays are untouched.
 */
export async function mergePdfBytes(pdfs: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of pdfs) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
import type { BusinessIdentity } from '../services/brandingService';
import { MONTH_NAMES } from '../types';
import { formatMoney, n } from './money';
import { drawLogo, embedLogo } from './pdfLogo';
import { fmtDate, receiptTypeLabel, type ReceiptDocument } from './receiptDocument';

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

export async function receiptPdfBytes(
  r: ReceiptDocument,
  identity: BusinessIdentity = { name: null, regNo: null, phone: null, email: null, logo: null }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  doc.setTitle(`${r.receipt_number} — ${receiptTypeLabel(r.receipt_type)}`);
  doc.setProducer('RPMS');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = PAGE_W - MARGIN * 2;

  // StandardFonts encode WinAnsi — fall back to ASCII for the rare tenant
  // name with characters outside it instead of throwing on drawText.
  const safe = (text: string, font: PDFFont = regular): string => {
    try {
      font.widthOfTextAtSize(text, 10); // throws for chars the font can't encode
      return text;
    } catch {
      return text.replace(/[^\x20-\x7E]/g, '?');
    }
  };

  const draw = (
    text: string,
    o: { x?: number; y: number; size?: number; font?: PDFFont; color?: typeof INK }
  ) => {
    const font = o.font ?? regular;
    page.drawText(safe(text, font), {
      x: o.x ?? MARGIN,
      y: o.y,
      size: o.size ?? 10,
      font,
      color: o.color ?? INK,
    });
  };

  const rightX = (text: string, size: number, font: PDFFont): number =>
    MARGIN + W - font.widthOfTextAtSize(safe(text, font), size);

  const row = (
    label: string,
    value: string,
    o: { step?: number; boldValue?: boolean; labelColor?: typeof MUTED } = {}
  ) => {
    draw(label, { y: y, size: 10, color: o.labelColor ?? MUTED });
    draw(value, { x: rightX(value, 10, o.boldValue ? bold : regular), y, size: 10, font: o.boldValue ? bold : regular });
    y -= o.step ?? 20;
  };

  const money = (v: string | number): string => formatMoney(n(v), r.currency);

  let y = PAGE_H - 56;

  // --- Header ------------------------------------------------------------
  // Logo sits left of the business name, top-aligned with it.
  const logo = await embedLogo(doc, identity);
  const nameX = drawLogo(page, logo, {
    x: MARGIN,
    topY: y + 12, // matches the 18pt text's visual top
    height: 34,
    pageWidth: PAGE_W,
    rightLimit: MARGIN + W - bold.widthOfTextAtSize(safe(identity.name?.trim() || 'Property Management', bold), 18) - 10,
  });
  draw(identity.name?.trim() || 'Property Management', { x: nameX, y, size: 18, font: bold });
  y -= 18;
  draw(receiptTypeLabel(r.receipt_type), { y, size: 9, color: MUTED });
  y -= 24;
  draw(r.receipt_number, { y, size: 22, font: bold });
  y -= 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 28;

  // --- Receipt details ----------------------------------------------------
  row('Tenant', r.tenant_name);
  row('Unit', `${r.unit_number}${r.unit_type ? ` (${r.unit_type})` : ''}`);
  row('Billing period', `${MONTH_NAMES[r.billing_month - 1]} ${r.billing_year}`);
  row('Payment date', fmtDate(r.payment_date));

  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 24;

  // --- Amounts -------------------------------------------------------------
  if (n(r.rent_amount) > 0) row('Rent paid', money(r.rent_amount));
  if (n(r.water_amount) > 0) row('Water paid', money(r.water_amount));

  page.drawLine({ start: { x: MARGIN, y: y + 14 }, end: { x: MARGIN + W, y: y + 14 }, thickness: 1.5, color: INK });
  row('Total paid', money(r.total_amount), { boldValue: true, step: 24 });
  row('Balance after payment', money(r.balance));

  // --- Footer ---------------------------------------------------------------
  y -= 16;
  draw(
    `Generated ${fmtDate(r.generated_at ?? new Date())} — this receipt is proof of payment. Thank you.`,
    { y, size: 9, color: MUTED }
  );

  const name = identity.name?.trim() ?? '';
  if (name) {
    const regNo = identity.regNo?.trim() ?? '';
    const identityLine = `${name}${regNo ? ` · Reg. No. ${regNo}` : ''}`;
    y -= 16;
    draw(identityLine, { y, size: 9, color: MUTED });
    const contact = [identity.phone?.trim() ?? '', identity.email?.trim() ?? ''].filter(Boolean).join(' · ');
    if (contact) {
      y -= 14;
      draw(contact, { y, size: 9, color: MUTED });
    }
  }

  return doc.save();
}
