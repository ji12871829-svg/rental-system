// Jaro-Winkler similarity for misheard tenant names: exact matches score
// 1, close mishearings ("Peter Otino" for Peter Otieno) score high,
// unrelated names score low, and short queries score 0 (too little signal).
import { bestMatches, jaroWinkler, nameSimilarity } from '../../src/utils/fuzzyMatch';

describe('nameSimilarity', () => {
  it('scores identical names (any case) at exactly 1', () => {
    expect(nameSimilarity('Peter Otieno', 'Peter Otieno')).toBe(1);
    expect(nameSimilarity('peter otieno', 'Peter Otieno')).toBe(1);
  });

  it('scores single-letter mishearings high', () => {
    expect(nameSimilarity('Peter Otino', 'Peter Otieno')).toBeGreaterThan(0.85);
    expect(nameSimilarity('Jane Wanjiku', 'Jane Wanjiru')).toBeGreaterThan(0.85);
  });

  it('scores unrelated names low', () => {
    expect(nameSimilarity('Zebra', 'Peter Otieno')).toBeLessThan(0.65);
    expect(nameSimilarity('Ann', 'John Mwangi')).toBeLessThan(0.7);
  });

  it('scores short queries at 0 — too little signal to guess on', () => {
    expect(nameSimilarity('Al', 'Allan Wahinya')).toBe(0);
    expect(nameSimilarity('', 'Peter Otieno')).toBe(0);
  });

  it('matches a lone surname against the full name', () => {
    expect(nameSimilarity('Otino', 'Peter Otieno')).toBeGreaterThan(0.7);
  });
});

describe('jaroWinkler', () => {
  it('is 1 for identical strings and 0 when nothing matches', () => {
    expect(jaroWinkler('abc', 'abc')).toBe(1);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
});

describe('bestMatches', () => {
  const tenants = [{ name: 'Peter Otieno' }, { name: 'Jane Wanjiru' }, { name: 'John Mwangi' }];

  it('ranks the closest name first within the limit', () => {
    const out = bestMatches('Peter Otino', tenants, (t) => t.name);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].candidate.name).toBe('Peter Otieno');
  });

  it('returns nothing when nobody is close', () => {
    expect(bestMatches('Zebra Stripes', tenants, (t) => t.name)).toEqual([]);
  });
});
