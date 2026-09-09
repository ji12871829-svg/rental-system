// receiptDocument — pure builders for the emailed receipt (no DB).
// BUSINESS_NAME etc. come from backend/.env via env.ts (module load).
import {
  escapeHtml,
  receiptEmailHtml,
  receiptSubject,
  receiptText,
  receiptTypeLabel,
  type ReceiptDocument,
} from '../../src/utils/receiptDocument';

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

describe('receiptDocument', () => {
  it('labels and subjects receipts correctly', () => {
    expect(receiptTypeLabel('RENT')).toBe('RENT RECEIPT');
    expect(receiptTypeLabel('WATER')).toBe('WATER RECEIPT');
    expect(receiptTypeLabel('COMBINED')).toBe('COMBINED RECEIPT (RENT + WATER)');
    expect(receiptSubject(receipt)).toBe('Receipt RC-2026-0001 — September 2026');
  });

  it('escapes HTML in every dynamic value (tenant names are user input)', () => {
    const html = receiptEmailHtml({ ...receipt, tenant_name: '<script>alert("x")</script> & Co' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; Co');
  });

  it('omits zero-amount rows and includes the money lines', () => {
    const html = receiptEmailHtml(receipt);
    expect(html).toContain('Rent paid');
    expect(html).toContain('KSh 9,000');
    expect(html).not.toContain('Water paid'); // water_amount = 0
    expect(html).toContain('Balance after payment');
  });

  it('keeps the plain-text version free of markup', () => {
    const text = receiptText(receipt);
    expect(text).toContain('RENT RECEIPT');
    expect(text).toContain('Receipt: RC-2026-0001');
    expect(text).toContain('Tenant: Peter Otieno (Unit 1)');
    expect(text).toContain('Total paid: KSh 9,000');
    expect(text).toContain('This receipt is proof of payment.');
    expect(text).not.toMatch(/[<>]/);
  });

  it('renders the DB-backed identity footer when one is provided', () => {
    const identity = { name: 'Acme Properties Ltd', regNo: 'C.123456', phone: '+254 700 000 000', email: 'info@acme.test' };
    const html = receiptEmailHtml(receipt, identity);
    expect(html).toContain('Acme Properties Ltd');
    expect(html).toContain('Reg. No. C.123456');
    expect(html).toContain('+254 700 000 000');
    expect(html).toContain('info@acme.test');
    // Plain-text fallback gets the same identity.
    const text = receiptText(receipt, identity);
    expect(text).toContain('Acme Properties Ltd, Reg. No. C.123456.');
    expect(text).toContain('+254 700 000 000 | info@acme.test');
  });

  it('omits the identity footer when no identity is provided', () => {
    const html = receiptEmailHtml(receipt);
    expect(html).toContain('Property Management'); // neutral fallback title
    expect(html).not.toContain('Reg. No.');
    const text = receiptText(receipt);
    expect(text).not.toContain('Reg. No.');
  });
});
