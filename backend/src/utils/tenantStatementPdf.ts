// Per-tenant yearly statement PDF (pdf-lib, pure JS — no headless browser).
// One portrait page per tenant-year: the same month rows the Tenant Ledger
// page shows — expected rent, water readings/bill, payments, balances, status
// — with year totals and the business identity footer, so the document the
// tenant receives matches what the app displays.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { BusinessIdentity } from '../services/brandingService';
import { formatMoney } from './money';
import { fmtDate } from './receiptDocument';

// A4 portrait in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;

const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);
const RED = rgb(0.72, 0.11, 0.11);
const GREEN = rgb(0.08, 0.5, 0.28);

// Table geometry: 13 columns across the usable width.
const COL_W = {
  month: 52,
  unit: 32,
  expRent: 52,
  prev: 34,
  curr: 34,
  cons: 34,
  waterBill: 52,
  rentPaid: 52,
  waterPaid: 52,
  totalPaid: 52,
  rentBal: 44,
  waterBal: 44,
  totalBal: 49,
} as const;
type ColKey = keyof typeof COL_W;
const MONEY_KEYS: ColKey[] = ['expRent', 'prev', 'curr', 'cons', 'waterBill', 'rentPaid', 'waterPaid', 'totalPaid', 'rentBal', 'waterBal', 'totalBal'];
const BALANCE_KEYS = new Set<ColKey>(['rentBal', 'waterBal', 'totalBal']);

// X of the RIGHT edge of each column (money cells are right-aligned).
const COL_RIGHT: Record<ColKey, number> = (() => {
  const out = {} as Record<ColKey, number>;
  let x = MARGIN;
  for (const [k, w] of Object.entries(COL_W)) {
    x += w;
    out[k as ColKey] = x - 4;
  }
  return out;
})();

const HEADERS: Record<ColKey, string> = {
  month: 'Month',
  unit: 'Unit',
  expRent: 'Expected Rent',
  prev: 'W. Prev',
  curr: 'W. Curr',
  cons: 'Cons.',
  waterBill: 'Water Bill',
  rentPaid: 'Rent Paid',
  waterPaid: 'Water Paid',
  totalPaid: 'Total Paid',
  rentBal: 'Rent Bal.',
  waterBal: 'Water Bal.',
  totalBal: 'Total Bal.',
};

interface StatementPdfMonthRow {
  month: number;
  monthName: string;
  unit: string | null;
  expectedRent: number;
  previousWaterReading: number | null;
  currentWaterReading: number | null;
  waterConsumed: number;
  waterBill: number;
  rentPaid: number;
  waterPaid: number;
  totalPaid: number;
  rentBalance: number;
  waterBalance: number;
  totalBalance: number;
  status: string;
}

export interface StatementPdfData {
  tenantName: string;
  tenantPhone: string | null;
  unitLabel: string | null;
  year: number;
  currency: string;
  months: StatementPdfMonthRow[];
  totals: {
    rentPaid: number; waterPaid: number; totalPaid: number;
    rentBalance: number; waterBalance: number; totalBalance: number;
  };
  generatedAt: string | Date;
}

