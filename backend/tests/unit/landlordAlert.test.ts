// Landlord (owner) payment alert — the third prepared row of a payment.
// The alert must be NULL-tenant (never tenant-scoped), gated by the settings
// flag and the business contact phone, tagged LANDLORD_ALERT for history
// filtering, and honour a customized SMS_LANDLORD_ALERT template.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));
jest.mock('../../src/services/brandingService', () => ({
  getBusinessIdentity: jest.fn(),
}));
jest.mock('../../src/services/templateService', () => ({
  getCustomTemplate: jest.fn(),
}));

import { prepareLandlordAlert, type ReceiptLike } from '../../src/services/smsService';
import { getBusinessIdentity } from '../../src/services/brandingService';
import { getCustomTemplate } from '../../src/services/templateService';

const identityMock = getBusinessIdentity as jest.Mock;
const templateMock = getCustomTemplate as jest.Mock;

const receipt = (): ReceiptLike => ({
  id: 9,
  receipt_number: 'RCP-2026-0009',
  receipt_type: 'RENT',
  tenant_id: 4,
  billing_month: 10,
  billing_year: 2026,
  rent_amount: '12000.00',
  water_amount: '0.00',
  total_amount: '12000.00',
  balance: '0.00',
});

// exec double: query #1 = tenant/settings lookup, query #2 = the INSERT.
function execWith(tenantRow: unknown) {
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const exec = {
    query: jest.fn(async (text: string, params: unknown[]) => {
      queries.push({ text, params });
      if (queries.length === 1) return { rows: tenantRow ? [tenantRow] : [] };
      return { rows: [{ id: 77 }] };
    }),
  };
  return { exec, queries };
}

const tenantRow = {
  full_name: 'Jane Wanjiru',
  unit_number: 'A4',
  currency: 'KSh',
  notify_landlord_on_payment: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  templateMock.mockResolvedValue(null);
  identityMock.mockResolvedValue({
    name: 'Olbano Plaza',
    regNo: null,
    phone: '0706719042',
    email: null,
    logo: null,
  });
});

describe('prepareLandlordAlert', () => {
  it('queues a NULL-tenant alert row on the business contact phone', async () => {
    const { exec, queries } = execWith(tenantRow);
    const id = await prepareLandlordAlert(receipt(), exec as never);
    expect(id).toBe(77);
    const insert = queries[1];
    expect(insert.text).toContain('INSERT INTO sms_notifications');
    // params: receipt_id, tenant_id (NULL — owner row), phone, message, kind
    expect(insert.params[0]).toBe(9);
    expect(insert.params[1]).toBeNull();
    expect(insert.params[2]).toBe('0706719042');
    const message = String(insert.params[3]);
    expect(message).toContain('PAYMENT RECEIVED');
    expect(message).toContain('Jane Wanjiru');
    expect(message).toContain('Unit A4');
    expect(message).toContain('October 2026');
    expect(message).toContain('RCP-2026-0009');
    expect(message).toContain('Olbano Plaza'); // identity line appended
    expect(insert.params[4]).toBe('LANDLORD_ALERT');
  });

  it('skips when the settings flag is off', async () => {
    const { exec, queries } = execWith({ ...tenantRow, notify_landlord_on_payment: false });
    expect(await prepareLandlordAlert(receipt(), exec as never)).toBeNull();
    expect(queries).toHaveLength(1); // lookup only — no INSERT
  });

  it('skips when no contact phone is on file', async () => {
    identityMock.mockResolvedValue({ name: 'Olbano Plaza', regNo: null, phone: null, email: null, logo: null });
    const { exec, queries } = execWith(tenantRow);
    expect(await prepareLandlordAlert(receipt(), exec as never)).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('honours a customized SMS_LANDLORD_ALERT template with merged fields', async () => {
    templateMock.mockResolvedValue({
      body: 'PAID: {{currency}} {{amount}} from {{name}} ({{unit}}) rc {{receipt}}',
    });
    const { exec, queries } = execWith(tenantRow);
    await prepareLandlordAlert(receipt(), exec as never);
    expect(String(queries[1].params[3])).toBe('PAID: KSh 12000 from Jane Wanjiru (A4) rc RCP-2026-0009');
  });
});
