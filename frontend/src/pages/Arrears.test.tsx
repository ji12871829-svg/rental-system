// The arrears table defaults to numeric unit order (Unit 2 before Unit 9
// before Unit 12) with a running row number — the operator walks the
// building in unit order, and the list mirrors it. Highest-balance and
// months views stay one click away in the sort dropdown.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import Arrears from './Arrears';
import type { ArrearRow } from './Arrears';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

afterEach(cleanup);

function row(overrides: Partial<ArrearRow> = {}): ArrearRow {
  return {
    unitId: 1,
    unitNumber: '1',
    floor: 'First Floor',
    tenantId: 1,
    tenantName: 'Tenant',
    phoneNumber: '0700000000',
    monthlyRent: 3000,
    waterBill: 0,
    totalAmountDue: 3000,
    rentPaid: 0,
    waterPaid: 0,
    totalPaid: 0,
    rentBalance: 3000,
    waterBalance: 0,
    totalOutstanding: 3000,
    monthsInArrears: 1,
    status: 'UNPAID',
    ...overrides,
  };
}

// Deliberately balance-descending so only unit ordering can explain the view.
const ROWS = [
  row({ unitId: 112, unitNumber: '12', tenantId: 21, tenantName: 'Twelve Tenant', totalOutstanding: 12000, rentBalance: 12000 }),
  row({ unitId: 109, unitNumber: '9', tenantId: 22, tenantName: 'Nine Tenant', totalOutstanding: 9000, rentBalance: 9000 }),
  row({ unitId: 102, unitNumber: '2', tenantId: 23, tenantName: 'Two Tenant', totalOutstanding: 2000, rentBalance: 2000 }),
];

beforeEach(() => {
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ data: ROWS });
});

describe('Arrears (unit order and row numbers)', () => {
  it('defaults to numeric unit order with a running number per row', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <Arrears />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('Twelve Tenant');

    const bodyRows = [...document.querySelectorAll('tbody tr td:nth-child(2)')];
    expect(bodyRows.map((td) => td.textContent)).toEqual([
      'Unit 2',
      'Unit 9',
      'Unit 12',
    ]);
    expect(
      [...document.querySelectorAll('tbody tr td:first-child')].map((td) => td.textContent),
    ).toEqual(['1', '2', '3']);
  });
});
