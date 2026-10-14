// The reading form's live preview must show the exact charge the server will
// bill: units = current − previous, bill = units × the Settings water rate
// (200). BillPreview is pure props-in/text-out, so these tests need no API
// mocks — they pin the arithmetic and the three states (idle hint, computed
// bill, below-previous rejection) against computeWaterBill's contract.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import { BillPreview, ReadingForm } from './Water';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);
const mockedList = vi.mocked(api.list);

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

// A meter-reading round: the operator walks the meters once, then punches
// the readings in unit after unit. The reading date and billing month are
// set ONCE and carried across saves, so every tenant's reading for the
// month shares one uniform date — only the unit and current reading reset.
describe('ReadingForm (round entry)', () => {
  const UNITS = [
    { id: 14, unit_number: '14', unit_type: 'Room', tenant_name: 'Lewis M', last_reading_date: null },
    { id: 15, unit_number: '15', unit_type: 'Room', tenant_name: 'Amina K', last_reading_date: null },
  ];

  function renderForm() {
    return render(
      <ToastProvider>
        <ReadingForm open units={UNITS} prefillUnitId={null} onClose={() => {}} onSaved={() => {}} />
      </ToastProvider>,
    );
  }

  function setSelect(label: string | RegExp, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  beforeEach(() => {
    mockedGet.mockReset();
    mockedPost.mockReset();
    mockedList.mockReset();
    mockedGet.mockImplementation((url: string) => {
      if (url === '/api/settings') return Promise.resolve({ data: { water_rate: 200, reporting_year: 2026 } });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    // No previous readings — every save bills from the typed current value.
    mockedList.mockImplementation((url: string) => {
      if (url.startsWith('/api/water/readings')) {
        return Promise.resolve({ data: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 0 } });
      }
      return Promise.reject(new Error(`unexpected LIST ${url}`));
    });
    mockedPost.mockImplementation((_path: string, body?: unknown) => {
      const b = body as Record<string, unknown>;
      return Promise.resolve({
        data: {
          firstReading: false,
          waterBill: 200 * Number(b.currentReading ?? 0),
          unitNumber: String(b.unitId),
        },
      });
    });
  });

  it('carries the round date and month across saves while the unit resets', async () => {
    renderForm();

    setSelect('Unit (water-enabled only)', '14');
    fireEvent.change(screen.getByLabelText('Reading Date'), { target: { value: '2026-10-05' } });
    setSelect('Billing Month', '10');
    fireEvent.change(screen.getByLabelText('Current Reading'), { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Reading' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][1]).toMatchObject({ unitId: 14, readingDate: '2026-10-05', billingMonth: 10 });

    // Round state: unit + reading reset for the next tenant, date/month kept.
    expect(screen.getByLabelText('Unit (water-enabled only)')).toHaveValue('');
    expect(screen.getByLabelText('Current Reading')).toHaveValue(null);
    expect(screen.getByLabelText('Reading Date')).toHaveValue('2026-10-05');
    expect(screen.getByText(/Round in progress/)).toHaveTextContent(/1 recorded/);

    setSelect('Unit (water-enabled only)', '15');
    fireEvent.change(screen.getByLabelText('Current Reading'), { target: { value: '140' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next Unit' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));

    // Uniform date and month on both saves — the tenant rows cannot drift.
    expect(mockedPost.mock.calls[1][1]).toMatchObject({ unitId: 15, readingDate: '2026-10-05', billingMonth: 10 });
    expect(screen.getByText(/Round in progress/)).toHaveTextContent(/2 recorded/);
  });

  it('applies a mid-round date change to subsequent saves only', async () => {
    renderForm();

    setSelect('Unit (water-enabled only)', '14');
    fireEvent.change(screen.getByLabelText('Reading Date'), { target: { value: '2026-10-05' } });
    setSelect('Billing Month', '10');
    fireEvent.change(screen.getByLabelText('Current Reading'), { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Reading' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));

    // Correction round the next day: the new date applies going forward.
    fireEvent.change(screen.getByLabelText('Reading Date'), { target: { value: '2026-10-06' } });
    setSelect('Unit (water-enabled only)', '15');
    fireEvent.change(screen.getByLabelText('Current Reading'), { target: { value: '140' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Next Unit' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));

    expect(mockedPost.mock.calls[0][1]).toMatchObject({ readingDate: '2026-10-05' });
    expect(mockedPost.mock.calls[1][1]).toMatchObject({ readingDate: '2026-10-06' });
  });
});
