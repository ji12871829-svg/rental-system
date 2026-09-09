// receiptPdf — builds a real PDF via pdf-lib. Assertions: valid header,
// parseable by pdf-lib itself, one A4 page, non-trivial size.
import { PDFDocument } from 'pdf-lib';
import { receiptPdfBytes } from '../../src/utils/receiptPdf';
import type { ReceiptDocument } from '../../src/utils/receiptDocument';

const receipt: ReceiptDocument = {
  receipt_number: 'RC-2026-0001',
  receipt_type: 'RENT',
  tenant_name: 'Peter Otieno',
  unit_number: '1',
  unit_type: 'Room',
  payment_date: '2026-09-01',
  billing_month: 9,
  billing_year: 2026,
  rent_amount: '9000',
  water_amount: '0',
  total_amount: '9000',
  balance: '0',
  generated_at: '2026-09-08T10:00:00Z',
  currency: 'KSh',
};

describe('receiptPdf', () => {
  it('produces a valid, parseable PDF with the receipt title', async () => {
    const bytes = await receiptPdfBytes(receipt);

    expect(bytes.length).toBeGreaterThan(500);
    // PDF files begin with the %PDF- header.
    const header = Buffer.from(bytes.slice(0, 5)).toString('latin1');
    expect(header).toBe('%PDF-');

    // pdf-lib can re-parse its own output — proves structural validity.
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toContain('RC-2026-0001');
  });

  it('handles non-WinAnsi characters without throwing', async () => {
    const bytes = await receiptPdfBytes({ ...receipt, tenant_name: 'Gráce Njerī ✨' });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});
