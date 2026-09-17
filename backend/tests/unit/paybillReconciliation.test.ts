import { parsePaybillReference } from '../../src/services/mpesaProvider';

describe('PayBill reference parsing', () => {
  it('normalizes a rent unit reference', () => {
    expect(parsePaybillReference('  a-204  ')).toEqual({ normalizedUnitNumber: 'A-204', kind: 'RENT' });
  });

  it('recognizes the water suffix', () => {
    expect(parsePaybillReference('a-204-water')).toEqual({ normalizedUnitNumber: 'A-204', kind: 'WATER' });
  });

  it('rejects an empty water unit', () => {
    expect(() => parsePaybillReference(' -WATER ')).toThrow('no unit number');
  });

  it('rejects an empty reference', () => {
    expect(() => parsePaybillReference('   ')).toThrow('required');
  });
});
