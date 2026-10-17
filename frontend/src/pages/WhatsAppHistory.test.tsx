// Every WhatsApp delivery row carries a manual send control the operator can
// press at will: pending rows get Send, failed rows get Send again, erroneous
// rows get Fix & send (the corrected-recipient dialog), and — unlike the SMS
// page — SENT rows also get Send again, because a single demand may be
// re-delivered by hand (the backend overwrites the wamid in place instead of
// refusing). All of them reuse the exact POST /api/whatsapp/:id/send path.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import WhatsAppHistory from './WhatsAppHistory';

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

function whatsappRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    tenant_id: 12,
    phone_number: '0714000012',
    message: 'Dear Charles, kindly clear KSh 3,500.',
    status: 'FAILED',
    provider_message_id: null,
    template_kind: null,
    attempt_count: 2,
    next_retry_at: null,
    failure_reason: 'Meta 131047: re-engagement window not open',
    created_at: '2026-10-14T20:07:50.000Z',
    sent_at: null,
    tenant_name: 'Charles Owino',
    unit_number: '12',
    ...overrides,
  };
}

const FAILED = whatsappRow();
const PENDING = whatsappRow({ id: 100, tenant_name: 'Pending Pete', status: 'PENDING', failure_reason: null, attempt_count: 0 });
const SENT = whatsappRow({ id: 101, tenant_name: 'Sent Sally', status: 'SENT', failure_reason: null, attempt_count: 1, provider_message_id: 'wamid.first' });
const ERRONEOUS = whatsappRow({ id: 102, tenant_name: 'Bounced Bo', status: 'ERRONEOUS', failure_reason: '131030: recipient not on WhatsApp', next_retry_at: null });

beforeEach(() => {
  mockedGet.mockResolvedValue({
    data: { provider: 'cloud', live: true, apiVersion: 'v25.0', templates: { reminder: null, finalNotice: null, language: 'en' } },
  });
  mockedList.mockImplementation(() => {
    return Promise.resolve({
      data: [FAILED, PENDING, SENT, ERRONEOUS],
      pagination: { page: 1, limit: 20, total: 4, totalPages: 1 },
    });
  });
  mockedPost.mockResolvedValue({ data: { ...SENT, attempt_count: 2, provider_message_id: 'wamid.redelivered' } });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <WhatsAppHistory />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function rowFor(tenantName: string): HTMLElement {
  const cell = screen.getByText(tenantName);
  return cell.closest('tr') as HTMLElement;
}

describe('WhatsAppHistory (every delivery has a manual send)', () => {
  it('shows Send on pending, Send again on failed AND sent rows, Fix & send on erroneous rows', async () => {
    renderPage();
    await screen.findByText('Charles Owino');

    const sentRow = rowFor('Sent Sally');
    expect(within(sentRow).getByRole('button', { name: 'Send again' })).toBeInTheDocument();

    const pendingRow = rowFor('Pending Pete');
    expect(within(pendingRow).getByRole('button', { name: 'Send' })).toBeInTheDocument();

    const failedRowEl = rowFor('Charles Owino');
    expect(within(failedRowEl).getByRole('button', { name: 'Send again' })).toBeInTheDocument();

    const erroneousRow = rowFor('Bounced Bo');
    expect(within(erroneousRow).getByRole('button', { name: 'Fix & send' })).toBeInTheDocument();
  });

  it('re-sends a SENT row through the history send endpoint when the operator presses its button', async () => {
    renderPage();
    await screen.findByText('Sent Sally');

    const sentRow = rowFor('Sent Sally');
    fireEvent.click(within(sentRow).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/whatsapp/101/send', undefined));

    // The toast confirms the duplicate delivery went out.
    await screen.findByText(/WhatsApp message sent to/);
  });

  it('sends a PENDING row with a plain Send button', async () => {
    renderPage();
    await screen.findByText('Pending Pete');

    const pendingRow = rowFor('Pending Pete');
    fireEvent.click(within(pendingRow).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/whatsapp/100/send', undefined));
  });
});
