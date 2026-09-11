import { getMpesaConfig, parseC2bCallback, parseStkCallback, requestStkPush } from '../../src/services/mpesaProvider';

describe('M-Pesa provider adapter', () => {
  test('parses a C2B confirmation using the unit reference', () => {
    const result = parseC2bCallback({
      TransID: 'QWE123',
      TransAmount: '4000',
      BillRefNumber: '15',
      TransTime: '20260911123045',
      MSISDN: '0711000002',
    });

    expect(result.transactionId).toBe('QWE123');
    expect(result.amount).toBe(4000);
    expect(result.accountReference).toBe('15');
    expect(result.phoneNumber).toBe('+254711000002');
    expect(result.transactionDate.toISOString()).toBe('2026-09-11T09:30:45.000Z');
  });

  test('parses a successful STK callback', () => {
    const result = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'merchant-1',
          CheckoutRequestID: 'checkout-1',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 2500 },
              { Name: 'MpesaReceiptNumber', Value: 'ABC123' },
              { Name: 'TransactionDate', Value: 20260911123045 },
              { Name: 'PhoneNumber', Value: 254711000002 },
            ],
          },
        },
      },
    });

    expect(result.payment?.transactionId).toBe('ABC123');
    expect(result.payment?.amount).toBe(2500);
    expect(result.checkoutRequestId).toBe('checkout-1');
  });

  test('does not call Daraja in the default mock mode', async () => {
    expect(getMpesaConfig().provider).toBe('mock');
    const result = await requestStkPush({
      phoneNumber: '0711000002',
      amount: 2500,
      accountReference: '15',
      transactionDescription: 'Rent',
    });
    expect(result.checkoutRequestId).toMatch(/^MOCK-CHECKOUT-/);
  });

  test('rejects malformed C2B callbacks', () => {
    expect(() => parseC2bCallback({ TransID: 'QWE123', TransAmount: 4000 })).toThrow('account reference');
  });
});
