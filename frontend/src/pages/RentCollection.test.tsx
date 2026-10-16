// RentCollection hides the STK prompt button unless M-Pesa is live.
// Mock mode answers success without sending anything to the tenant's phone,
// so a Send-Money operator must never see a button that pretends to prompt:
// they get a note pointing at manual recording instead.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import RentCollection from './RentCollection';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), list: vi.fn() },
  authenticatedFetch: vi.fn(),
  apiUrl: (p: string) => p,
  qs: () => '',
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ isAdmin: true, isManager: true, canManage: true, user: null }),
}));

const mockedGet = vi.mocked(api.get);
const mockedList = vi.mocked(api.list);

afterEach(cleanup);

function mockBackend(mpesaLive: boolean) {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/mpesa/config') {
      return Promise.resolve({ data: { provider: mpesaLive ? 'daraja' : 'mock', live: mpesaLive } });
    }
    if (url === '/api/reports/arrears') return Promise.resolve({ data: [] });
    if (url === '/api/settings') return Promise.resolve({ data: { reporting_year: 2026 } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  mockedList.mockResolvedValue({ data: [], pagination: { page: 1, totalPages: 1, total: 0, limit: 100 } });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RentCollection />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('RentCollection (STK prompt availability)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedList.mockReset();
  });

  it('hides the prompt button and explains manual recording when M-Pesa is not live', async () => {
    mockBackend(false);
    renderPage();
    await screen.findByRole('button', { name: 'Record Rent Payment' });
    expect(screen.queryByRole('button', { name: /Send M-Pesa Prompt/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/record the payment here once it lands/)).toBeInTheDocument();
  });

  it('shows the prompt button when M-Pesa is live', async () => {
    mockBackend(true);
    renderPage();
    await screen.findByRole('button', { name: 'Record Rent Payment' });
    expect(await screen.findByRole('button', { name: /Send M-Pesa Prompt/ })).toBeInTheDocument();
    expect(screen.queryByText(/record the payment here once it lands/)).not.toBeInTheDocument();
  });
});
