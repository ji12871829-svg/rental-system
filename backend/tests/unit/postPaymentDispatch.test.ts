// The post-payment dispatch seam: both notification rows are prepared ON the
// caller's transaction (a pool connection cannot see the seconds-old receipt),
// and dispatch happens strictly after commit via the returned closure. These
// tests pin that split — the exact bug class this seam exists to prevent.
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

import { autoSendEnabled as smsAutoSendEnabled, dispatchAutoSend, prepareForReceipt as prepareSms } from '../../src/services/smsService';
import { prepareForReceipt as prepareEmail } from '../../src/services/emailService';
import { dispatchAfterCommit } from '../../src/services/outboundMessage';
import { notifyPaymentRecorded } from '../../src/services/postPaymentDispatch';
import { HttpError } from '../../src/utils/httpError';
import type { ReceiptLike } from '../../src/services/smsService';

jest.mock('../../src/services/outboundMessage', () => ({
  autoSendEnabled: jest.fn((channel: string) => (channel === 'SMS' ? true : true)),
  dispatchAfterCommit: jest.fn(),
}));

const prepareSmsMock = prepareSms as jest.Mock;
const prepareEmailMock = prepareEmail as jest.Mock;
const dispatchAutoSendMock = dispatchAutoSend as jest.Mock;
const dispatchAfterCommitMock = dispatchAfterCommit as jest.Mock;

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
  (smsAutoSendEnabled as jest.Mock).mockReturnValue(true);
  prepareSmsMock.mockResolvedValue(11);
});

describe('notifyPaymentRecorded — inside the transaction', () => {
  it('prepares the SMS row on the caller’s transaction executor, not the pool', async () => {
    prepareEmailMock.mockRejectedValue(new HttpError(400, 'BAD_REQUEST', 'no email'));
    const { smsId, dispatch } = await notifyPaymentRecorded(receipt(), client as never);
    expect(smsId).toBe(11);
    expect(prepareSmsMock).toHaveBeenCalledWith(receipt(), client);
    // The closure exists even when only SMS was prepared — dispatch is the
    // caller's responsibility, after commit.
    expect(() => dispatch()).not.toThrow();
  });

  it('prepares the email row on the same transaction for RENT receipts', async () => {
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.emailId).toBe(22);
    expect(prepareEmailMock).toHaveBeenCalledWith(7, { exec: client });
  });

  it('skips email preparation for WATER receipts', async () => {
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded({ ...receipt(), receipt_type: 'WATER' }, client as never);
    expect(prepared.emailId).toBeNull();
    expect(prepareEmailMock).not.toHaveBeenCalled();
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();
  });

  it('degrades a missing/invalid email address to "nothing queued" without failing the payment', async () => {
    // queueEmail rejects a blank recipient with a 400 — inside the payment
    // transaction that MUST NOT roll the payment back.
    prepareEmailMock.mockRejectedValue(new HttpError(400, 'BAD_REQUEST', 'no email on file'));
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    expect(prepared.emailId).toBeNull();
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
    prepareEmailMock.mockRejectedValue(new HttpError(400, 'BAD_REQUEST', 'no email'));
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    prepared.dispatch();
    expect(dispatchAutoSendMock).toHaveBeenCalledTimes(1);
    expect(dispatchAfterCommitMock).not.toHaveBeenCalled();
  });

  it('honors the SMS auto-send gate inside the closure', async () => {
    (smsAutoSendEnabled as jest.Mock).mockReturnValue(false);
    prepareEmailMock.mockResolvedValue({ id: 22 });
    const prepared = await notifyPaymentRecorded(receipt(), client as never);
    prepared.dispatch();
    // dispatchAutoSend consults the gate itself; the seam does not bypass it.
    expect(dispatchAutoSendMock).toHaveBeenCalledTimes(1);
  });
});
