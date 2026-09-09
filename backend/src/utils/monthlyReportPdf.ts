// Monthly financial report PDF (pdf-lib, pure JS — no headless browser).
// One landscape page per year: the same rows the Monthly Summary page shows —
// rent expected/collected/outstanding, water billed/collected/outstanding,
// totals and collection % — with a year-total row and the business identity
// footer, so the document matches what the app displays.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { BusinessIdentity } from '../services/brandingService';
import { formatMoney, n } from './money';
import { fmtDate } from './receiptDocument';

// A4 landscape in points.
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 46;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const RED = rgb(0.72, 0.11, 0.11);

export interface MonthlyReportPdfRow {
  month: number;
  monthName: string;
  expectedRent: number | string;
  rentCollected: number | string;
  rentOutstanding: number | string;
  waterBilled: number | string;
  waterCollected: number | string;
  waterOutstanding: number | string;
  totalDue: number | string;
  totalCollected: number | string;
  totalOutstanding: number | string;
  collectionPercentage: number | string;
}

export interface MonthlyReportData {
  year: number;
  rows: MonthlyReportPdfRow[];
  generatedAt: string | Date;
}

// Table geometry: month label, nine money columns, collection %.
const MONTH_W = 76;
const COL_W = 70;
const MONEY_COLS = [
  'expectedRent',
  'rentCollected',
  'rentOutstanding',
  'waterBilled',
  'waterCollected',
  'waterOutstanding',
  'totalDue',
  'totalCollected',
  'totalOutstanding',
] as const;

const HEADERS: Record<(typeof MONEY_COLS)[number], string> = {
  expectedRent: 'Expected Rent',
  rentCollected: 'Rent Collected',
  rentOutstanding: 'Rent Outst.',
  waterBilled: 'Water Billed',
  waterCollected: 'Water Collected',
  waterOutstanding: 'Water Outst.',
  totalDue: 'Total Due',
  totalCollected: 'Total Collected',
  totalOutstanding: 'Total Outst.',
};

const OUTSTANDING_KEYS = new Set(['rentOutstanding', 'waterOutstanding', 'totalOutstanding']);

export async function monthlyReportPdfBytes(
  data: MonthlyReportData,
  identity: BusinessIdentity = { name: null, regNo: null, phone: null, email: null }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  doc.setTitle(`Monthly Financial Report ${data.year}`);
  doc.setProducer('RPMS');

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = PAGE_W - MARGIN * 2;

  // StandardFonts encode WinAnsi — degrade unknown chars instead of throwing.
  const safe = (text: string, font: PDFFont = regular): string => {
    try {
      font.widthOfTextAtSize(text, 10);
      return text;
    } catch {
      return text.replace(/[^\x20-\x7E]/g, '?');
    }
  };

  const draw = (
    page: PDFPage,
    text: string,
    o: { x?: number; y: number; size?: number; font?: PDFFont; color?: typeof INK }
  ) => {
    const font = o.font ?? regular;
    page.drawText(safe(text, font), {
      x: o.x ?? MARGIN,
      y: o.y,
      size: o.size ?? 9,
      font,
      color: o.color ?? INK,
    });
  };

  const rightX = (page: PDFPage, text: string, size: number, font: PDFFont, xRight: number): number =>
    xRight - font.widthOfTextAtSize(safe(text, font), size);

  const moneyColX = (i: number): number => MARGIN + MONTH_W + COL_W * (i + 1) - 8;
  const pctX = MARGIN + W - 6;

  const cell = (
    page: PDFPage,
    key: (typeof MONEY_COLS)[number],
    value: number | string,
    y: number,
    font: PDFFont = regular
  ) => {
    const text = formatMoney(n(value));
    const i = MONEY_COLS.indexOf(key);
    const color = OUTSTANDING_KEYS.has(key) && n(value) > 0 ? RED : INK;
    draw(page, text, { x: rightX(page, text, 8.5, font, moneyColX(i)), y, size: 8.5, font, color });
  };

  let y = PAGE_H - 52;

  // --- Header ---------------------------------------------------------------
  const name = identity.name?.trim() || 'Property Management';
  draw(page, name, { y, size: 16, font: bold });
  y -= 16;
  draw(page, `Monthly Financial Report — ${data.year}`, { y, size: 10, color: MUTED });
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 22;

  // --- Table header -----------------------------------------------------------
  draw(page, 'Month', { y, size: 8.5, font: bold, color: MUTED });
  MONEY_COLS.forEach((key, i) => {
    const label = HEADERS[key];
    draw(page, label, { x: rightX(page, label, 8, bold, moneyColX(i)), y, size: 8, font: bold, color: MUTED });
  });
  draw(page, 'Coll. %', { x: rightX(page, 'Coll. %', 8, bold, pctX), y, size: 8, font: bold, color: MUTED });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 16;

  // --- Monthly rows -------------------------------------------------------------
  const totals = MONEY_COLS.reduce(
    (acc, key) => ({ ...acc, [key]: data.rows.reduce((s, r) => s + n(r[key]), 0) }),
    {} as Record<(typeof MONEY_COLS)[number], number>
  );

  for (const r of data.rows) {
    draw(page, r.monthName ?? `Month ${r.month}`, { y, size: 8.5, font: bold });
    MONEY_COLS.forEach((key) => cell(page, key, r[key], y));
    const pct = `${n(r.collectionPercentage).toLocaleString('en-KE', { maximumFractionDigits: 1 })}%`;
    draw(page, pct, { x: rightX(page, pct, 8.5, regular, pctX), y, size: 8.5 });
    y -= 18;
  }

  // --- Year totals -----------------------------------------------------------
  y -= 2;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1.5, color: INK });
  y -= 16;
  draw(page, `Year ${data.year}`, { y, size: 9, font: bold });
  MONEY_COLS.forEach((key) => cell(page, key, totals[key], y, bold));
  const yearPct = totals.expectedRent + totals.waterBilled > 0
    ? `${((totals.totalCollected / (totals.expectedRent + totals.waterBilled)) * 100).toLocaleString('en-KE', { maximumFractionDigits: 1 })}%`
    : '—';
  draw(page, yearPct, { x: rightX(page, yearPct, 9, bold, pctX), y, size: 9, font: bold });

  // --- Footer ------------------------------------------------------------------
  y -= 28;
  draw(page, `Generated ${fmtDate(data.generatedAt)} — figures cover recorded transactions only.`, {
    y,
    size: 8,
    color: MUTED,
  });
  const regNo = identity.regNo?.trim() ?? '';
  if (name !== 'Property Management') {
    const identityLine = `${name}${regNo ? ` · Reg. No. ${regNo}` : ''}`;
    y -= 13;
    draw(page, identityLine, { y, size: 8, color: MUTED });
    const contact = [identity.phone?.trim() ?? '', identity.email?.trim() ?? ''].filter(Boolean).join(' · ');
    if (contact) {
      y -= 12;
      draw(page, contact, { y, size: 8, color: MUTED });
    }
  }

  return doc.save();
}
