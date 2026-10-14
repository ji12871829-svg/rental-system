// Editing an ACTIVE tenant must never trip the occupancy guard.
//
// Regression: TenantForm always sent `unitId` on save, and its useState
// initializers ran once per mount — so editing tenant B right after tenant A
// submitted A's unit id for B. When that unit was occupied, the backend
// correctly refused with "Unit X already has an active tenant.", but the
// operator only ever touched contact fields. Two guards now cover it:
//   1. the form remounts per tenant and per open (no stale selection), and
//   2. an untouched unit selection is omitted from the PUT body entirely,
//      so the occupancy check only runs when the operator really re-assigns.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import Tenants from './Tenants';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ canManage: true, isAdmin: true }),
}));

vi.mock('../components/DataRequestLetter', () => ({
  DataRequestLetterModal: () => null,
}));

const mockedList = vi.mocked(api.list);
const mockedPut = vi.mocked(api.put);

afterEach(cleanup);

function tenantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    full_name: 'Alice A',
    phone_number: '0714000001',
    email: 'alice@example.com',
    move_in_date: '2026-01-05',
    move_out_date: null,
    security_deposit: '5000',
    status: 'ACTIVE',
    unit_number: '5',
    unit_type: '1BR',
    monthly_rent: '2500',
    water_enabled: false,
    rent_deadline: '2026-10-15',
    current_month_rent_paid: '2500',
    current_month_rent_status: 'PAID',
    has_rent_payment_history: true,
    notes: null,
    balances: {
      reportingYear: 2026,
      rentPaid: 2500,
      rentBalance: 0,
      waterBilled: 0,
      waterPaid: 0,
      waterBalance: 0,
      combinedBalance: 0,
    },
    ...overrides,
  };
}

const ALICE = tenantRow();
const BOB = tenantRow({
  id: 11,
  full_name: 'Bob B',
  phone_number: '0714000002',
  email: 'bob@example.com',
  unit_number: '2',
});

const UNITS = [
  { id: 5, unit_number: '5', occupancy_status: 'OCCUPIED' },
  { id: 2, unit_number: '2', occupancy_status: 'OCCUPIED' },
  { id: 7, unit_number: '7', occupancy_status: 'VACANT' },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Tenants />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function openEdit(name: string) {
  fireEvent.change(screen.getByLabelText(`Actions for ${name}`), { target: { value: 'edit' } });
}

beforeEach(() => {
  mockedList.mockReset();
  mockedPut.mockReset();
  mockedList.mockImplementation((url: string) => {
    if (url.startsWith('/api/units')) {
      return Promise.resolve({ data: UNITS, pagination: { page: 1, limit: 100, total: 3, totalPages: 1 } });
    }
    if (url.startsWith('/api/tenants')) {
      return Promise.resolve({ data: [ALICE, BOB], pagination: { page: 1, limit: 25, total: 2, totalPages: 1 } });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
  mockedPut.mockResolvedValue({ data: {} });
});

describe('Tenants (edit an active tenant)', () => {
  it('saves a contact-only edit without sending the unit, so the occupancy guard cannot fire', async () => {
    renderPage();
    await screen.findByText('Alice A');

    openEdit('Alice A');
    await screen.findByText('Edit Alice A');
    // Units loaded and Alice's own room resolved — still an occupied unit,
    // which is exactly what used to be re-asserted on save.
    await screen.findByText('Unit 5 (occupied)');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));

    expect(mockedPut.mock.calls[0][0]).toBe('/api/tenants/10');
    // The untouched selection stays out of the body: the backend's
    // "already has an active tenant" check only runs on re-assignment.
    expect(mockedPut.mock.calls[0][1]).not.toHaveProperty('unitId');
  });

  it('shows the newly picked tenant — not the previously edited one — including the unit', async () => {
    renderPage();
    await screen.findByText('Alice A');

    // Edit Alice first, then back out…
    openEdit('Alice A');
    await screen.findByText('Edit Alice A');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // …then edit Bob: every field must be his, especially the unit.
    openEdit('Bob B');
    await screen.findByText('Edit Bob B');
    await screen.findByText('Unit 2 (occupied)');

    expect(screen.getByLabelText('Phone')).toHaveValue('0714000002');
    // Bob's room (id 2), not Alice's (id 5) left over from the last mount.
    // (The Unit label carries its hint text too, so match by substring.)
    expect(screen.getByLabelText(/Unit/)).toHaveValue('2');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
    expect(mockedPut.mock.calls[0][0]).toBe('/api/tenants/11');
    expect(mockedPut.mock.calls[0][1]).not.toHaveProperty('unitId');
  });

  it('still sends the unit when the operator really picks a different, vacant one', async () => {
    renderPage();
    await screen.findByText('Bob B');

    openEdit('Bob B');
    await screen.findByText('Edit Bob B');
    await screen.findByText('Unit 7 (vacant)');

    fireEvent.change(screen.getByLabelText(/Unit/), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));

    expect(mockedPut.mock.calls[0][0]).toBe('/api/tenants/11');
    expect(mockedPut.mock.calls[0][1]).toHaveProperty('unitId', 7);
  });
});
