// BulkReminderButton — the one-click arrears reminder.
//
//   1. The label names the owing audience; zero owing disables the button.
//   2. One click (past the wallet confirm) POSTs to the bulk-arrears endpoint
//      with no body — the server derives the audience from the live ledger,
//      so a paid-up tenant can never be included by a stale client selection.
//   3. The result toast reports what was queued, and onSent fires.
//   4. Renders without a ToastProvider (dashboard widget tests) — only the
//      pop-up degrades, sending still works.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import { BulkReminderButton } from '../components/BulkReminderButton';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

const mockedPost = vi.mocked(api.post);

afterEach(cleanup);

beforeEach(() => {
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({
    data: { total: 4, audience: 'ALL', owing: 2, queued: 2, skippedPaid: 1, skippedNoPhone: 1, skippedOtherBill: 0, autoSend: false },
  });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

function renderButton(props: Partial<Parameters<typeof BulkReminderButton>[0]> = {}) {
  return render(
    <ToastProvider>
      <BulkReminderButton owingCount={2} onSent={() => {}} {...props} />
    </ToastProvider>,
  );
}

describe('BulkReminderButton', () => {
  it('names the owing count in the label', () => {
    renderButton({ owingCount: 7 });
    expect(screen.getByRole('button', { name: /Remind 7 owing/ })).toBeInTheDocument();
  });

  it('disables itself when nobody owes, so no empty blast can go out', () => {
    renderButton({ owingCount: 0 });
    expect(screen.getByRole('button', { name: /Nobody owes/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Nobody owes/ }));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('posts once to the bulk endpoint and reports the queue result', async () => {
    let sent = 0;
    renderButton({ onSent: () => { sent += 1; } });

    fireEvent.click(screen.getByRole('button', { name: /Remind 2 owing/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));

    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    // The audience rides the body — the server derives WHO from the live
    // ledger, never a client-side selection that could include a paid tenant.
    expect(url).toBe('/api/sms/reminders/bulk-arrears');
    expect(body).toEqual({ audience: 'ALL' });
    expect(sent).toBe(1);
    expect(await screen.findByText(/2 queued/)).toBeInTheDocument();
  });

  it('aborts when the wallet confirm is dismissed', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /Remind 2 owing/ }));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('renders without a ToastProvider — only the pop-up degrades', () => {
    render(<BulkReminderButton owingCount={3} />);
    expect(screen.getByRole('button', { name: /Remind 3 owing/ })).toBeInTheDocument();
  });

  it('posts the chosen audience when the picker selects rent debtors', async () => {
    render(
      <ToastProvider>
        <BulkReminderButton owingCount={5} audienceCounts={{ rent: 4, water: 1 }} showAudiencePicker onSent={() => {}} />
      </ToastProvider>,
    );
    // Picker labels carry each group's count.
    expect(screen.getByRole('option', { name: /Everyone owing \(5\)/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Rent owing \(4\)/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Water owing \(1\)/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reminder audience'), { target: { value: 'RENT' } });
    expect(screen.getByRole('button', { name: /Remind 4 owing rent/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Remind 4 owing rent/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/sms/reminders/bulk-arrears');
    expect(body).toEqual({ audience: 'RENT' });
  });

  it('reports water-only skips in the rent-audience toast', async () => {
    mockedPost.mockResolvedValue({
      data: { total: 4, audience: 'RENT', owing: 2, queued: 2, skippedPaid: 0, skippedNoPhone: 0, skippedOtherBill: 1, autoSend: false },
    });
    render(
      <ToastProvider>
        <BulkReminderButton owingCount={5} showAudiencePicker defaultAudience="RENT" onSent={() => {}} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Remind owing rent/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/owe only water/)).toBeInTheDocument();
  });
});