export async function tenantStatementPdfBytes(
  data: StatementPdfData,
  identity: BusinessIdentity = { name: null, regNo: null, phone: null, email: null }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  doc.setTitle(`Tenant Statement ${data.year} — ${data.tenantName}`);
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

  const rightX = (text: string, size: number, font: PDFFont, xRight: number): number =>
    xRight - font.widthOfTextAtSize(safe(text, font), size);

  // Right-aligned money cell; balance columns turn red when owed.
  const money = (v: number, key: ColKey, size = 7.5, font: PDFFont = regular) => {
    const color = BALANCE_KEYS.has(key) && v > 0 ? RED : INK;
    const t = formatMoney(v);
    draw(t, { x: rightX(t, size, font, COL_RIGHT[key]), y, size, font, color });
  };
  // Right-aligned integer cell (readings); em-dash when unknown.
  const intCell = (v: number | null, key: ColKey) => {
    const t = v === null ? '—' : String(v);
    draw(t, { x: rightX(t, 7.5, regular, COL_RIGHT[key]), y, size: 7.5, color: v === null ? MUTED : INK });
  };

  let y = PAGE_H - 52;

  // --- Header -----------------------------------------------------------------
  const name = identity.name?.trim() || 'Property Management';
  draw(name, { y, size: 16, font: bold });
  y -= 15;
  draw(`Tenant Statement — ${data.tenantName} — ${data.year}`, { y, size: 10, color: MUTED });
  y -= 7;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 16;

  const metaBits = [
    data.tenantPhone?.trim() ? `Tel ${data.tenantPhone.trim()}` : null,
    data.unitLabel ? `Unit ${data.unitLabel}` : null,
    `Currency ${data.currency}`,
  ].filter(Boolean) as string[];
  draw(metaBits.join('  ·  '), { y, size: 9, color: MUTED });
  y -= 20;

  // --- Table header -------------------------------------------------------------
  (Object.keys(COL_W) as ColKey[]).forEach((key) => {
    const header = HEADERS[key];
    if (MONEY_KEYS.includes(key)) {
      draw(header, { x: rightX(header, 6.5, bold, COL_RIGHT[key]), y, size: 6.5, font: bold, color: MUTED });
    } else {
      const left = key === 'unit' ? MARGIN + COL_W.month : MARGIN;
      draw(header, { x: left + 2, y, size: 6.5, font: bold, color: MUTED });
    }
  });
  y -= 5;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1, color: RULE });
  y -= 14;

  // --- Month rows -----------------------------------------------------------------
  for (const r of data.months) {
    draw(r.monthName, { y, size: 7.5, font: bold });
    draw(r.unit ?? '—', { x: MARGIN + COL_W.month + 2, y, size: 7.5 });

    money(r.expectedRent, 'expRent');
    intCell(r.previousWaterReading, 'prev');
    intCell(r.currentWaterReading, 'curr');
    intCell(r.waterConsumed || null, 'cons');
    money(r.waterBill, 'waterBill');
    money(r.rentPaid, 'rentPaid');
    money(r.waterPaid, 'waterPaid');
    money(r.totalPaid, 'totalPaid');
    money(r.rentBalance, 'rentBal');
    money(r.waterBalance, 'waterBal');
    money(r.totalBalance, 'totalBal');
    y -= 15;
  }

  // --- Year totals ------------------------------------------------------------------
  y -= 1;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + W, y }, thickness: 1.5, color: INK });
  y -= 15;
  draw(`Year ${data.year}`, { y, size: 8.5, font: bold });
  money(data.months.reduce((s, r) => s + r.expectedRent, 0), 'expRent', 8, bold);
  money(data.months.reduce((s, r) => s + r.waterBill, 0), 'waterBill', 8, bold);
  money(data.totals.rentPaid, 'rentPaid', 8, bold);
  money(data.totals.waterPaid, 'waterPaid', 8, bold);
  money(data.totals.totalPaid, 'totalPaid', 8, bold);
  money(data.totals.rentBalance, 'rentBal', 8, bold);
  money(data.totals.waterBalance, 'waterBal', 8, bold);
  money(data.totals.totalBalance, 'totalBal', 8, bold);

  // --- Closing balance callout ---------------------------------------------------------
  y -= 26;
  const closing = data.totals.totalBalance;
  const closingText = closing > 0
    ? `Closing balance: ${formatMoney(closing)} ${data.currency} outstanding for ${data.year}.`
    : closing === 0
      ? `All charges for ${data.year} are settled — closing balance ${formatMoney(0)} ${data.currency}.`
      : `Closing balance: ${formatMoney(closing)} ${data.currency} (credit) for ${data.year}.`;
  draw(closingText, { y, size: 10, font: bold, color: closing > 0 ? RED : GREEN });
  y -= 16;

  // --- Footer -----------------------------------------------------------------------
  draw(`Generated ${fmtDate(data.generatedAt)} — figures cover recorded transactions only.`, {
    y, size: 8, color: MUTED,
  });
  const regNo = identity.regNo?.trim() ?? '';
  if (name !== 'Property Management') {
    const identityLine = `${name}${regNo ? ` · Reg. No. ${regNo}` : ''}`;
    y -= 13;
    draw(identityLine, { y, size: 8, color: MUTED });
    const contact = [identity.phone?.trim() ?? '', identity.email?.trim() ?? ''].filter(Boolean).join(' · ');
    if (contact) {
      y -= 12;
      draw(contact, { y, size: 8, color: MUTED });
    }
  }

  return doc.save();
}
