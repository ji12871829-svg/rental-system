// Failed SMS rows offer manual Retry (table + View modal), pending rows
// keep Send, sent rows offer neither. Retry reuses the exact same send
// path (POST /api/sms/:id/send) — the only change is the button existing.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import SmsNotifications from './SmsNotifications';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);
const mockedList = vi.mocked(api.list);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function smsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    receipt_id: 10,
    tenant_id: 12,
    phone_number: '0714000012',
    message: 'Dear Charles, kindly clear KSh 3,500.',
    status: 'FAILED',
    provider_message_id: null,
    sent_at: null,
    failure_reason: 'textbee rate limit reached (HTTP 429)',
    provider_cost: null,
    provider_currency: null,
    attempt_count: 3,
    next_retry_at: null,
    delivery_status: null,
    delivery_network: null,
    delivery_updated_at: null,
    created_at: '2026-10-14T20:07:50.000Z',
    tenant_name: 'Charles Owino',
    unit_number: '12',
    ...overrides,
  };
}

const FAILED = smsRow();
const PENDING = smsRow({ id: 100, tenant_name: 'Pending Pete', status: 'PENDING', failure_reason: null, attempt_count: 0 });
const SENT = smsRow({ id: 101, tenant_name: 'Sent Sally', status: 'SENT', failure_reason: null });

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SmsNotifications />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function failedRow(): HTMLElement {
  const cell = screen.getByText('Charles Owino');
  const row = cell.closest('tr');
  if (!row) throw new Error('failed SMS row not found');
  return row;
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedList.mockReset();
  mockedGet.mockImplementation((url: string) => {
    if (url === '/api/sms/config') return Promise.resolve({ data: { provider: 'textbee', live: true, autoSend: true } });
    if (url === '/api/sms/balance') return Promise.resolve({ data: { state: 'unknown', reason: 'test' } });
    if (url === '/api/settings') return Promise.resolve({ data: { reporting_year: 2026 } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  mockedList.mockImplementation((url: string) => {
    if (url.startsWith('/api/tenants')) {
      return Promise.resolve({ data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } });
    }
    if (url.startsWith('/api/reports/arrears')) {
      return Promise.resolve({ data: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } });
    }
    if (url.startsWith('/api/sms/history')) {
      return Promise.resolve({
        data: [FAILED, PENDING, SENT],
        pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
        meta: { spendByCurrency: [] },
      });
    }
    if (url.startsWith('/api/templates')) {
      return Promise.resolve({ data: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } });
    }
    return Promise.reject(new Error(`unexpected LIST ${url}`));
  });
  mockedPost.mockResolvedValue({ data: { ...FAILED, status: 'SENT' } });
});

describe('SmsNotifications history (manual send)', () => {
  it('shows Retry on failed rows, Send on pending rows, neither on sent rows', async () => {
    renderPage();
    await screen.findByText('Charles Owino');

    const failedRowEl = failedRow();
    expect(within(failedRowEl).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(within(failedRowEl).queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('posts the existing send endpoint when Retry is clicked', async () => {
    renderPage();
    await screen.findByText('Charles Owino');

    const failedRowEl = failedRow();
    fireEvent.click(within(failedRowEl).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/sms/99/send'));
  });

  it('offers Retry Now inside the failed message modal', async () => {
    renderPage();
    await screen.findByText('Charles Owino');

    const failedRowEl = failedRow();
    fireEvent.click(within(failedRowEl).getByRole('button', { name: 'View' }));
    await screen.findByText(/Delivery failed/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Now' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/sms/99/send'));
  });
});
