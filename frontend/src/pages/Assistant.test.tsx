import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import Assistant from './Assistant';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  qs: () => '',
}));

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Assistant />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockedGet.mockResolvedValue({ data: { enabled: true, model: 'openai/gpt-oss-20b' } });
  // jsdom logs "Not implemented" and returns undefined for window.confirm —
  // approve tests need an explicit human "yes".
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('Assistant page', () => {
  it('sends a typed question and renders the reply', async () => {
    mockedPost.mockResolvedValue({ data: { reply: 'Two tenants owe KSh 8,000.', drafts: [], toolCalls: ['get_arrears_summary'] } });
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'who owes?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost.mock.calls[0][0]).toBe('/api/assistant/chat');
    expect(await screen.findByText('Two tenants owe KSh 8,000.')).toBeInTheDocument();
  });

  it('hides the mic button where speech recognition is unsupported', async () => {
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    expect(screen.queryByRole('button', { name: 'Dictate question' })).not.toBeInTheDocument();
  });

  it('renders draft cards with per-draft approve that calls the existing campaign endpoint', async () => {
    mockedPost.mockImplementation((url: string) =>
      url === '/api/assistant/chat'
        ? Promise.resolve({
            data: {
              reply: 'Here is the draft.',
              drafts: [{ tenantId: 7, tenantName: 'Abdi N', phoneNumber: '0700000001', text: 'Dear Abdi N, kindly clear KSh 5,000.' }],
              toolCalls: ['draft_reminder'],
            },
          })
        : Promise.resolve({ data: { queued: 1 } }),
    );
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    fireEvent.change(screen.getByLabelText('Ask the assistant'), { target: { value: 'remind tenant 7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    const card = await screen.findByText('Dear Abdi N, kindly clear KSh 5,000.');
    const approve = within(card.closest('div')!).getByRole('button', { name: 'Approve and send' });
    fireEvent.click(approve);
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/sms/campaign', { tenantIds: [7], message: 'Dear Abdi N, kindly clear KSh 5,000.' }));
  });

  it('shows the disabled banner with setup steps when no key is configured', async () => {
    mockedGet.mockResolvedValue({ data: { enabled: false, model: 'openai/gpt-oss-20b' } });
    renderPage();
    expect(await screen.findByText(/assistant is disabled/)).toBeInTheDocument();
    expect(await screen.findByText(/GROQ_API_KEY/)).toBeInTheDocument();
  });
});

describe('Assistant mic (continuous dictation)', () => {
  class MockRecognition {
    static instances: MockRecognition[] = [];
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: ((e: { results: ({ transcript: string }[] & { isFinal: boolean })[]; resultIndex: number }) => void) | null = null;
    onerror: ((e: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    stopped = false;
    constructor() {
      MockRecognition.instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
      this.onend?.();
    }
  }

  function stubMic() {
    MockRecognition.instances = [];
    vi.stubGlobal('SpeechRecognition', MockRecognition);
  }

  function lastMic() {
    return MockRecognition.instances[MockRecognition.instances.length - 1];
  }

  function micResult(transcript: string, isFinal: boolean) {
    // isFinal lives on the RESULT (results[i]), per the real API — putting
    // it on the alternative would silently make everything interim.
    const result = Object.assign([{ transcript }], { isFinal });
    // Direct handler call (not via fireEvent), so flush with act().
    act(() => {
      lastMic().onresult?.({ results: [result], resultIndex: 0 });
    });
  }

  function dictate() {
    fireEvent.click(screen.getByRole('button', { name: 'Dictate question' }));
  }

  it('starts continuous recognition with live interim results and a Stop state', async () => {
    stubMic();
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    const rec = lastMic();
    expect(rec.started).toBe(true);
    // The actual bug: single-shot mode ended at the first pause.
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBe('en-KE');
    expect(screen.getByText('Stop')).toBeInTheDocument();
  });

  it('stops on second tap instead of leaking a recognizer', async () => {
    stubMic();
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    dictate();
    expect(lastMic().stopped).toBe(true);
    expect(MockRecognition.instances).toHaveLength(1);
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('streams interim text live and accumulates finals', async () => {
    stubMic();
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    micResult('who has', false);
    expect(screen.getByLabelText('Ask the assistant')).toHaveValue('who has');
    micResult('who has not', true);
    micResult('paid', true);
    expect(screen.getByLabelText('Ask the assistant')).toHaveValue('who has not paid');
  });

  it('explains a blocked microphone instead of silently dying', async () => {
    stubMic();
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    lastMic().onerror?.({ error: 'not-allowed' });
    expect(await screen.findByText(/Microphone blocked/)).toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });
});
