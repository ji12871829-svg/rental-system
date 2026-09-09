// buildMessage composes the tenant SMS from a receipt + env-configured
// business identity (BUSINESS_NAME / BUSINESS_REG_NO). The env must be set
// BEFORE the first import — env.ts reads process.env at module load — hence
// the require() below instead of a hoisted import.
process.env.BUSINESS_NAME = 'Acme Properties Ltd';
process.env.BUSINESS_REG_NO = 'C.123456';
process.env.BUSINESS_PHONE = '+254 722 000 000';
process.env.BUSINESS_EMAIL = 'info@acme.co.ke';

import { pool } from '../../src/config/db';
import { gsm7EffectiveLength, SMS_TWO_SEGMENT_GSM7_LIMIT } from '../../src/utils/businessRules';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildMessage } = require('../../src/services/smsService') as {
  buildMessage: typeof import('../../src/services/smsService').buildMessage;
};

afterAll(async () => {
  // No DB I/O happens here, but the pool handle must be released for jest to exit.
  await pool.end();
});

const receipt = {
  id: 1,
  receipt_number: 'RC-2026-0001',
  receipt_type: 'RENT' as const,
  tenant_id: 1,
  billing_month: 9,
  billing_year: 2026,
  rent_amount: '9000',
  water_amount: '0',
  total_amount: '9000',
  balance: '0',
};

describe('buildMessage — env-configured business identity + contact line', () => {
  // BUSINESS_PHONE / BUSINESS_EMAIL for this suite are set in a separate
  // describe below via process.env — but env.ts is already loaded, so the
  // contact line assertions live in the env-injected suite instead.
  it('appends the compact one-line identity (legal name + Reg No + contacts + proof)', () => {
    const msg = buildMessage(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(msg.endsWith(
      'Acme Properties Ltd, Reg No C.123456 - Tel +254 722 000 000 Email info@acme.co.ke - Proof of payment'
    )).toBe(true);
  });

  it('keeps the whole message within two GSM-7 segments with identity attached', () => {
    const msg = buildMessage(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });

  it('keeps the legal/thank-you lines GSM-7 safe and free of markup', () => {
    const msg = buildMessage(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(msg).not.toMatch(/[—–<>]/);
  });

  it('keeps the receipt body itself in the spec §34 format', () => {
    const msg = buildMessage(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(msg.startsWith('RENT RECEIPT: Dear Peter Otieno, KSh 9000 received for Unit 1, September 2026 rent.')).toBe(true);
    expect(msg).toContain('Balance: KSh 0. Receipt: RC-2026-0001. Thank you.');
  });

  it('never introduces non-GSM characters (em dash would double SMS cost)', () => {
    const msg = buildMessage(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(msg).not.toMatch(/[—–]/);
  });

  it('keeps the phone/email as plain text (SMS cannot carry markup — phones auto-linkify)', () => {
    const msg = buildMessage(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(msg).toContain('Tel +254 722 000 000');
    expect(msg).toContain('Email info@acme.co.ke');
    expect(msg).not.toContain('<a');
  });

  it('omits the contact line entirely when no contact env is set', async () => {
    // Fresh module instance with only the name configured.
    jest.resetModules();
    delete process.env.BUSINESS_PHONE;
    delete process.env.BUSINESS_EMAIL;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildMessage: bmNoContact } = require('../../src/services/smsService') as {
      buildMessage: typeof import('../../src/services/smsService').buildMessage;
    };
    // The re-required module created its own pool — release it so jest can exit.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { pool: freshPool } = require('../../src/config/db') as { pool: { end: () => Promise<void> } };
    await freshPool.end();
    const msg = bmNoContact(receipt, { tenantName: 'Peter Otieno', unitNumber: '1', currency: 'KSh' });
    expect(msg.endsWith('Acme Properties Ltd, Reg No C.123456 - Proof of payment')).toBe(true);
    expect(msg).not.toContain('Tel');
    expect(msg).not.toContain('Email');
  });

  it('degrades to the minimal identity (contacts dropped) when the body nearly fills two segments', () => {
    // ~103 chars: body + full identity would exceed 306, body + legal identity fits.
    const longName = 'Wanjiku '.repeat(13).trim();
    const msg = buildMessage(receipt, { tenantName: longName, unitNumber: '1', currency: 'KSh' });
    expect(msg).toContain('Acme Properties Ltd, Reg No C.123456'); // legal identity retained
    expect(msg).not.toContain('Tel');          // contacts sacrificed first
    expect(msg).not.toContain('Email');
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });

  it('drops the identity entirely when even the receipt body alone would exceed two segments', () => {
    const hugeName = 'A'.repeat(200);
    const msg = buildMessage(receipt, { tenantName: hugeName, unitNumber: '1', currency: 'KSh' });
    expect(msg).not.toContain('Acme'); // nothing fits — receipt body stands alone
  });
});
