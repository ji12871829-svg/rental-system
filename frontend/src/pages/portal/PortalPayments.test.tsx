// PortalPayments hides PayBill account references unless a PayBill is
// configured: Send-Money tenants get the number plus a no-reference note,
// never copy rows for references that do not exist.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { portalApi } from '../../lib/portalApi';
import PortalPayments from './PortalPayments';

vi.mock('../../lib/portalApi', () => ({
  portalApi: { get: vi.fn() },
}));

const mockedGet = vi.mocked(portalApi.get);

afterEach(cleanup);

function mockPortal(instructions: Record<string, unknown>) {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/portal/payment-instructions') return Promise.resolve({ data: instructions });
    if (url === '/api/portal/summary') return Promise.resolve({ data: { currency: 'KSh' } });
    if (url === '/api/portal/payments') return Promise.resolve({ data: [] });
    if (url === '/api/portal/payment-status') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalPayments />
    </MemoryRouter>,
  );
}

const BASE = {
  businessName: 'Olbano Plaza',
  number: '0743799002',
  accountName: null,
  instructions: null,
  rentReference: '5',
  waterReference: '5-WATER',
  rentBalance: 10000,
  waterBalance: 800,
};

describe('PortalPayments (paybill references)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('shows no account references in Send-Money mode', async () => {
    mockPortal({ ...BASE, paybillActive: false });
    renderPage();
    await screen.findByText('0743799002');
    expect(screen.queryByRole('button', { name: 'Copy Rent account' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Water account' })).not.toBeInTheDocument();
    expect(await screen.findByText(/no account reference/)).toBeInTheDocument();
  });

  it('shows the references while a PayBill is configured', async () => {
    mockPortal({ ...BASE, paybillActive: true, accountName: 'Olbano' });
    renderPage();
    await screen.findByText('0743799002');
    expect(await screen.findByRole('button', { name: 'Copy Rent account' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Copy Water account' })).toBeInTheDocument();
    expect(screen.queryByText(/no account reference/)).not.toBeInTheDocument();
  });
});
