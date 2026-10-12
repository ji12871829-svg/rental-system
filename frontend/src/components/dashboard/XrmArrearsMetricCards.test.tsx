// The metric-row action buttons are plain <Link>s whose layout lives entirely
// in Tailwind utilities (jsdom runs with css: false, so the contract IS the
// class list). Two defects this guards, both visible as a broken button in the
// dashboard's dark theme:
//   1. Tailwind preflight renders `svg { display: block }`, so a label +
//      ArrowRight link that is not a flex container drops the arrow onto a
//      second line (and stretches the whole action row to match).
//   2. The Tenant Advance action row must be a flex row. A bare wrapper div
//      leaves the `flex-1` link inline, and the block-level svg then splits
//      that inline box in two: a narrow first fragment with the label and a
//      stray empty border fragment underneath — the "cut off" button.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { DashboardData } from '@rpms/shared';
import { XrmArrearsMetricCards } from './XrmArrearsMetricCards';

function data(combined: Partial<DashboardData['combined']> = {}) {
  return {
    combined: {
      totalDueThisMonth: 0,
      totalCollected: 0,
      totalOutstanding: 5500,
      rentCollected: 0,
      waterCollected: 0,
      totalExpenses: 0,
      netIncome: 0,
      ...combined,
    },
    currency: 'KSh',
    reportingYear: 2026,
    outstandingRentUnits: 1,
  };
}

function renderCards(props = data()) {
  return render(
    <MemoryRouter>
      <XrmArrearsMetricCards data={props} />
    </MemoryRouter>,
  );
}

describe('XrmArrearsMetricCards (dashboard metric row)', () => {
  it('shows arrears and per-tenant advance figures with their action links', () => {
    renderCards(data({ tenantAdvances: { count: 1, total: 2500 } }));

    expect(screen.getByText('KSh 5,500')).toBeInTheDocument();
    expect(screen.getByText('KSh 2,500')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.textContent === '1 Tenants with credit balances')).toBeInTheDocument();

    const details = screen.getAllByRole('link', { name: /view details/i });
    expect(details[0]).toHaveAttribute('href', '/arrears');
    expect(details[1]).toHaveAttribute('href', '/tenants');
    expect(screen.getByRole('link', { name: /send reminders/i })).toHaveAttribute('href', '/sms?compose=arrears');
  });

  it('keeps each label and its arrow on one line (links are flex containers)', () => {
    renderCards();

    for (const link of screen.getAllByRole('link', { name: /view details/i })) {
      expect(link).toHaveClass('flex', 'items-center');
    }
  });

  it('lays the Tenant Advance action out as a flex row, not a bare wrapper div', () => {
    renderCards();

    const advanceDetails = screen.getAllByRole('link', { name: /view details/i })[1];
    expect(advanceDetails).toHaveClass('flex-1');
    expect(advanceDetails.parentElement).toHaveClass('flex', 'gap-2');
  });
});
