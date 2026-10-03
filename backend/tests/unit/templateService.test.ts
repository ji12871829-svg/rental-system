import { TEMPLATE_KINDS } from '../../src/services/templateService';
// renderMergeFields lives in utils/mergeFields — templateService imports it
// but never re-exported it (this suite shipped importing the wrong module).
import { renderMergeFields } from '../../src/utils/mergeFields';

describe('template kind registry', () => {
  it('declares exactly the 9 supported kinds in a stable order', () => {
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
