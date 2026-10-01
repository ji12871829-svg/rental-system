// The dashboard strip must stay silent unless there is something to act on:
// a fetch error (401 with the webhook feature off / 403 for non-admins) and
// an all-clear list both render NOTHING — the dashboard must not grow a
// permanently-green vanity card. Only pending refusals produce a card, and
// that card must link to the review page. vi.mock stands in for the api
// module so no auth/network is involved.
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ClerkSignupsStats } from './ClerkSignupsStats';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

function row(overrides: Record<string, unknown> = {}) {
  return {
    external_id: 'user_test_a',
    email: 'someone@rpms.local',
    reason: 'no matching active staff user',
    refused_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    refusals: 2,
    linked_user_id: null,
    ...overrides,
  };
}

// The route wraps the payload in the standard { data } envelope — the same
// shape the real HTTP client hands the component (mocking the client, not
// the wire, must still respect that contract).
function envelope(rows: Record<string, unknown>[]) {
  return { data: { signups: rows, recentLogins: { total: 4, clerk: 1 } } };
}

function renderStrip() {
  return render(
    <MemoryRouter>
      <ClerkSignupsStats />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClerkSignupsStats (dashboard strip)', () => {
  it('renders nothing while the fetch fails (feature off or non-admin)', async () => {
    mockedGet.mockRejectedValueOnce(new Error('You do not have permission to perform this action.'));    const { container } = renderStrip();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when every refused sign-up has since been linked', async () => {
    mockedGet.mockResolvedValueOnce(envelope([row({ linked_user_id: 7 })]));
    const { container } = renderStrip();
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a deep-linking card when pending refusals exist', async () => {
    mockedGet.mockResolvedValueOnce(envelope([
      row({ external_id: 'user_test_a', email: 'a@rpms.local', refused_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(), refusals: 2 }),
      row({ external_id: 'user_test_b', email: 'b@rpms.local', refused_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), refusals: 1 }),
    ]));
    renderStrip();
    await waitFor(() => expect(screen.getByText('Clerk sign-ups')).toBeInTheDocument());
    // 2 pending identities, 3 total failed attempts (the attempts figure is
    // its own <span>, so match the composed line by textContent), and a link
    // to the page that fixes them.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === '3 failed attempts')).toBeInTheDocument();
    expect(screen.getByText('Review sign-ups →')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review sign-ups/i })).toHaveAttribute('href', '/clerk-signups');
    // The "last attempt" line quotes the most recent refusal (a@…, 3m ago).
    expect(screen.getByText(/Last attempt 3m ago/)).toBeInTheDocument();
  });

  it('goes silent again once the pending list clears (fresh mount = fresh data)', async () => {
    mockedGet.mockResolvedValueOnce(envelope([row()]));
    const first = renderStrip();
    await waitFor(() => expect(screen.getByText(/not mapped/)).toBeInTheDocument());
    first.unmount();

    // Everything has since been linked → the next mount renders nothing
    // rather than a vanity card showing zeros.
    mockedGet.mockResolvedValue(envelope([row({ linked_user_id: 7 })]));
    const { container } = renderStrip();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });
});
