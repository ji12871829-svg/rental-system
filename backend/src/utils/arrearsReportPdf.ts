// Arrears report PDF (pdf-lib, pure JS — no headless browser). One landscape
// page listing every tenant with outstanding rent/water balances for the
// reporting year — the same rows the Arrears page shows, sorted by highest
// total outstanding, with year totals and the business identity footer.
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
const GREEN = rgb(0.08, 0.5, 0.28);

/**
 * Exported because financeService.ts references this type via an inline
 * `import('../utils/arrearsReportPdf').ArrearsPdfRow[]` cast — invisible to
 * static import analysis (knip).
 * @public
 */
export interface ArrearsPdfRow {
  unitNumber: string;
  tenantName: string;
  phoneNumber: string | null;
  monthlyRent: number | string;
  rentPaid: number | string;
  rentBalance: number | string;
  waterBalance: number | string;
  totalOutstanding: number | string;
  monthsInArrears: number | string;
  status: string;
}

export interface ArrearsReportData {
  year: number;
  rows: ArrearsPdfRow[];
  generatedAt: string | Date;
}

// Column layout: unit, tenant, phone, monthly rent, rent paid, rent balance,
// water balance, total outstanding, months, status.
const COLS = [
  { key: 'unit', label: 'Unit', w: 46, align: 'left' as const },
  { key: 'tenant', label: 'Tenant', w: 130, align: 'left' as const },
  { key: 'phone', label: 'Phone', w: 90, align: 'left' as const },
  { key: 'monthlyRent', label: 'Monthly Rent', w: 62, align: 'right' as const },
  { key: 'rentPaid', label: 'Rent Paid', w: 62, align: 'right' as const },
  { key: 'rentBalance', label: 'Rent Bal.', w: 62, align: 'right' as const },
  { key: 'waterBalance', label: 'Water Bal.', w: 62, align: 'right' as const },
  { key: 'totalOutstanding', label: 'Total Outst.', w: 66, align: 'right' as const },
  { key: 'monthsInArrears', label: 'Mos.', w: 30, align: 'right' as const },
  { key: 'status', label: 'Status', w: 55, align: 'left' as const },
];
// Statuses that mean money is owed (drives the red highlight).
const OWED = new Set(['UNPAID', 'PARTIAL', 'OVERDUE']);

export async function arrearsReportPdfBytes(
  data: ArrearsReportData,
  identity: BusinessIdentity = { name: null, regNo: null, phone: null, email: null }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([PAGE_W, PAGE_H]);
  doc.setTitle(`Arrears Report ${data.year}`);
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

  // Left x of each column; money columns right-align at their right edge.
  const colX: Record<string, number> = {};
  const colRight: Record<string, number> = {};
  let x = MARGIN;
  for (const c of COLS) {
    colX[c.key] = x;
    colRight[c.key] = x + c.w - 4;
    x += c.w;
  }

  // Text for a cell (money formatting for the money keys).
  const MONEY_KEYS = new Set(['monthlyRent', 'rentPaid', 'rentBalance', 'waterBalance', 'totalOutstanding']);
  const cellText = (r: ArrearsPdfRow, key: string): string => {
    if (key === 'phone') return r.phoneNumber?.trim() || '—';
    if (key === 'monthsInArrears') return String(r.monthsInArrears ?? 0);
    if (MONEY_KEYS.has(key)) return formatMoney(n((r as unknown as Record<string, number | string>)[key]));
    return String((r as unknown as Record<string, unknown>)[key] ?? '');
  };

  // --- Header ---------------------------------------------------------------
  let y = PAGE_H - 52;
  const name = identity.name?.trim() || 'Property Management';
  draw(page, name, { y, size: 16, font: bold });
  y -= 16;
  draw(page, `Arrears Report — ${data.year}`, { y, size: 10, color: MUTED });
  y -= 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 20;

  // --- Table header ------------------------------------------------------------
  for (const c of COLS) {
    const label = c.label;
    if (c.align === 'right') {
      draw(page, label, { x: rightX(page, label, 8, bold, colRight[c.key]), y, size: 8, font: bold, color: MUTED });
    } else {
      draw(page, label, { x: colX[c.key], y, size: 8, font: bold, color: MUTED });
    }
  }
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 16;

  // --- Rows (sorted by total outstanding desc — worst first) ----------------------
  const sorted = [...data.rows].sort((a, b) => n(b.totalOutstanding) - n(a.totalOutstanding));
  for (const r of sorted) {
    const owed = n(r.totalOutstanding) > 0;
    const owedColor = owed ? RED : INK;
    for (const c of COLS) {
      const text = cellText(r, c.key);
      const isMoney = MONEY_KEYS.has(c.key);
      // Balance columns (and the total) turn red when money is owed; cleared
      // rows keep ink.
      const isBalance = c.key === 'rentBalance' || c.key === 'waterBalance' || c.key === 'totalOutstanding';
      const color = isBalance && owed ? owedColor : INK;
      if (c.align === 'right') {
        draw(page, text, {
          x: rightX(page, text, 8.5, c.key === 'totalOutstanding' && owed ? bold : regular, colRight[c.key]),
          y,
          size: 8.5,
          font: c.key === 'totalOutstanding' && owed ? bold : regular,
          color,
        });
      } else {
        draw(page, text, {
          x: colX[c.key],
          y,
          size: 8.5,
          font: c.key === 'unit' || c.key === 'tenant' ? bold : regular,
          color,
        });
      }
    }
    y -= 17;
    // Periodic page continuation: ~24 rows per page then continue on a new one.
    if (y < MARGIN + 60) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - 40;
      for (const c of COLS) {
        const label = c.label;
        if (c.align === 'right') {
          draw(page, label, { x: rightX(page, label, 8, bold, colRight[c.key]), y, size: 8, font: bold, color: MUTED });
        } else {
          draw(page, label, { x: colX[c.key], y, size: 8, font: bold, color: MUTED });
        }
      }
      y -= 16;
    }
  }

  // --- Year totals -----------------------------------------------------------------
  y -= 2;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1.5, color: INK });
  y -= 16;
  draw(page, `Totals — ${data.rows.length} occupied units`, { y, size: 9, font: bold });
  const sum = (key: 'rentBalance' | 'waterBalance' | 'totalOutstanding'): number =>
    data.rows.reduce((s, r) => s + n((r as unknown as Record<string, number | string>)[key]), 0);
  const totals: [string, number][] = [
    ['rentBalance', sum('rentBalance')],
    ['waterBalance', sum('waterBalance')],
    ['totalOutstanding', sum('totalOutstanding')],
  ];
  for (const [key, v] of totals) {
    const t = formatMoney(v);
    draw(page, t, { x: rightX(page, t, 9, bold, colRight[key]), y, size: 9, font: bold, color: v > 0 ? RED : INK });
  }

  // --- Footer ------------------------------------------------------------------------
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
