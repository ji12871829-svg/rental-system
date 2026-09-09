import {
  balanceDue,
  computeWaterBill,
  formatReceiptNumber,
  paymentStatus,
  receiptPrefixFor,
  rentCollectionRate,
  waterCollectionRate,
  waterSurplusDeficit,
} from '../../src/utils/businessRules';

describe('paymentStatus (spec §10 / §17)', () => {
  it('returns UNPAID when nothing has been paid', () => {
    expect(paymentStatus(9000, 0)).toBe('UNPAID');
  });

  it('returns PARTIAL when paid is less than expected', () => {
    expect(paymentStatus(9000, 4000)).toBe('PARTIAL');
    expect(paymentStatus(2000, 1500)).toBe('PARTIAL');
  });

  it('returns PAID when paid equals expected', () => {
    expect(paymentStatus(9000, 9000)).toBe('PAID');
    expect(paymentStatus(2000, 2000)).toBe('PAID');
  });

  it('returns OVERPAID when paid exceeds expected', () => {
    expect(paymentStatus(2000, 2200)).toBe('OVERPAID');
  });

  it('treats zero expected with any paid as OVERPAID (defensive)', () => {
    expect(paymentStatus(0, 100)).toBe('OVERPAID');
  });
});

describe('balanceDue (spec §10)', () => {
  it('expected minus paid, rounded to cents', () => {
    expect(balanceDue(9000, 4000)).toBe(5000);
    expect(balanceDue(6600, 6000)).toBe(600);
    expect(balanceDue(1600, 1600)).toBe(0);
  });
});

describe('computeWaterBill (spec §13–§16)', () => {
  it('computes consumption and bill for a normal reading', () => {
    const r = computeWaterBill(120, 128, 200);
    expect(r).toEqual({
      ok: true,
      previousReading: 120,
      currentReading: 128,
      consumption: 8,
      waterRate: 200,
      waterBill: 1600,
      firstReading: false,
    });
  });

  it('FIRST READING: no previous reading bills from zero and flags firstReading', () => {
    const r = computeWaterBill(null, 128, 200);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.firstReading).toBe(true);
      expect(r.previousReading).toBe(0);
      expect(r.consumption).toBe(128);
      expect(r.waterBill).toBe(25600);
    }
  });

  it('rejects a current reading lower than the previous reading', () => {
    const r = computeWaterBill(128, 120, 200);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Current meter reading cannot be lower than previous reading.');
    }
  });

  it('rejects negative current readings', () => {
    expect(computeWaterBill(10, -5, 200).ok).toBe(false);
  });

  it('rounds to cents', () => {
    const r = computeWaterBill(100.001, 100.5, 200);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.consumption).toBe(0.5);
  });
});

describe('water financial performance (spec §22 / §47)', () => {
  it('collection rate is collected / billed × 100', () => {
    expect(waterCollectionRate(8000, 10000)).toBe(80);
    expect(waterCollectionRate(0, 10000)).toBe(0);
    expect(waterCollectionRate(5000, 0)).toBe(0);
  });

  it('surplus when collected exceeds supply cost', () => {
    expect(waterSurplusDeficit(8000, 5000)).toBe(3000);
  });

  it('deficit when supply cost exceeds collected', () => {
    expect(waterSurplusDeficit(5000, 8000)).toBe(-3000);
  });

  it('rent collection rate', () => {
    expect(rentCollectionRate(186500, 274500)).toBeCloseTo(67.94, 1);
  });
});

describe('receipt numbers (spec §33)', () => {
  it('formats RC / WC / RWC sequences per year', () => {
    expect(formatReceiptNumber('RC', 2026, 1)).toBe('RC-2026-0001');
    expect(formatReceiptNumber('WC', 2026, 1)).toBe('WC-2026-0001');
    expect(formatReceiptNumber('RWC', 2026, 42)).toBe('RWC-2026-0042');
    expect(formatReceiptNumber('RC', 2027, 1)).toBe('RC-2027-0001');
  });

  it('maps receipt types to prefixes', () => {
    expect(receiptPrefixFor('RENT')).toBe('RC');
    expect(receiptPrefixFor('WATER')).toBe('WC');
    expect(receiptPrefixFor('COMBINED')).toBe('RWC');
  });
});