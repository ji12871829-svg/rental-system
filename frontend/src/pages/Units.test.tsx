// Editing Room 12's rent must not trip the "non-negative rent" guard.
//
// Regression: UnitForm's useState initializers ran once per mount while the
// form component stayed mounted across Add/Edit opens — so the Unit Number
// field was empty (the Add-form default) when editing any unit, and every
// save died in the client-side guard with "Unit number and a non-negative
// rent are required.", even though the operator only touched the rent.
// Two guards now cover it:
//   1. the form remounts per unit and per open (key={edit?.id ?? 'new'}),
//      so each edit starts from that unit's own values, and
//   2. the save guard rejects NaN: a half-typed "-" in the number input
//      makes Number(...) NaN, and NaN < 0 is false, so it used to sail past
//      the guard and arrive at the API as null.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import Units from './Units';

// jsdom lacks the Web Animations API that Modal's shake-on-error uses —
// stub it so the validation-failure path can render without crashing.
beforeAll(() => {
  if (typeof Element.prototype.getAnimations !== 'function') {
    Element.prototype.getAnimations = () => [];
  }
  if (typeof Element.prototype.animate !== 'function') {
    Element.prototype.animate = () => ({ cancel: () => {} }) as unknown as Animation;
  }
});

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ canManage: true, isAdmin: true }),
}));

const mockedList = vi.mocked(api.list);
const mockedPut = vi.mocked(api.put);

afterEach(cleanup);

function unitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    unit_number: '12',
    unit_type: 'Room',
    monthly_rent: '3500',
    water_enabled: false,
    occupancy_status: 'VACANT',
    floor_number: 1,
    floor_name: 'First Floor',
    tenant_name: null,
    tenant_id: null,
    phone_number: null,
    ...overrides,
  };
}

const ROOM12 = unitRow();
const ROOM5 = unitRow({
  id: 5,
  unit_number: '5',
  unit_type: 'Bedsitter',
  monthly_rent: '5000',
  water_enabled: true,
  occupancy_status: 'OCCUPIED',
  tenant_name: 'Alice A',
  tenant_id: 10,
  phone_number: '0714000001',
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Units />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function openEdit(unitNumber: string) {
  const cell = screen.getByText(unitNumber, { selector: 'td' });
  const row = cell.closest('tr');
  if (!row) throw new Error(`unit ${unitNumber} row not found`);
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
}

beforeEach(() => {
  mockedList.mockReset();
  mockedPut.mockReset();
  mockedList.mockResolvedValue({
    data: [ROOM12, ROOM5],
    pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
  });
  mockedPut.mockResolvedValue({ data: {} });
});

describe('Units (edit a unit)', () => {
  it("editing Room 12 starts from Room 12's values and saves them", async () => {
    renderPage();
    await screen.findByText('12', { selector: 'td' });

    openEdit('12');
    await screen.findByText('Edit Unit 12');

    expect(screen.getByLabelText('Unit Number')).toHaveValue('12');
    expect(screen.getByLabelText(/Monthly Rent/)).toHaveValue(3500);

    fireEvent.change(screen.getByLabelText(/Monthly Rent/), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));

    expect(mockedPut.mock.calls[0][0]).toBe('/api/units/12');
    expect(mockedPut.mock.calls[0][1]).toMatchObject({ unitNumber: '12', monthlyRent: 4000 });
  });

  it('editing a second unit shows its values, not the first unit\'s', async () => {
    renderPage();
    await screen.findByText('12', { selector: 'td' });

    // Edit Room 12 first, then back out…
    openEdit('12');
    await screen.findByText('Edit Unit 12');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // …then edit Room 5: every field must be hers, not left over.
    openEdit('5');
    await screen.findByText('Edit Unit 5');

    expect(screen.getByLabelText('Unit Number')).toHaveValue('5');
    expect(screen.getByLabelText(/Monthly Rent/)).toHaveValue(5000);
  });

  it('rejects a half-typed rent client-side instead of sending null', async () => {
    renderPage();
    await screen.findByText('12', { selector: 'td' });

    openEdit('12');
    await screen.findByText('Edit Unit 12');

    // "-" sanitizes to "" in a number input, which the form maps to NaN —
    // and NaN < 0 is false, so the old guard let it through.
    fireEvent.change(screen.getByLabelText(/Monthly Rent/), { target: { value: '-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Unit number and a non-negative rent are required.');
    expect(mockedPut).not.toHaveBeenCalled();
  });
});
