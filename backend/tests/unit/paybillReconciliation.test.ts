import { parsePaybillReference } from '../../src/services/mpesaProvider';

describe('PayBill reference parsing', () => {
  it('normalizes a rent unit reference', () => {
    expect(parsePaybillReference('  a-204  ')).toEqual({ normalizedUnitNumber: 'A-204', kind: 'RENT' });
  });

  it('recognizes the water suffix', () => {
    expect(parsePaybillReference('a-204-water')).toEqual({ normalizedUnitNumber: 'A-204', kind: 'WATER' });
  });

  it('treats a blank reference as a rent payment with no unit (phone fallback / manual review)', () => {
    // Tenants routinely leave the paybill account field empty; the money is
    // still received, so it must not be a parse error.
    expect(parsePaybillReference('   ')).toEqual({ normalizedUnitNumber: '', kind: 'RENT' });
  });

  it('rejects an empty water unit', () => {
    expect(() => parsePaybillReference(' -WATER ')).toThrow('no unit number');
  });
});
