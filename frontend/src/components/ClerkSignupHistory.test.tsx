// The history modal renders one timeline entry per lifecycle audit row,
// newest first, with the flavor spelled out (not a raw event code) and the
// actor shown (admin name vs "system"). The api module is mocked; the
// envelope matches the wire ({ data: [...] }).
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ClerkSignupHistory, ClerkSignupRow } from './ClerkSignupHistory';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

const ROW: ClerkSignupRow = {
  external_id: 'user_test_hist',
  email: 'someone@rpms.local',
  reason: 'no verified email',
  refused_at: new Date().toISOString(),
  refusals: 1,
  linked_user_id: null,
  linked_user_name: null,
  linked_user_email: null,
  linked_at: null,
};

beforeEach(() => {
  mockedGet.mockReset();
});

describe('ClerkSignupHistory (per-identity timeline)', () => {
  it('renders nothing fetchable when closed (no request fired)', async () => {
    mockedGet.mockResolvedValueOnce({ data: [] });
    render(<ClerkSignupHistory row={null} onClose={() => {}} />);
    // Modal closed → the fetcher resolved undefined without calling api.
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('lists the lifecycle newest-first with flavors and actors spelled out', async () => {
    const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
    mockedGet.mockResolvedValueOnce({
      data: [
        { id: 3, action: 'CLERK_UNLINKED', user_id: null, user_name: null, created_at: t(1), new_value: { event: 'email_mismatch', old_email: 'a@x.test', new_email: 'b@x.test' } },
        { id: 2, action: 'CLERK_LINKED', user_id: 7, user_name: 'Juma Admin', created_at: t(5), new_value: { event: 'admin_link' } },
        { id: 1, action: 'CLERK_LINK_REFUSED', user_id: null, user_name: null, created_at: t(10), new_value: { reason: 'no verified email' } },
      ],
    });
    render(<ClerkSignupHistory row={ROW} onClose={() => {}} />);

    await waitFor(() => expect(screen.getByText('CLERK_UNLINKED')).toBeInTheDocument());
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('CLERK_UNLINKED'),
      expect.stringContaining('CLERK_LINKED'),
      expect.stringContaining('CLERK_LINK_REFUSED'),
    ]);
    // Flavors in plain language, with the email transition for mismatches.
    expect(screen.getByText(/verified email stopped matching \(a@x\.test → b@x\.test\)/)).toBeInTheDocument();
    expect(screen.getByText('Mapping created by an admin')).toBeInTheDocument();
    expect(screen.getByText(/Webhook could not map — no verified email/)).toBeInTheDocument();
    // Actor: the admin's name on the link row, "system" on webhook rows.
    expect(screen.getByText(/Juma Admin/)).toBeInTheDocument();
    expect(screen.getAllByText(/system/).length).toBe(2);
  });

  it('shows the empty state for an identity with no events', async () => {
    mockedGet.mockResolvedValueOnce({ data: [] });
    render(<ClerkSignupHistory row={ROW} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No lifecycle events recorded/)).toBeInTheDocument());
  });
});
