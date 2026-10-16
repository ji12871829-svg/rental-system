// resolvePaymentInstructions — which payment line tenants are told, from the
// operator's collection setup. Pure: no database, no provider.
//
//   * PayBill on (number present) → PayBill method + unit account reference.
//   * Otherwise the dedicated Send-Money line wins; the business contact
//     phone is the fallback; with neither, a generic walk-in line that
//     keeps the unit reference.
//   * accountNumber is EMPTY whenever no reference exists (Send Money has no
//     reference field) — every message composer drops its reference clause
//     on empty rather than printing it blank.
import { resolvePaymentInstructions } from '../../src/services/reminderService';

describe('resolvePaymentInstructions', () => {
  it('uses the PayBill number with a unit account reference', () => {
    expect(
      resolvePaymentInstructions({
        paybillEnabled: true,
        paybillNumber: '247252',
        sendMoneyPhone: '0743000000',
        contactPhone: '0700000000',
        unitLabel: '5',
      }),
    ).toEqual({ paymentMethod: 'M-Pesa PayBill 247252', accountNumber: 'Unit 5' });
  });

  it('prefers the dedicated Send-Money line over the contact phone', () => {
    expect(
      resolvePaymentInstructions({
        paybillEnabled: false,
        paybillNumber: null,
        sendMoneyPhone: '0743799002',
        contactPhone: '0706719042',
        unitLabel: '5',
      }),
    ).toEqual({ paymentMethod: 'M-Pesa to 0743799002', accountNumber: '' });
  });

  it('falls back to the contact phone when no money line is set', () => {
    expect(
      resolvePaymentInstructions({
        paybillEnabled: false,
        paybillNumber: null,
        sendMoneyPhone: null,
        contactPhone: '0706719042',
        unitLabel: '5',
      }),
    ).toEqual({ paymentMethod: 'M-Pesa to 0706719042', accountNumber: '' });
  });

  it('ignores a disabled PayBill even when a number lingers on file', () => {
    expect(
      resolvePaymentInstructions({
        paybillEnabled: false,
        paybillNumber: '247252',
        sendMoneyPhone: '0743799002',
        contactPhone: null,
        unitLabel: '5',
      }),
    ).toEqual({ paymentMethod: 'M-Pesa to 0743799002', accountNumber: '' });
  });

  it('falls back to the generic walk-in line with a unit reference', () => {
    expect(
      resolvePaymentInstructions({
        paybillEnabled: false,
        paybillNumber: null,
        sendMoneyPhone: null,
        contactPhone: null,
        unitLabel: '5',
      }),
    ).toEqual({ paymentMethod: 'M-Pesa or at the office', accountNumber: 'Unit 5' });
  });
});
