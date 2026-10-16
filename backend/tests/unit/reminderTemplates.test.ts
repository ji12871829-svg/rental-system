// Reminder SMS template composers — the statement ("Monthly Rent & Balance
// Due") and overdue-notice templates staff queue from the Tenants page.
// The receipt composers' GSM-7 budget rules apply here too (shared
// withIdentity helper), so the identity-line behaviour is covered as well.
import {
  formatArrearsSpan,
  gsm7EffectiveLength,
  lateFeeNoticeMessage,
  monthlyBalanceDueMessage,
  overdueNoticeMessage,
  rentDueSoonMessage,
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
  it('itemizes rent and water with the total when both are owed', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      period: 'Aug, Sep, Oct 2026',
      rentDue: 9000,
      waterDue: 1200,
      totalDue: 10200,
      accountNumber: 'Unit B4',
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Dear Jane Wanjiku, Unit B4 arrears Aug, Sep, Oct 2026: Rent KSh 9000 + Water KSh 1200 = Total KSh 10200. Pay via M-Pesa PayBill 247252 with account Unit B4. If already paid, ignore this message. Thank you.',
    );
  });

  it('uses the shorter rent-only wording when no water is owed', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      period: 'Oct 2026',
      rentDue: 4500,
      waterDue: 0,
      totalDue: 4500,
      accountNumber: 'Unit B4',
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Dear Jane Wanjiku, rent for Unit B4 (Oct 2026) is unpaid: KSh 4500. Pay via M-Pesa PayBill 247252 with account Unit B4. If already paid, ignore this message. Thank you.',
    );
  });

  it('stays within the two-segment GSM-7 budget without an identity line', () => {
    const msg = monthlyBalanceDueMessage({
      tenantName: 'A Very Long Tenant Name That Operators Sometimes Type',
      unitNumber: 'B12',
      period: 'Aug, Sep, Oct 2026',
      rentDue: 123456,
      waterDue: 78901,
      totalDue: 202357,
      accountNumber: 'Unit B12',
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
    });
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });

  it('appends a short identity line within the segment budget', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      period: 'Aug, Sep, Oct 2026',
      rentDue: 9000,
      waterDue: 1200,
      totalDue: 10200,
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
      period: 'Aug, Sep, Oct 2026',
      amountDue: 4500,
      totalBalance: 13500,
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Dear Jane Wanjiku, the rent for Unit B4 is overdue by KSh 4500 (Aug, Sep, Oct 2026). Kindly settle this amount to avoid a late payment fee. Your total balance is KSh 13500. If already paid, ignore this message. Thank you.',
    );
  });

  it('keeps the same tone when only part of the balance is overdue', () => {
    const msg = overdueNoticeMessage({ ...base, period: 'Oct 2026', amountDue: 500, totalBalance: 500, currency: 'KSh' });
    expect(msg).toContain('is overdue by KSh 500 (Oct 2026).');
    expect(msg).toContain('Your total balance is KSh 500.');
  });

  it('stays within the two-segment GSM-7 budget with an identity line', () => {
    const msg = overdueNoticeMessage({
      tenantName: 'A Very Long Tenant Name That Operators Sometimes Type',
      unitNumber: 'B12',
      period: 'Aug, Sep, Oct 2026',
      amountDue: 123456,
      totalBalance: 987654,
      currency: 'KSh',
      businessIdentity: 'Olbano Plaza, Reg No BN-2026-XYZ',
    });
    expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
  });

  it('avoids non-GSM-7 characters (no em dashes or curly quotes)', () => {
    const msg = overdueNoticeMessage({ ...base, period: 'Oct 2026', amountDue: 4500, totalBalance: 13500, currency: 'KSh' });
    // eslint-disable-next-line no-control-regex -- GSM-7 charset check, not a control-char check
    expect(/[^\u0000-\u007F]/.test(msg)).toBe(false);
  });
});

// --- Operator-sendable notices ------------------------------------------------
// The three event-reporting kinds: unlike the reminders above they are not
// composed from an "amount owed" narrative, but they share the same ledger
// figures, the same identity-line helper and the same GSM-7 budget rules.
describe('waterBillingNoticeMessage', () => {
  it('states the unpaid charge, the month it belongs to, and how to pay it', () => {
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
      'Dear Jane Wanjiku, water for Unit B4 for September 2026 is unpaid: KSh 1200. Pay with your rent via M-Pesa PayBill 247252. If already paid, ignore this message. Thank you.',
    );
  });

  it('names the previous and current readings as meter proof', () => {
    const msg = waterBillingNoticeMessage({
      tenantName: 'Jane Wanjiku',
      unitNumber: 'B4',
      monthName: 'September',
      year: 2026,
      amount: 1200,
      paymentMethod: 'M-Pesa PayBill 247252',
      currency: 'KSh',
      previousReading: 128,
      currentReading: 133,
    });
    expect(msg).toContain('Meter: prev 128, curr 133 (5 units).');
  });

  it('omits the proof clause entirely when either reading is missing', () => {
    for (const opts of [
      { previousReading: 128, currentReading: null },
      { previousReading: null, currentReading: 133 },
    ]) {
      const msg = waterBillingNoticeMessage({
        tenantName: 'Jane Wanjiku',
        unitNumber: 'B4',
        monthName: 'September',
        year: 2026,
        amount: 1200,
        paymentMethod: 'M-Pesa PayBill 247252',
        currency: 'KSh',
        previousReading: opts.previousReading,
        currentReading: opts.currentReading,
      });
      expect(msg).not.toContain('Meter:');
      expect(msg).toContain('is unpaid: KSh 1200. Pay with your rent');
    }
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
      accountNumber: 'Unit B4',
      currency: 'KSh',
    });
    expect(msg).toContain('welcome to Unit B4!');
    expect(msg).toContain('Rent of KSh 9000 falls due on the 1st of each month');
    expect(msg).toContain('Pay via M-Pesa PayBill 247252, quoting Unit B4 as the account reference');
  });
});

