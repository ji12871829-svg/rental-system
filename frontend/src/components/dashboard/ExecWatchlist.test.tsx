// The watchlist's empty state has to tell the truth about WHY it is empty.
// "No rows match this filter — try a different status or clear the search" is
// only actionable when a search or status filter is actually hiding rows; on a
// property where everyone is paid up it is a dead end that blames the operator
// for a filter they never touched. The subtitle above the table already states
// the open-balance count, so these tests pin the two messages to the two
// genuinely different situations, plus the "no rows at all" case that is owned
// by the block above the table.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecWatchlist } from './ExecWatchlist';
import type { ArrearRow } from '../../pages/Arrears';

// Vitest globals are off, so Testing Library cannot register its own
// auto-cleanup — without this each test's table stays in document.body and
// queries match several at once.
afterEach(cleanup);

function row(overrides: Partial<ArrearRow> = {}): ArrearRow {
  return {
    unitId: 53,
    unitNumber: '2',
    floor: 'First Floor',
    tenantId: 10,
    tenantName: 'Dago Bogala',
    phoneNumber: '0714926636',
    monthlyRent: 2500,
    waterBill: 0,
    totalAmountDue: 2500,
    rentPaid: 5000,
    waterPaid: 0,
    totalPaid: 5000,
    rentBalance: -2500,
    waterBalance: 0,
    totalOutstanding: -2500,
    monthsInArrears: 0,
    status: 'OVERPAID',
    ...overrides,
  };
}

function renderWatchlist(props: Partial<Parameters<typeof ExecWatchlist>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ExecWatchlist rows={[]} loading={false} currency="KSh" {...props} />
    </MemoryRouter>,
  );
}

describe('ExecWatchlist (empty states)', () => {
  it('says everyone is paid up when rows exist but none has an open balance', () => {
    // The exact live-production shape: one tenant, overpaid, so the default
    // "Open balances" filter keeps nothing. No search or status was applied.
    renderWatchlist({ rows: [row()] });
    expect(
      screen.getByText('No open balances right now — every tenant on the books is paid up.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No rows match this filter/)).not.toBeInTheDocument();
    expect(screen.getByText('0 tenants with an open balance, in unit order')).toBeInTheDocument();
  });

  it('blames the filter only once a filter is actually hiding rows', () => {
    renderWatchlist({
      // Internally consistent balances: the 5500 owed sits on the rent side,
      // which is what the "Open balances" audience reads.
      rows: [row({ status: 'OVERDUE', rentBalance: 5500, totalOutstanding: 5500, tenantName: 'Juma Ibrahim' })],
    });
    // Default view (Open balances) shows the row.
    expect(screen.getByText('Juma Ibrahim')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search the arrears watchlist'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No rows match this filter — try a different status or clear the search.')).toBeInTheDocument();
  });

  it('points at the status filter when that filter is what emptied the table', () => {
    renderWatchlist({ rows: [row()] }); // only an OVERPAID tenant exists

    // A deliberately chosen status that matches nobody is a real filter, so
    // the message may correctly send the operator back to the dropdown.
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'OVERDUE' } });
    expect(screen.getByText('No rows match this filter — try a different status or clear the search.')).toBeInTheDocument();
  });

  it('shows the row when the chosen status does match', () => {
    renderWatchlist({ rows: [row()] });

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'OVERPAID' } });
    expect(screen.getByText('Dago Bogala')).toBeInTheDocument();
    expect(screen.queryByText(/No rows match this filter/)).not.toBeInTheDocument();
  });

  it('renders the no-rows-at-all state from the block above the table', () => {
    renderWatchlist({ rows: [] });
    expect(
      screen.getByText('No arrears data yet — record a payment or add a tenant to populate this watchlist.'),
    ).toBeInTheDocument();
  });

  it('shows the loading skeleton rather than an empty state while fetching', () => {
    const { container } = renderWatchlist({ rows: null, loading: true });
    expect(screen.queryByText(/No open balances right now/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No arrears data yet/)).not.toBeInTheDocument();
    expect(screen.getByText('Loading balances…')).toBeInTheDocument();
    // SkeletonTable renders its own <table>; the pulse placeholders are what
    // distinguishes "still fetching" from a real (empty) table.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });
});

describe('ExecWatchlist (unit order and row numbers)', () => {
  // Balances sit on the rent side (consistent with each totalOutstanding) —
  // that is the audience the default "Open balances" filter reads.
  const debtors = [
    row({ unitId: 112, unitNumber: '12', tenantId: 21, tenantName: 'Twelve Tenant', status: 'UNPAID', rentBalance: 12000, totalOutstanding: 12000 }),
    row({ unitId: 109, unitNumber: '9', tenantId: 22, tenantName: 'Nine Tenant', status: 'UNPAID', rentBalance: 9000, totalOutstanding: 9000 }),
    row({ unitId: 102, unitNumber: '2', tenantId: 23, tenantName: 'Two Tenant', status: 'UNPAID', rentBalance: 2000, totalOutstanding: 2000 }),
  ];

  function renderDebtors() {
    return render(
      <MemoryRouter>
        <ExecWatchlist rows={debtors} loading={false} currency="KSh" />
      </MemoryRouter>,
    );
  }

  it('lists debtors in numeric unit order even when balances run the other way', () => {
    renderDebtors();
    // Balances descend 12k → 9k → 2k, but units must read 2, 9, 12
    // (string sort would put 12 first — the numeric-aware compare matters).
    expect(screen.getAllByText(/Unit \d+/).map((el) => el.textContent)).toEqual([
      'Unit 2',
      'Unit 9',
      'Unit 12',
    ]);
  });

  it('numbers every visible row from 1 in the first column', () => {
    const { container } = renderDebtors();
    const firstCells = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelector('td')?.textContent,
    );
    expect(firstCells).toEqual(['1', '2', '3']);
  });
});
