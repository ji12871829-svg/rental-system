// SmsComposer: the confirmation composer behind the SMS page.
//
//   1. smsSegments mirrors the backend's gsm7EffectiveLength counting
//      (extension chars count double), so the live counter and the server's
//      cost guard agree.
//   2. Every starting template fits the two-segment budget with a longish
//      name and unit — the default send never trips the guard.
//   3. Queueing posts the composition (all-recipients when nothing is
//      unchecked) and reports the result; preselected ids arrive checked.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import { SmsComposer, SMS_BUDGET, SMS_TEMPLATES, smsSegments, type SmsTemplateKey } from '../components/SmsComposer';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), list: vi.fn() },
  qs: () => '',
}));

const mockedPost = vi.mocked(api.post);

afterEach(cleanup);

beforeEach(() => {
  mockedPost.mockReset();
  mockedPost.mockResolvedValue({ data: { total: 2, queued: 2, skipped: 0, tooLong: 0 } });
});

const TENANTS = [
  { id: 10, full_name: 'Alice A', phone_number: '0714000001', unit_number: '5' },
  { id: 11, full_name: 'Bob B', phone_number: '0714000002', unit_number: '2' },
];

function renderComposer(props: Partial<Parameters<typeof SmsComposer>[0]> = {}) {
  return render(
    <ToastProvider>
      <SmsComposer tenants={TENANTS} loading={false} loadError={null} onSent={() => {}} {...props} />
    </ToastProvider>,
  );
}

describe('smsSegments (live counter)', () => {
  it('counts plain text one-for-one within a single segment', () => {
    expect(smsSegments('hello')).toEqual({ effective: 5, segments: 1, overBudget: false });
  });

  it('counts GSM-7 extension characters double, like the backend', () => {
    // { and } are extension chars: 5 visible chars, 7 effective.
    expect(smsSegments('a{b}c').effective).toBe(7);
  });

  it('splits past 160 and flags past the two-segment budget', () => {
    expect(smsSegments('x'.repeat(160)).segments).toBe(1);
    expect(smsSegments('x'.repeat(161)).segments).toBe(2);
    const over = smsSegments('x'.repeat(SMS_BUDGET + 1));
    expect(over.segments).toBe(3);
    expect(over.overBudget).toBe(true);
    expect(smsSegments('x'.repeat(SMS_BUDGET)).overBudget).toBe(false);
  });
});

describe('SMS_TEMPLATES (starting wordings)', () => {
  it.each(Object.keys(SMS_TEMPLATES) as SmsTemplateKey[])('template %s fits the budget with a long name and unit', (key) => {
    const rendered = SMS_TEMPLATES[key]
      .replace(/\{\{name\}\}/g, 'Alexander Muthomi-Kamau')
      .replace(/\{\{unit\}\}/g, '24');
    expect(smsSegments(rendered).overBudget).toBe(false);
  });
});

describe('SmsComposer (queue flow)', () => {
  it('queues to everyone with a phone when nothing is unchecked', async () => {
    let sent = 0;
    renderComposer({ onSent: () => { sent += 1; } });

    fireEvent.click(screen.getByRole('button', { name: /Queue SMS/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));

    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/api/sms/campaign');
    // No tenantIds = the whole phone list (same convention as Tenant Email).
    expect(body).not.toHaveProperty('tenantIds');
    expect(body.message).toContain('{{name}}');
    expect(sent).toBe(1);
    expect(await screen.findByText(/2 queued/)).toBeInTheDocument();
  });

  it('starts arrears-preselected recipients checked and the rest unchecked', () => {
    renderComposer({ initialTemplate: 'reminder', preselectedIds: [11] });
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    // Alice unchecked, Bob checked — the arrears audience from ?compose=arrears.
    expect(boxes[0].checked).toBe(false);
    expect(boxes[1].checked).toBe(true);
    expect(screen.getByText(/Payment reminder/)).toBeInTheDocument();
  });

  it('switching template replaces the editable wording', () => {
    const { container } = renderComposer();
    fireEvent.change(screen.getByLabelText('Message type'), { target: { value: 'welcome' } });
    // The Message label carries its hint text, so reach the single textarea directly.
    expect(container.querySelector('textarea')).toHaveValue(SMS_TEMPLATES.welcome);
  });
});