describe('Send-Money mode (no PayBill, no account reference)', () => {
  // When the operator collects by Send Money, accountNumber arrives empty and
  // every reference clause must vanish rather than print blank.
  it('balance reminder points at the phone with no account clause', () => {
    const msg = monthlyBalanceDueMessage({
      ...base,
      period: 'Oct 2026',
      rentDue: 9000,
      waterDue: 1200,
      totalDue: 10200,
      accountNumber: '',
      paymentMethod: 'M-Pesa to 0712000000',
      currency: 'KSh',
    });
    expect(msg).toBe(
      'Dear Jane Wanjiku, Unit B4 arrears Oct 2026: Rent KSh 9000 + Water KSh 1200 = Total KSh 10200. Pay via M-Pesa to 0712000000. If already paid, ignore this message. Thank you.',
    );
  });

  it('due-soon nudge drops the quoting clause', () => {
    const msg = rentDueSoonMessage({
      ...base,
      nextMonthName: 'November',
      year: 2026,
      rentAmount: 9000,
      paymentMethod: 'M-Pesa to 0712000000',
      accountNumber: '',
      currency: 'KSh',
    });
    expect(msg).toContain('Please pay via M-Pesa to 0712000000. Thank you.');
    expect(msg).not.toContain('quoting');
    expect(msg).not.toContain('account reference');
  });

  it('welcome drops the quoting clause', () => {
    const msg = welcomeMessage({
      ...base,
      rentAmount: 9000,
      paymentMethod: 'M-Pesa to 0712000000',
      accountNumber: '',
      currency: 'KSh',
    });
    expect(msg).toContain('Pay via M-Pesa to 0712000000. We wish you a comfortable stay.');
    expect(msg).not.toContain('account reference');
  });

  it('whatsapp pay line drops the account', () => {
    const msg = whatsappBalanceDueMessage({
      ...base,
      monthName: 'September',
      year: 2026,
      currentRent: 9000,
      previousBalance: 1500,
      totalDue: 10500,
      accountNumber: '',
      paymentMethod: 'M-Pesa to 0712000000',
      currency: 'KSh',
    });
    expect(msg).toContain('Please make payment via M-Pesa to 0712000000.');
    expect(msg).not.toContain('Account');
  });

  it('send-money variants stay within the two-segment budget', () => {
    const long = 'A Very Long Tenant Name That Operators Sometimes Type';
    const method = 'M-Pesa to 0712000000';
    for (const msg of [
      monthlyBalanceDueMessage({ tenantName: long, unitNumber: 'B12', period: 'Aug, Sep, Oct 2026', rentDue: 123456, waterDue: 78901, totalDue: 202357, accountNumber: '', paymentMethod: method, currency: 'KSh' }),
      rentDueSoonMessage({ tenantName: long, unitNumber: 'B12', nextMonthName: 'September', year: 2026, rentAmount: 123456, paymentMethod: method, accountNumber: '', currency: 'KSh' }),
    ]) {
      expect(gsm7EffectiveLength(msg)).toBeLessThanOrEqual(SMS_TWO_SEGMENT_GSM7_LIMIT);
    }
  });
});

describe('formatArrearsSpan', () => {
  it('names a single unpaid month', () => {
    expect(formatArrearsSpan([10], 10, 2026)).toBe('Oct 2026');
  });

  it('lists up to three unpaid months', () => {
    expect(formatArrearsSpan([8, 9, 10], 10, 2026)).toBe('Aug, Sep, Oct 2026');
  });

  it('caps longer arrears with a more-count tail', () => {
    expect(formatArrearsSpan([1, 2, 3, 4, 5, 6], 10, 2026)).toBe('Jan, Feb, Mar +3 more 2026');
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
      () => waterBillingNoticeMessage({ tenantName: long, unitNumber: 'B12', monthName: 'September', year: 2026, amount: 123456, paymentMethod: 'M-Pesa PayBill 247252', currency: 'KSh', previousReading: 1234.5, currentReading: 2345.75, businessIdentity: identity }),
      () => lateFeeNoticeMessage({ tenantName: long, unitNumber: 'B12', amountDue: 123456, currency: 'KSh', businessIdentity: identity }),
      () => welcomeMessage({ tenantName: long, unitNumber: 'B12', rentAmount: 123456, paymentMethod: 'M-Pesa PayBill 247252', accountNumber: 'Unit B12', currency: 'KSh', businessIdentity: identity }),
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
