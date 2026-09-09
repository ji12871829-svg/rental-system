import {
  combinedReceiptMessage,
  rentReceiptMessage,
  waterReceiptMessage,
} from '../../src/utils/businessRules';

describe('SMS templates (spec §34)', () => {
  it('builds a rent receipt message matching the spec example', () => {
    const msg = rentReceiptMessage({
      tenantName: 'John',
      unitNumber: '15',
      monthName: 'September',
      year: 2026,
      rentPaid: 9000,
      balance: 0,
      receiptNumber: 'RC-2026-0001',
      currency: 'KSh',
    });
    expect(msg).toBe(
      'RENT RECEIPT: Dear John, KSh 9000 received for Unit 15, September 2026 rent. Balance: KSh 0. Receipt: RC-2026-0001. Thank you.'
    );
  });

  it('mentions the outstanding balance when a partial payment is made', () => {
    const msg = rentReceiptMessage({
      tenantName: 'John',
      unitNumber: '15',
      monthName: 'September',
      year: 2026,
      rentPaid: 4000,
      balance: 5000,
      receiptNumber: 'RC-2026-0001',
      currency: 'KSh',
    });
    expect(msg).toContain('Outstanding balance: KSh 5000');
  });

  it('builds a combined rent + water receipt message', () => {
    const msg = combinedReceiptMessage({
      tenantName: 'John',
      unitNumber: '15',
      monthName: 'September',
      year: 2026,
      rentPaid: 9000,
      waterPaid: 1600,
      totalPaid: 10600,
      balance: 0,
      receiptNumber: 'RWC-2026-0001',
      currency: 'KSh',
    });
    expect(msg).toContain('KSh 10600 received for Unit 15 for September 2026');
    expect(msg).toContain('(Rent KSh 9000 + Water KSh 1600)');
    expect(msg).toContain('Receipt: RWC-2026-0001');
  });

  it('builds a water receipt message', () => {
    const msg = waterReceiptMessage({
      tenantName: 'Grace',
      unitNumber: '15',
      monthName: 'February',
      year: 2026,
      waterPaid: 1000,
      balance: 600,
      receiptNumber: 'WC-2026-0001',
      currency: 'KSh',
    });
    expect(msg).toContain('KSh 1000 received for Unit 15 water, February 2026');
    expect(msg).toContain('Outstanding balance: KSh 600');
  });

  it('keeps the exact spec format when no business identity is given', () => {
    const msg = rentReceiptMessage({
      tenantName: 'John',
      unitNumber: '15',
      monthName: 'September',
      year: 2026,
      rentPaid: 9000,
      balance: 0,
      receiptNumber: 'RC-2026-0001',
      currency: 'KSh',
    });
    expect(msg.endsWith('Thank you.')).toBe(true);
    expect(msg).not.toContain('\n');
  });

  it('appends the business identity on its own line when provided', () => {
    const identity = 'Acme Properties Ltd (Reg. No. C.123456)';
    for (const build of [
      () => rentReceiptMessage({ tenantName: 'John', unitNumber: '15', monthName: 'September', year: 2026, rentPaid: 9000, balance: 0, receiptNumber: 'RC-2026-0001', currency: 'KSh', businessIdentity: identity }),
      () => waterReceiptMessage({ tenantName: 'Grace', unitNumber: '15', monthName: 'February', year: 2026, waterPaid: 1000, balance: 600, receiptNumber: 'WC-2026-0001', currency: 'KSh', businessIdentity: identity }),
      () => combinedReceiptMessage({ tenantName: 'John', unitNumber: '15', monthName: 'September', year: 2026, rentPaid: 9000, waterPaid: 1600, totalPaid: 10600, balance: 0, receiptNumber: 'RWC-2026-0001', currency: 'KSh', businessIdentity: identity }),
    ]) {
      const msg = build();
      expect(msg.endsWith(identity)).toBe(true);
      expect(msg).toContain('Thank you.\n');
      // GSM-7 safety: the identity line must not introduce non-GSM characters
      // (e.g. em dashes) that would force 70-chars-per-segment UCS-2 encoding.
      expect(msg).not.toMatch(/[—–]/);
    }
  });
});