// The security card must stay silent unless there is something to act on:
// fetch errors (non-admin / endpoint absent) and a clean week render
// NOTHING — the dashboard must not grow a permanent "all clear" card. Only
// actual anomalies produce the red deep-link card. vi.mock stands in for the
// api module; the envelope matches what the wire really delivers ({ data }).
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SecurityAnomaliesStats } from './SecurityAnomaliesStats';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

function anomaly(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'mixed_path',
    userId: 12,
    userEmail: 'suspect@rpms.local',
    firstAction: 'LOGIN',
    secondAction: 'LOGIN_CLERK',
    firstIp: '198.51.100.1',
    secondIp: '198.51.100.2',
    at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function envelope(mixedPath: unknown[], distinctIp: unknown[]) {
  return { data: { mixedPath, distinctIp } };
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe('SecurityAnomaliesStats (dashboard card)', () => {
  it('renders nothing while the fetch fails (non-admin / endpoint absent)', async () => {
    mockedGet.mockRejectedValueOnce(new Error('You do not have permission to perform this action.'));
    const { container } = render(
      <MemoryRouter>
        <SecurityAnomaliesStats />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on a clean week', async () => {
    mockedGet.mockResolvedValueOnce(envelope([], []));
    const { container } = render(
      <MemoryRouter>
        <SecurityAnomaliesStats />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the red card with per-kind counts and a deep link to the audit trail', async () => {
    mockedGet.mockResolvedValueOnce(
      envelope(
        [anomaly()],
        [anomaly({ kind: 'distinct_ip', userEmail: 'other@rpms.local', at: new Date(Date.now() - 60 * 60 * 1000).toISOString() })],
      ),
    );
    render(
      <MemoryRouter>
        <SecurityAnomaliesStats />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Session anomalies')).toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument(); // total this week
    // The counts are their own <span>s — match the composed lines.
    expect(screen.getByText((_, el) => el?.textContent === '1 mixed Clerk/password')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === '1 distinct-IP')).toBeInTheDocument();
    // Most recent line quotes the newest anomaly (the 5-minute-old one).
    expect(screen.getByText(/Most recent 5m ago/)).toBeInTheDocument();
    expect(screen.getByText(/suspect@rpms\.local/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open audit trail/i });
    expect(link).toHaveAttribute('href', '/audit');
  });
});
