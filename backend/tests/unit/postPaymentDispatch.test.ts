// The post-payment dispatch seam: both notification rows are prepared ON the
// caller's transaction (a pool connection cannot see the seconds-old receipt),
// and dispatch happens strictly after commit via the returned closure. These
// tests pin that split — the exact bug class this seam exists to prevent —
// plus the delivery facts it returns: the audit trail and the API response
// report these objects verbatim, so they can never drift from what was
// actually prepared.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));
jest.mock('../../src/services/smsService', () => ({
  autoSendEnabled: jest.fn(() => true),
  dispatchAutoSend: jest.fn(),
  prepareForReceipt: jest.fn(),
}));
jest.mock('../../src/services/emailService', () => ({
  prepareForReceipt: jest.fn(),
  sendEmailNotification: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/config/env', () => {
  const actual = jest.requireActual('../../src/config/env');
  return { ...actual, isTest: false };
});

import { dispatchAutoSend, prepareForReceipt as prepareSms } from '../../src/services/smsService';
import { prepareForReceipt as prepareEmail } from '../../src/services/emailService';
import { autoSendEnabled as channelGate, dispatchAfterCommit } from '../../src/services/outboundMessage';
import { notifyPaymentRecorded } from '../../src/services/postPaymentDispatch';
import { HttpError } from '../../src/utils/httpError';
import type { ReceiptLike } from '../../src/services/smsService';

jest.mock('../../src/services/outboundMessage', () => ({
  autoSendEnabled: jest.fn(() => true),
  dispatchAfterCommit: jest.fn(),
}));

const prepareSmsMock = prepareSms as jest.Mock;
const prepareEmailMock = prepareEmail as jest.Mock;
const dispatchAutoSendMock = dispatchAutoSend as jest.Mock;
const dispatchAfterCommitMock = dispatchAfterCommit as jest.Mock;
const channelGateMock = channelGate as jest.Mock;

const receipt = (): ReceiptLike => ({
  id: 7,
  receipt_number: 'RC-2026-0042',
  receipt_type: 'RENT',
  tenant_id: 3,
  billing_month: 10,
  billing_year: 2026,
  rent_amount: '25000.00',
  water_amount: '0.00',
  total_amount: '25000.00',
  balance: '0.00',
});

const client = { query: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  channelGateMock.mockImplementation(() => true);
  prepareSmsMock.mockResolvedValue(11);
  // The seam reads the email recipient-availability fact on the caller's
  // transaction; by default this tenant has an address on file.
  client.query.mockResolvedValue({ rows: [{ email: 'grace@example.com' }] });
});

describe('notifyPaymentRecorded — inside the transaction', () => {
  it('prepares the SMS row on the caller’s transaction executor, not the pool', async () => {
    prepareEmailMock.mockRejectedValue(new HttpError(400, 'BAD_REQUEST', '"grace@example.com" is not a valid email address.'));
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.sms).toEqual({ queued: true, autoSend: true });
    expect(prepareSmsMock).toHaveBeenCalledWith(receipt(), client);
    // The closure exists even when only SMS was prepared — dispatch is the
    // caller's responsibility, after commit.
    expect(() => prepared.dispatch()).not.toThrow();
  });

  it('prepares the email row on the same transaction for RENT receipts', async () => {
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.email).toEqual({ queued: true, autoSend: true, reason: null });
    expect(prepareEmailMock).toHaveBeenCalledWith(7, { exec: client });
    // The availability fact comes from the same transaction, so it is
    // exactly what queueEmail would see.
    expect(client.query).toHaveBeenCalledWith('SELECT email FROM tenants WHERE id = $1', [3]);
  });

  it('skips email preparation for WATER receipts', async () => {
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded({ ...receipt(), receipt_type: 'WATER' }, client as never);
    // Nothing was skipped, so there is no reason to report.
    expect(prepared.email).toEqual({ queued: false, autoSend: true, reason: null });
    expect(prepareEmailMock).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();
  });

  it('reports "no email on file" without attempting preparation', async () => {
    // A blank recipient is a fact about the tenant, known before composing —
    // no template or PDF is rendered just to be refused by queueEmail.
    client.query.mockResolvedValue({ rows: [{ email: null }] });
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.email).toEqual({ queued: false, autoSend: true, reason: 'no email on file' });
    expect(prepareEmailMock).not.toHaveBeenCalled();
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();
  });

  it('treats auto-send off with an address on file as a config choice, not a gap', async () => {
    channelGateMock.mockImplementation((channel: string) => (channel === 'EMAIL' ? false : true));
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.email).toEqual({ queued: false, autoSend: false, reason: null });
    expect(prepareEmailMock).not.toHaveBeenCalled();
  });

  it('surfaces queueEmail’s refusal verbatim as the fact’s reason', async () => {
    // The 400 is an unusable recipient — a fact about the address, never a
    // payment failure. The audit trail records the real rejection.
    prepareEmailMock.mockRejectedValue(new HttpError(400, 'BAD_REQUEST', '"nope" is not a valid email address.'));
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.email).toEqual({ queued: false, autoSend: true, reason: '"nope" is not a valid email address.' });
    expect(prepared.dispatch()).toBeUndefined();
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();
  });

  it('lets a real preparation error propagate (rollback path preserved)', async () => {
    prepareEmailMock.mockRejectedValue(new HttpError(500, 'INTERNAL', 'db exploded'));
    await expect(notifyPaymentRecorded(receipt(), client as never)).rejects.toThrow('db exploded');
  });
});

describe('notifyPaymentRecorded — after the commit', () => {
  it('returns a dispatch closure; nothing is sent before the caller commits', async () => {
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(dispatchAutoSendMock).not.toHaveBeenCalled();
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();

    prepared.dispatch();
    expect(dispatchAutoSendMock).toHaveBeenCalledTimes(1);
    expect(dispatchAutoSendMock).toHaveBeenCalledWith(11);
    expect(dispatchAfterCommitMock).toHaveBeenCalledTimes(1);
    expect(dispatchAfterCommitMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'EMAIL', what: expect.stringContaining('receipt 7') })
    );
  });

  it('dispatches only the channels that were prepared', async () => {
    prepareEmailMock.mockRejectedValue(new HttpError(400, 'BAD_REQUEST', '"nope" is not a valid email address.'));
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    prepared.dispatch();
    expect(dispatchAutoSendMock).toHaveBeenCalledTimes(1);
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();
  });

  it('reports the SMS auto-send gate in the fact without bypassing it in the closure', async () => {
    channelGateMock.mockImplementation((channel: string) => (channel === 'SMS' ? false : true));
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.sms).toEqual({ queued: true, autoSend: false });
    prepared.dispatch();
    // dispatchAutoSend consults the gate itself; the seam does not bypass it.
    expect(dispatchAutoSendMock).toHaveBeenCalledTimes(1);
  });
});
