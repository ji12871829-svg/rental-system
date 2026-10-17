// TenancyAgreement: pure builder tests + a render smoke test. The builder is
// the load-bearing logic (prefill writes into it, preview/save read from it),
// so it gets direct assertions; rendering is covered by one smoke test with
// mocked data hooks.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import TenancyAgreement, { buildAgreementHtml, toBase64Utf8 } from './TenancyAgreement';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, totalPages: 1 } }) },
  qs: () => '',
}));

vi.mock('../lib/BrandingContext', () => ({
  useBranding: () => ({ legalNameDisplay: 'Olbano Plaza', identity: null }),
}));

vi.mock('../components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ui')>();
  return { ...actual, useFetch: () => ({ data: { data: [], pagination: { page: 1, totalPages: 1 } }, loading: false, error: null }) };
});

afterEach(cleanup);

const base = {
  landlordName: 'Jane Wanjiru',
  landlordIdNumber: '12345678',
  landlordPhone: '+254700000000',
  tenantName: 'John Mwangi',
  tenantIdNumber: '87654321',
  tenantPhone: '+254711111111',
  propertyName: 'Olbano Plaza',
  unitNumber: '12',
  monthlyRent: '15000',
  deposit: '15000',
  startDate: '2026-10-01',
  paybill: '522522',
  noticeMonths: 'one (1) calendar month',
};

describe('buildAgreementHtml', () => {
  it('renders parties, premises and money figures', () => {
    const html = buildAgreementHtml(base, 'Olbano Plaza');
    expect(html).toContain('Jane Wanjiru');
    expect(html).toContain('John Mwangi');
    expect(html).toContain('unit 12');
    expect(html).toContain('KES 15000');
    expect(html).toContain('522522');
    expect(html).toContain('not legal advice');
  });

  it('falls back to business identity and blanks when fields are empty', () => {
    const html = buildAgreementHtml({ ...base, landlordName: '', tenantName: '', monthlyRent: '' }, 'Olbano Plaza');
    expect(html).toContain('Olbano Plaza');
    expect(html).toContain('________________');
  });

  it('escapes HTML in free-text fields', () => {
    const html = buildAgreementHtml({ ...base, tenantName: '<script>alert(1)</script>' }, null);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('toBase64Utf8', () => {
  it('round-trips unicode through the vault payload encoding', () => {
    const s = 'Tenancy — Unit 12 · KES 15,000';
    const back = decodeURIComponent(escape(atob(toBase64Utf8(s))));
    expect(back).toBe(s);
  });
});

describe('TenancyAgreement page', () => {
  it('renders the generator with preview', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <TenancyAgreement />
        </ToastProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('Tenancy Agreement Generator')).toBeTruthy();
    expect(screen.getByText('Live preview')).toBeTruthy();
  });
});
