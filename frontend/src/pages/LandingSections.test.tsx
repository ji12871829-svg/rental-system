// Pricing must show the operator's configured currency, not a hardcoded
// symbol: GET /api/public/units rides `currency` along with the roster
// precisely so the no-session landing page can render real rates (this was
// once discarded, pinning every price to 'KSh'). The api module is mocked
// with the true wire envelope — the same { currency, data } shape the real
// HTTP client hands the hook — with a deliberately non-KSh currency.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Pricing } from './LandingSections';
import { BrandingProvider } from '../lib/BrandingContext';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}));

const mockedGet = vi.mocked(api.get);

function envelope(currency: string) {
  return {
    currency,
    data: [
      { unitType: 'Bedsitter', minRent: 8000, maxRent: 8000, total: 4, vacant: 2 },
      { unitType: '1 Bedroom', minRent: 12000, maxRent: 15000, total: 6, vacant: 1 },
    ],
  };
}

// The component formats with plain toLocaleString(); mirror it so the test
// stays correct whatever locale the CI environment defaults to.
const fmt = (n: number) => n.toLocaleString();

function renderPricing() {
  return render(
    <BrandingProvider>
      <Pricing />
    </BrandingProvider>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Pricing (operator-configured currency)', () => {
  it('renders every price in the currency from /api/public/units', async () => {
    mockedGet.mockResolvedValueOnce(envelope('USD'));
    renderPricing();

    // Both roster cards arrive once the fetch resolves.
    await waitFor(() => expect(screen.getByText('Bedsitter')).toBeInTheDocument());
    expect(screen.getByText('1 Bedroom')).toBeInTheDocument();

    // Prices are composed of adjacent text runs inside one <p> per card, so
    // match on the composed element text (the pattern the dashboard strip
    // tests use for multi-node lines). Single-price row and range row.
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === `USD ${fmt(8000)}`)).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === `USD ${fmt(12000)} – USD ${fmt(15000)}`)).toBeInTheDocument();

    // The old hardcoded default must be gone entirely.
    expect(screen.queryByText(/KSh/)).not.toBeInTheDocument();
  });

  it('falls back to KSh when the response carries no currency', async () => {
    mockedGet.mockResolvedValueOnce({ data: envelope('USD').data });
    renderPricing();

    await waitFor(() => expect(screen.getByText('Bedsitter')).toBeInTheDocument());
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === `KSh ${fmt(8000)}`)).toBeInTheDocument();
  });
});
