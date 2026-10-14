// The reading form's live preview must show the exact charge the server will
// bill: units = current − previous, bill = units × the Settings water rate
// (200). BillPreview is pure props-in/text-out, so these tests need no API
// mocks — they pin the arithmetic and the three states (idle hint, computed
// bill, below-previous rejection) against computeWaterBill's contract.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BillPreview } from './Water';

afterEach(cleanup);

describe('BillPreview (meter reading charge)', () => {
  it('explains the formula, naming the live rate, before anything is typed', () => {
    render(<BillPreview current={null} previous={null} rate={200} />);
    expect(screen.getByText(/bill is calculated as/)).toBeInTheDocument();
    expect(screen.getByText(/KSh 200/)).toBeInTheDocument();
  });

  it('multiplies the units used by 200: 130 − 125 bills KSh 1,000', () => {
    render(<BillPreview current={130} previous={125} rate={200} />);
    expect(screen.getByText('5 units used')).toBeInTheDocument();
    expect(screen.getByText(/KSh 1,000/)).toBeInTheDocument();
  });

  it('measures a first reading from zero and says so', () => {
    render(<BillPreview current={12.5} previous={null} rate={200} />);
    expect(screen.getByText('12.5 units used')).toBeInTheDocument();
    expect(screen.getByText(/KSh 2,500/)).toBeInTheDocument();
    expect(screen.getByText(/first reading, measured from zero/)).toBeInTheDocument();
  });

  it('warns instead of a bill when the current reading is below the previous', () => {
    render(<BillPreview current={120} previous={125} rate={200} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/below the previous reading/);
    expect(screen.queryByText(/units used/)).not.toBeInTheDocument();
  });

  it('still shows the units when the rate is still loading, with an ellipsis for the bill', () => {
    render(<BillPreview current={130} previous={125} rate={null} />);
    expect(screen.getByText('5 units used')).toBeInTheDocument();
  });
});
