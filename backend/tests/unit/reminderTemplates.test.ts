// Reminder SMS template composers — the statement ("Monthly Rent & Balance
// Due") and overdue-notice templates staff queue from the Tenants page.
// The receipt composers' GSM-7 budget rules apply here too (shared
// withIdentity helper), so the identity-line behaviour is covered as well.
import {
  gsm7EffectiveLength,
  lateFeeNoticeMessage,
  monthlyBalanceDueMessage,
  overdueNoticeMessage,
  SMS_TWO_SEGMENT_GSM7_LIMIT,
  waterBillingNoticeMessage,
  welcomeMessage,
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
      'Dear Jane Wanjiku, your rent statement for September 2026 (Unit B4) is ready. Total Due: KSh 4500. To pay, use M-Pesa PayBill 247252 with account Unit B4.',
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
      'Dear Jane Wanjiku, the rent for Unit B4 is overdue by KSh 4500. Kindly settle this amount to avoid a late payment fee. Your total balance is KSh 13500. Thank you.',
    );
  });

  it('keeps the same tone when only part of the balance is overdue', () => {
    const msg = overdueNoticeMessage({ ...base, amountDue: 500, totalBalance: 500, currency: 'KSh' });
    expect(msg).toContain('is overdue by KSh 500.');
    expect(msg).toContain('Your total balance is KSh 500.');
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

// --- Operator-sendable notices ------------------------------------------------
// The three event-reporting kinds: unlike the reminders above they are not
// composed from an "amount owed" narrative, but they share the same ledger
// figures, the same identity-line helper and the same GSM-7 budget rules.
describe('waterBillingNoticeMessage', () => {
  it('states the charge, the month it belongs to, and how to pay it', () => {
    const msg = waterBillingNoticeMessage({
      tenantName: 'Jane Wanjiku',
      unitNumber: 'B4',
      monthName: 'September',
      year: 2026,
      amount: 1200,
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Dear Jane Wanjiku, your water charge for Unit B4 for September 2026 is KSh 1200. It appears on your statement and can be paid together with your rent via M-Pesa PayBill 247252.',
    );
  });
});

describe('lateFeeNoticeMessage', () => {
  it('names the fee as the consequence of staying overdue', () => {
    const msg = lateFeeNoticeMessage({
      tenantName: 'Jane Wanjiku',
      unitNumber: 'B4',
      amountDue: 4500,
      currency: 'KSh',
    });
    expect(msg).toContain('a late payment fee now applies to the overdue rent of KSh 4500 on Unit B4');
    expect(msg).toContain('Kindly settle the full amount, including the fee');
    expect(msg.endsWith('Thank you.')).toBe(true);
  });
});

describe('welcomeMessage', () => {
  it('carries the due date and the pay instruction a new tenant needs', () => {
    const msg = welcomeMessage({
      tenantName: 'Jane Wanjiku',
      unitNumber: 'B4',
      rentAmount: 9000,
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(msg).toContain('welcome to Unit B4!');
    expect(msg).toContain('Rent of KSh 9000 falls due on the 1st of each month');
    expect(msg).toContain('quoting your unit number as the account reference');
  });
});

describe('notice budget and charset', () => {
  // Every notice is written to survive a worst case: a long operator-typed
  // name, a six-figure amount and the full registration identity — still
  // plain GSM-7 (billed per segment, not as UCS-2) and still two segments.
  it('all three notices stay GSM-7 and within the two-segment budget', () => {
    const long = 'A Very Long Tenant Name That Operators Sometimes Type';
    const identity = 'Olbano Plaza, Reg No BN-2026-XYZ';
    for (const build of [
      () => waterBillingNoticeMessage({ tenantName: long, unitNumber: 'B12', monthName: 'September', year: 2026, amount: 123456, paymentMethod: 'M-Pesa PayBill 247252', currency: 'KSh', businessIdentity: identity }),
      () => lateFeeNoticeMessage({ tenantName: long, unitNumber: 'B12', amountDue: 123456, currency: 'KSh', businessIdentity: identity }),
      () => welcomeMessage({ tenantName: long, unitNumber: 'B12', rentAmount: 123456, paymentMethod: 'M-Pesa PayBill 247252', currency: 'KSh', businessIdentity: identity }),
    ]) {
      const msg = build();
      // eslint-disable-next-line no-control-regex -- GSM-7 charset check, not a control-char check
      expect(/[^\u0000-\u007F]/.test(msg)).toBe(false);
      expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
      expect(msg.endsWith(identity)).toBe(true);
    }
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
