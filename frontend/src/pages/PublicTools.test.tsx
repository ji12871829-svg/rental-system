import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CostEstimator, { estimateCost } from './CostEstimator';
import { buildTemplate } from './DocumentTemplates';
import ReferLandlord from './ReferLandlord';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn().mockResolvedValue({ data: [], pagination: { page: 1, totalPages: 1 } }) },
  qs: () => '',
}));

vi.mock('../lib/BrandingContext', () => ({
  useBranding: () => ({ legalNameDisplay: 'Olbano Plaza', identity: null }),
}));

afterEach(cleanup);

describe('estimateCost', () => {
  it('scales with size and finish level', () => {
    const basic = estimateCost({ dwelling: '2br', sizeSqm: 80, finish: 'basic', zone: 'nairobi' })!;
    const exec = estimateCost({ dwelling: '2br', sizeSqm: 80, finish: 'executive', zone: 'nairobi' })!;
    expect(basic.low).toBe(80 * 35000);
    expect(basic.high).toBe(80 * 45000);
    expect(exec.low).toBeGreaterThan(basic.high);
  });

  it('discounts upcountry zones and rejects bad sizes', () => {
    const city = estimateCost({ dwelling: '1br', sizeSqm: 50, finish: 'standard', zone: 'nairobi' })!;
    const up = estimateCost({ dwelling: '1br', sizeSqm: 50, finish: 'standard', zone: 'upcountry' })!;
    expect(up.high).toBeLessThan(city.high);
    expect(estimateCost({ dwelling: '1br', sizeSqm: 0, finish: 'standard', zone: 'nairobi' })).toBeNull();
    expect(estimateCost({ dwelling: '1br', sizeSqm: NaN, finish: 'standard', zone: 'nairobi' })).toBeNull();
  });

  it('breakdown shares sum to the total range', () => {
    const r = estimateCost({ dwelling: '3br', sizeSqm: 100, finish: 'standard', zone: 'metro' })!;
    expect(r.breakdown.reduce((s, b) => s + b.low, 0)).toBe(r.low);
    expect(r.breakdown.reduce((s, b) => s + b.high, 0)).toBe(r.high);
  });
});

describe('buildTemplate', () => {
  const f = { landlord: 'Jane', tenant: 'John', unit: '12', property: 'Olbano', amount: '15000', date: '2026-10-01', extra: 'January 2027' };
  it('renders each letter with its key facts', () => {
    expect(buildTemplate('RENT_INCREASE', f).body).toContain('NOTICE OF RENT INCREASE');
    expect(buildTemplate('RECEIPT', f).body).toContain('KES 15000');
    expect(buildTemplate('DEMAND', f).body).toContain('seven (7) days');
    expect(buildTemplate('INVOICE', f).body).toContain('TENANT INVOICE');
    expect(buildTemplate('EVICTION', f).body).toContain('vacate');
  });

  it('escapes HTML in free-text fields', () => {
    const body = buildTemplate('DEMAND', { ...f, tenant: '<b>x</b>' }).body;
    expect(body).not.toContain('<b>x</b>');
  });
});

describe('public tool pages', () => {
  it('renders the estimator with a range', () => {
    render(<MemoryRouter><CostEstimator /></MemoryRouter>);
    expect(screen.getByText('Building Cost Estimator')).toBeTruthy();
  });

  it('renders the referral form', () => {
    render(<MemoryRouter><ReferLandlord /></MemoryRouter>);
    expect(screen.getByText('Know a landlord? Refer them')).toBeTruthy();
  });
});
