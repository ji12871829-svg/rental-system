import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv helpers', () => {
  it('leaves plain values unquoted', () => {
    expect(csvCell('Olbano')).toBe('Olbano');
    expect(csvCell(15000)).toBe('15000');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and newlines, doubling inner quotes', () => {
    expect(csvCell('Plot 12, Riverside')).toBe('"Plot 12, Riverside"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('builds header + rows with CRLF and a BOM', () => {
    const csv = toCsv(['name', 'rent'], [['Jane', 15000], ['John, Jr.', 12000]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('name,rent');
    expect(csv).toContain('Jane,15000');
    expect(csv).toContain('"John, Jr.",12000');
  });
});
