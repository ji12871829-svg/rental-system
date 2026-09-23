// Reminder SMS template composers — the statement ("Monthly Rent & Balance
// Due") and overdue-notice templates staff queue from the Tenants page.
// The receipt composers' GSM-7 budget rules apply here too (shared
// withIdentity helper), so the identity-line behaviour is covered as well.
import {
  gsm7EffectiveLength,
  monthlyBalanceDueMessage,
  overdueNoticeMessage,
  SMS_TWO_SEGMENT_GSM7_LIMIT,
} from '../../src/utils/businessRules';

const base = {
  tenantName: 'Jane Wanjiku',
  unitNumber: 'B4',
  currency: 'KSh',
};

describe('monthlyBalanceDueMessage', () => {
  it('follows the statement template wording with all placeholders filled', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      monthName: 'September',
      year: 2026,
      totalDue: 4500,
      accountNumber: 'Unit B4',
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Dear Jane Wanjiku, your statement for September 2026 for Unit B4 is ready. Total Due: KSh 4500. Account: Unit B4. Pay via M-Pesa PayBill 247252.',
    );
  });

  it('states a zero balance honestly when the tenant is fully paid', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      monthName: 'September',
      year: 2026,
      totalDue: 0,
      accountNumber: 'Unit B4',
      paymentMethod: 'M-Pesa or at the office',
      currency: 'KSh',
    });
    expect(msg).toContain('Total Due: KSh 0.');
  });

  it('stays within the two-segment GSM-7 budget without an identity line', () => {
    const msg = monthlyBalanceDueMessage({
      tenantName: 'A Very Long Tenant Name That Operators Sometimes Type',
      unitNumber: 'B12',
      monthName: 'September',
      year: 2026,
      totalDue: 123456,
      accountNumber: 'Unit B12',
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });

  it('appends a short identity line within the segment budget', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      monthName: 'September',
      year: 2026,
      totalDue: 4500,
      accountNumber: 'Unit B4',
      paymentMethod: 'M-Pesa',
      currency: 'KSh',
      businessIdentity: 'Olbano Plaza',
    });
    expect(msg).toContain('\nOlbano Plaza');
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });
});

describe('overdueNoticeMessage', () => {
  it('follows the overdue template wording with both figures', () => {
    const msg = overdueNoticeMessage({
      ...base,
      amountDue: 4500,
      totalBalance: 13500,
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Hi Jane Wanjiku, Unit B4 has an overdue balance of KSh 4500. Please clear this immediately to avoid late fees. Total Balance: KSh 13500.',
    );
  });

  it('keeps the same tone when only part of the balance is overdue', () => {
    const msg = overdueNoticeMessage({ ...base, amountDue: 500, totalBalance: 500, currency: 'KSh' });
    expect(msg).toContain('overdue balance of KSh 500.');
    expect(msg).toContain('Total Balance: KSh 500.');
  });

  it('stays within the two-segment GSM-7 budget with an identity line', () => {
    const msg = overdueNoticeMessage({
      tenantName: 'A Very Long Tenant Name That Operators Sometimes Type',
      unitNumber: 'B12',
      amountDue: 123456,
      totalBalance: 987654,
      currency: 'KSh',
      businessIdentity: 'Olbano Plaza, Reg No BN-2026-XYZ',
    });
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });

  it('avoids non-GSM-7 characters (no em dashes or curly quotes)', () => {
    const msg = overdueNoticeMessage({ ...base, amountDue: 4500, totalBalance: 13500, currency: 'KSh' });
    // eslint-disable-next-line no-control-regex -- GSM-7 charset check, not a control-char check
    expect(/[^\u0000-\u007F]/.test(msg)).toBe(false);
  });
});

// --- WhatsApp variants (informal, emoji, click-to-chat) ----------------------
import {
  whatsappBalanceDueMessage,
  whatsappOverdueMessage,
  whatsappPaymentConfirmationMessage,
} from '../../src/utils/businessRules';

describe('whatsappBalanceDueMessage', () => {
  it('shows current rent, previous balance and total due with the pay instruction', () => {
    const msg = whatsappBalanceDueMessage({
      tenantName: 'Jane Wanjiku',
      unitNumber: 'B4',
      monthName: 'September',
      year: 2026,
      currentRent: 9000,
      previousBalance: 1500,
      totalDue: 10500,
      accountNumber: 'Unit B4',
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(msg).toContain('Hello Jane Wanjiku,');
    expect(msg).toContain('Your rent statement for September 2026 is ready for Unit B4.');
    expect(msg).toContain('Current Rent: KSh 9000');
    expect(msg).toContain('Previous Balance: KSh 1500');
    expect(msg).toContain('Total Due: KSh 10500.');
    expect(msg).toContain('Account Unit B4 via M-Pesa PayBill 247252');
    expect(msg).toContain('If you have already paid, please ignore this message.');
  });
});

describe('whatsappOverdueMessage', () => {
  it('includes the wa.me support link when a support phone exists', () => {
    const msg = whatsappOverdueMessage({
      tenantName: 'Jane Wanjiku',
      unitNumber: 'B4',
      amountDue: 4500,
      supportPhone: '+254 706 719 042',
      currency: 'KSh',
    });
    expect(msg).toContain('outstanding balance of KSh 4500');
    expect(msg).toContain('https://wa.me/254706719042');
  });

  it('omits the chat link when no support phone is configured', () => {
    const msg = whatsappOverdueMessage({
      tenantName: 'Jane', unitNumber: 'A1', amountDue: 500, supportPhone: null, currency: 'KSh',
    });
    expect(msg).not.toContain('wa.me');
  });
});

describe('whatsappPaymentConfirmationMessage', () => {
  it('thanks the tenant and states the updated balance', () => {
    const msg = whatsappPaymentConfirmationMessage({
      tenantName: 'Jane Wanjiku',
      amountPaid: 9000,
      paymentDate: '23 Sep 2026',
      unitNumber: 'B4',
      newBalance: 0,
      currency: 'KSh',
    });
    expect(msg).toContain('Thank you, Jane Wanjiku!');
    expect(msg).toContain('payment of KSh 9000 on 23 Sep 2026 for Unit B4');
    expect(msg).toContain('updated account balance is KSh 0');
    expect(msg).toContain('Have a great day!');
  });
});
