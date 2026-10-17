// BulkReminderButton — one button per bill.
//
//   1. The label names the owing audience; zero owing disables the button.
//   2. One click (past the wallet confirm) POSTs its audience to the
//      bulk-arrears endpoint with no body — the server derives the audience
//      from the live ledger, so a paid-up tenant can never be included by a
//      stale client selection.
//   3. The result toast reports what was queued; a breakdown modal names
//      every skipped tenant and why.
//   4. BulkBillReminderButtons renders the rent + water pair side by side.
//   5. Renders without a ToastProvider (dashboard widget tests) — only the
//      pop-up degrades, sending still works.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import { BulkBillReminderButtons, BulkReminderButton } from '../components/BulkReminderButton';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

const mockedPost = vi.mocked(api.post);

afterEach(cleanup);

beforeEach(() => {
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({
    data: {
      total: 4,
      audience: 'RENT',
      owing: 2,
      queued: 2,
      skippedPaid: 1,
      skippedNoPhone: 1,
      skippedOtherBill: 0,
      skippedAlreadyReminded: 1,
      skipped: [
        { tenantId: 21, tenantName: 'Cleared Carol', unitNumber: '3', reason: 'PAID', bill: null },
        { tenantId: 22, tenantName: 'No-Phone Noah', unitNumber: '4', reason: 'NO_PHONE', bill: null },
        { tenantId: 23, tenantName: 'Reminded Rita', unitNumber: '5', reason: 'ALREADY_REMINDed', bill: null },
      ],
      autoSend: false,
    },
  });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

function renderButton(props: Partial<Parameters<typeof BulkReminderButton>[0]> = {}) {
  return render(
    <ToastProvider>
      <BulkReminderButton audience="RENT" owingCount={2} onSent={() => {}} {...props} />
    </ToastProvider>,
  );
}

describe('BulkReminderButton', () => {
  it('names the owing count in the label', () => {
    renderButton({ owingCount: 7 });
    expect(screen.getByRole('button', { name: /Remind 7 owing rent/ })).toBeInTheDocument();
  });

  it('disables itself when nobody owes, so no empty blast can go out', () => {
    renderButton({ owingCount: 0 });
    expect(screen.getByRole('button', { name: /Nobody owes/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Nobody owes/ }));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('posts its audience once and reports the queue result', async () => {
    let sent = 0;
    renderButton({ onSent: () => { sent += 1; } });

    fireEvent.click(screen.getByRole('button', { name: /Remind 2 owing rent/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));

    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    // The audience rides the body — the server derives WHO from the live
    // ledger, never a client-side selection that could include a paid tenant.
    expect(url).toBe('/api/sms/reminders/bulk-arrears');
    expect(body).toEqual({ audience: 'RENT' });
    expect(sent).toBe(1);
    expect(await screen.findByText(/2 reminders queued/)).toBeInTheDocument();
  });

  it('aborts when the wallet confirm is dismissed', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Remind 2 owing rent/ }));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('renders without a ToastProvider — only the pop-up degrades', () => {
    render(<BulkReminderButton audience="WATER" owingCount={3} />);
    expect(screen.getByRole('button', { name: /Remind 3 owing water/ })).toBeInTheDocument();
  });

  it('opens a breakdown modal naming each skipped tenant and why', async () => {
    render(
      <ToastProvider>
        <BulkReminderButton audience="RENT" owingCount={2} onSent={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Remind 2 owing rent/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Bulk reminders — 2 queued/)).toBeInTheDocument();
    expect(screen.getByText(/Cleared Carol/)).toBeInTheDocument();
    expect(screen.getByText('Already cleared')).toBeInTheDocument();
    expect(screen.getByText(/No-Phone Noah/)).toBeInTheDocument();
    expect(screen.getByText('No phone number')).toBeInTheDocument();
    expect(screen.getByText(/Reminded Rita/)).toBeInTheDocument();
    expect(screen.getByText('Already reminded this month')).toBeInTheDocument();
  });
});

describe('BulkBillReminderButtons', () => {
  it('renders one button per bill, each posting its own audience', async () => {
    render(
      <ToastProvider>
        <BulkBillReminderButtons rentCount={4} waterCount={1} onSent={() => {}} />
      </ToastProvider>,
    );
    const rentButton = screen.getByRole('button', { name: /Remind 4 owing rent/ });
    const waterButton = screen.getByRole('button', { name: /Remind 1 owing water/ });
    expect(rentButton).toBeInTheDocument();
    expect(waterButton).toBeInTheDocument();

    fireEvent.click(waterButton);
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/sms/reminders/bulk-arrears');
    expect(body).toEqual({ audience: 'WATER' });
  });

  it('disables only the bill nobody owes', () => {
    render(
      <ToastProvider>
        <BulkBillReminderButtons rentCount={4} waterCount={0} onSent={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: /Remind 4 owing rent/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Nobody owes water/ })).toBeDisabled();
  });
});
