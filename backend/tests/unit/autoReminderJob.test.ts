// The scheduled reminder sweep (autoReminderJob): pure EAT window rules, and
// the runner's dedupe / gating / arrears-selection behaviour with every
// collaborator mocked.
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  poolExec: jest.fn(),
}));
jest.mock('../../src/services/smsService', () => ({ dispatchAutoSend: jest.fn() }));
jest.mock('../../src/services/reminderService', () => ({ prepareReminder: jest.fn() }));
jest.mock('../../src/services/settingsService', () => ({ getSettings: jest.fn() }));
jest.mock('../../src/services/tenantLedger', () => ({ tenantBalances: jest.fn() }));

import { eatWallClock, reminderPlan, runScheduledReminders } from '../../src/services/autoReminderJob';
import { query, queryOne } from '../../src/config/db';
import { dispatchAutoSend } from '../../src/services/smsService';
import { prepareReminder } from '../../src/services/reminderService';
import { getSettings } from '../../src/services/settingsService';
import { tenantBalances } from '../../src/services/tenantLedger';

const queryMock = query as jest.Mock;
const queryOneMock = queryOne as jest.Mock;
const prepareReminderMock = prepareReminder as jest.Mock;
const dispatchMock = dispatchAutoSend as jest.Mock;
const settingsMock = getSettings as jest.Mock;
const ledgerMock = tenantBalances as jest.Mock;

describe('eatWallClock', () => {
  it('shifts UTC to Africa/Nairobi (UTC+3)', () => {
    expect(eatWallClock(new Date('2026-10-05T06:00:00Z')).getUTCHours()).toBe(9);
  });
});

describe('reminderPlan (pure window rules, EAT)', () => {
  it('opens the due-soon window on the last EAT day from 10:00', () => {
    // 2026-11-30 10:30 EAT = 07:30 UTC (November has 30 days).
    expect(reminderPlan(new Date('2026-11-30T07:30:00Z'))).toEqual({ dueSoon: true, overdue: false });
    // One minute before 10:00 EAT — window still shut.
    expect(reminderPlan(new Date('2026-11-30T06:59:00Z')).dueSoon).toBe(false);
    // 00:30 EAT on December 1 (21:30 UTC on the 30th) — window closed again.
    expect(reminderPlan(new Date('2026-11-30T21:30:00Z')).dueSoon).toBe(false);
  });

  it('treats February differently in leap and non-leap years', () => {
    // 2027-02-28 12:00 EAT = 09:00 UTC — 2027 is not a leap year.
    expect(reminderPlan(new Date('2027-02-28T09:00:00Z')).dueSoon).toBe(true);
    // 2028 is a leap year: the 28th is NOT the last day.
    expect(reminderPlan(new Date('2028-02-28T09:00:00Z')).dueSoon).toBe(false);
  });

  it('opens the overdue chase on the 5th from 09:00 EAT', () => {
    expect(reminderPlan(new Date('2026-10-05T06:30:00Z'))).toEqual({ dueSoon: false, overdue: true });
    expect(reminderPlan(new Date('2026-10-05T05:30:00Z')).overdue).toBe(false); // 08:30 EAT
    expect(reminderPlan(new Date('2026-10-06T06:30:00Z')).overdue).toBe(false);
  });

  it('is quiet mid-month', () => {
    expect(reminderPlan(new Date('2026-10-15T09:00:00Z'))).toEqual({ dueSoon: false, overdue: false });
  });
});

describe('runScheduledReminders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsMock.mockResolvedValue({ auto_reminders_enabled: true, currency: 'KSh', reporting_year: 2026 });
    queryMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    queryOneMock.mockResolvedValue({ count: '0' });
    prepareReminderMock.mockResolvedValue({ smsId: 41, message: 'x', emailId: null, whatsappUrl: null });
    ledgerMock.mockResolvedValue({ combinedBalance: 0 });
  });

  it('does nothing outside both windows', async () => {
    const r = await runScheduledReminders(new Date('2026-10-15T09:00:00Z'));
    expect(r).toEqual({ dueSoonQueued: 0, overdueQueued: 0 });
    expect(prepareReminderMock).not.toHaveBeenCalled();
  });

  it('queues a due-soon reminder per active tenant and dispatches each', async () => {
    const r = await runScheduledReminders(new Date('2026-11-30T07:30:00Z'));
    expect(r.dueSoonQueued).toBe(2);
    expect(prepareReminderMock).toHaveBeenCalledWith(1, 'DUE_SOON', 'SMS', {
      templateKind: 'AUTO_DUE_SOON',
      userId: null,
    });
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('refuses to re-run a batch whose tag already has a row this window', async () => {
    queryOneMock.mockResolvedValue({ count: '3' });
    const r = await runScheduledReminders(new Date('2026-11-30T07:30:00Z'));
    expect(r.dueSoonQueued).toBe(0);
    expect(prepareReminderMock).not.toHaveBeenCalled();
  });

  it('honours the settings master switch before touching anything', async () => {
    settingsMock.mockResolvedValue({ auto_reminders_enabled: false, currency: 'KSh', reporting_year: 2026 });
    const r = await runScheduledReminders(new Date('2026-11-30T07:30:00Z'));
    expect(r.dueSoonQueued).toBe(0);
    expect(queryMock).not.toHaveBeenCalled(); // even the tenant list stays untouched
  });

  it('chases only tenants whose ledger shows arrears', async () => {
    ledgerMock
      .mockResolvedValueOnce({ combinedBalance: 0 })
      .mockResolvedValueOnce({ combinedBalance: 4500 });
    const r = await runScheduledReminders(new Date('2026-10-05T06:30:00Z'));
    expect(r.overdueQueued).toBe(1);
    expect(prepareReminderMock).toHaveBeenCalledTimes(1);
    expect(prepareReminderMock).toHaveBeenCalledWith(2, 'OVERDUE', 'SMS', {
      templateKind: 'AUTO_OVERDUE',
      userId: null,
    });
  });
});
