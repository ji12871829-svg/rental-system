import { listMergeTokens, renderMergeFields } from '../../src/utils/mergeFields';
import { applyTemplate, TEMPLATE_KINDS } from '../../src/services/templateService';

describe('merge fields ({{token}} rendering)', () => {
  it('replaces every occurrence of a known token', () => {
    expect(renderMergeFields('Hi {{name}} — dear {{name}}', { name: 'John' })).toBe(
      'Hi John — dear John',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderMergeFields('Unit {{ unit }}', { unit: '15' })).toBe('Unit 15');
  });

  it('leaves unknown tokens visible instead of silently dropping them', () => {
    expect(renderMergeFields('Hello {{nmae}}', { name: 'John' })).toBe('Hello {{nmae}}');
  });

  it('renders known-but-empty values as empty strings', () => {
    expect(renderMergeFields('A{{nothing}}B', { nothing: null })).toBe('AB');
  });

  it('stringifies numeric values', () => {
    expect(renderMergeFields('{{amount}}', { amount: 9000 })).toBe('9000');
  });

  it('lists tokens without duplicates', () => {
    expect(listMergeTokens('{{a}} and {{a}} and {{b_2}}')).toEqual(['a', 'b_2']);
  });
});

describe('template fallback (applyTemplate)', () => {
  const vars = { name: 'John', unit: '15' };

  it('uses the hardcoded fallback when no custom row exists', () => {
    expect(applyTemplate(null, vars, () => 'DEFAULT for John / 15')).toBe('DEFAULT for John / 15');
  });

  it('renders the custom body with merge vars when a row exists', () => {
    expect(applyTemplate({ body: 'Custom for {{name}}, Unit {{unit}}' }, vars, () => 'DEFAULT')).toBe(
      'Custom for John, Unit 15',
    );
  });
});

describe('template kind registry', () => {
  it('declares exactly the 9 supported kinds', () => {
    expect(TEMPLATE_KINDS.map((k) => k.kind)).toEqual([
      'SMS_RENT_RECEIPT',
      'SMS_WATER_RECEIPT',
      'SMS_COMBINED_RECEIPT',
      'SMS_BALANCE_DUE',
      'SMS_OVERDUE',
      'WHATSAPP_BALANCE_DUE',
      'WHATSAPP_OVERDUE',
      'WHATSAPP_PAYMENT_CONFIRMATION',
      'EMAIL_CAMPAIGN',
    ]);
  });

  it('every default body renders without leftover tokens for its declared fields', () => {
    for (const meta of TEMPLATE_KINDS) {
      const sample: Record<string, string> = {};
      for (const field of meta.fields) sample[field] = 'X';
      const rendered = renderMergeFields(meta.defaultBody, sample);
      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('}}');
      if (meta.hasSubject && meta.defaultSubject) {
        expect(renderMergeFields(meta.defaultSubject, sample)).not.toContain('{{');
      }
    }
  });
});