import { evaluateBalance, getSmsConfig, normalizePhoneNumber, parseAtDeliveryOutcome, parseProviderCost, sendSms } from '../../src/services/smsProvider';

describe('normalizePhoneNumber', () => {
  it('keeps valid E.164 numbers', () => {
    expect(normalizePhoneNumber('+254711000002')).toBe('+254711000002');
    expect(normalizePhoneNumber('+441234567890')).toBe('+441234567890');
  });

  it('normalizes common Kenyan formats to E.164', () => {
    expect(normalizePhoneNumber('+254 711 000 002')).toBe('+254711000002');
    expect(normalizePhoneNumber('0711 000 002')).toBe('+254711000002');
    expect(normalizePhoneNumber('0711000002')).toBe('+254711000002');
    expect(normalizePhoneNumber('0711-000-002')).toBe('+254711000002');
    expect(normalizePhoneNumber('254711000002')).toBe('+254711000002');
    expect(normalizePhoneNumber('711000002')).toBe('+254711000002');
    expect(normalizePhoneNumber('0110000002')).toBe('+254110000002'); // new 01xx range
  });

  it('rejects unparseable input', () => {
    expect(normalizePhoneNumber('')).toBeNull();
    expect(normalizePhoneNumber('not-a-phone')).toBeNull();
    expect(normalizePhoneNumber('0711')).toBeNull();
    expect(normalizePhoneNumber('12345')).toBeNull();
  });
});

describe('parseProviderCost', () => {
  it('parses Africa\'s Talking cost strings', () => {
    expect(parseProviderCost('KES 1.20')).toEqual({ currency: 'KES', amount: 1.2 });
    expect(parseProviderCost('KES 1,250.50')).toEqual({ currency: 'KES', amount: 1250.5 });
    expect(parseProviderCost('USD 0.011')).toEqual({ currency: 'USD', amount: 0.011 });
    expect(parseProviderCost('  kes 2 ')).toEqual({ currency: 'KES', amount: 2 });
  });

  it('returns undefined for missing or unparseable costs instead of failing the send', () => {
    expect(parseProviderCost(undefined)).toBeUndefined();
    expect(parseProviderCost('')).toBeUndefined();
    expect(parseProviderCost('1.20')).toBeUndefined();
    expect(parseProviderCost('KES')).toBeUndefined();
    expect(parseProviderCost('KES abc')).toBeUndefined();
  });
});

describe('getSmsConfig / sendSms (provider selection)', () => {
  it('forces the mock provider in the test environment', () => {
    // tests/setup-env.ts sets NODE_ENV=test before modules load — this guard
    // guarantees test runs never contact a real provider.
    expect(process.env.NODE_ENV).toBe('test');
    expect(getSmsConfig()).toMatchObject({ provider: 'mock', live: false });
  });

  it('mock provider records a MOCK reference without any network call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await sendSms({ phoneNumber: '+254711000002', message: 'Test receipt' });
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toMatch(/^MOCK-\d+$/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('evaluateBalance (low-balance threshold logic)', () => {
  it.each([
    [1000, 500, 'ok'],
    [501, 500, 'ok'],
    [500, 500, 'low'],
    [250, 500, 'low'],
    [1, 500, 'low'],
    [0, 500, 'empty'],
    [-100, 500, 'empty'],
  ])('balance %p with threshold %p → %p', (amount, threshold, expected) => {
    const status = evaluateBalance({ amount, currency: 'KES' }, threshold);
    expect(status.state).toBe(expected);
    if (status.state !== 'unknown' && status.state !== 'unavailable') {
      expect(status.balance).toEqual({ amount, currency: 'KES' });
      expect(status.threshold).toBe(threshold);
    }
  });

  it('treats a null threshold as ok regardless of balance', () => {
    expect(evaluateBalance({ amount: 5, currency: 'KES' }, null).state).toBe('ok');
    expect(evaluateBalance({ amount: 0, currency: 'KES' }, null).state).toBe('ok');
  });
});

describe('parseAtDeliveryOutcome (delivery report mapping)', () => {
  it.each([
    [{ status: 'Success', statusCode: 101 }, 'DELIVERED'],
    [{ statusCode: 101 }, 'DELIVERED'],
    [{ status: 'Success' }, 'DELIVERED'],
    [{ status: 'OperatorRejected', statusCode: 402 }, 'FAILED_ON_NETWORK'],
    [{ status: 'InvalidNumber' }, 'FAILED_ON_NETWORK'],
    [{ status: 'Expired', statusCode: 407 }, 'FAILED_ON_NETWORK'],
    [{}, null],                       // nothing reported — undecided
    [{ statusCode: 100 }, null],      // User In Buffer Mode — transient
    [{ status: 'User In Buffer Mode', statusCode: 100 }, null],
    [{ status: 'User Absent', statusCode: 104 }, null],
  ])('%j → %j', (report, expected) => {
    expect(parseAtDeliveryOutcome(report as any)).toBe(expected);
  });
});
