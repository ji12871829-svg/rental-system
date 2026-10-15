import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/ui';
import { api } from '../lib/api';
import Assistant from './Assistant';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn() },
  qs: () => '',
}));

const mockedGet = vi.mocked(api.get);
const mockedPost = vi.mocked(api.post);
const mockedDel = vi.mocked(api.del);

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

  it('hides the mic button where audio recording is unsupported', async () => {
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

describe('Assistant mic (record and transcribe)', () => {
  class MockRecorder {
    static instances: MockRecorder[] = [];
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    state = 'inactive';
    mimeType = 'audio/webm';
    stopped = false;
    constructor(_stream?: unknown) {
      MockRecorder.instances.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.stopped = true;
      this.onstop?.();
    }
  }

  function stubMicStack() {
    MockRecorder.instances = [];
    vi.stubGlobal('MediaRecorder', MockRecorder);
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => stream) },
      configurable: true,
    });
    return { stopTrack };
  }

  function lastMic() {
    return MockRecorder.instances[MockRecorder.instances.length - 1];
  }

  function emitAudio(byteCount = 3) {
    lastMic()?.ondataavailable?.({ data: new Blob([new Uint8Array(byteCount)], { type: 'audio/webm' }) });
  }

  function dictate() {
    fireEvent.click(screen.getByRole('button', { name: 'Dictate question' }));
  }

  function mockTranscribe(text: string) {
    mockedPost.mockImplementation(async (url: string) =>
      url === '/api/assistant/transcribe' ? { data: { text } } : { data: {} },
    );
  }

  it('records on tap and transcribes into the input on second tap', async () => {
    stubMicStack();
    mockTranscribe('who has not paid October rent?');
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    await screen.findByText('Stop');
    expect(lastMic().state).toBe('recording');
    emitAudio();
    dictate();
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/api/assistant/transcribe',
        expect.objectContaining({ mimeType: 'audio/webm' }),
      ),
    );
    const call = mockedPost.mock.calls.find((c) => c[0] === '/api/assistant/transcribe');
    if (!call) throw new Error('expected a transcribe upload call');
    expect((call[1] as { audioBase64: string }).audioBase64.length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByLabelText('Ask the assistant')).toHaveValue('who has not paid October rent?'),
    );
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
  });

  it('explains a blocked microphone instead of silently dying', async () => {
    stubMicStack();
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError'); }) },
      configurable: true,
    });
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    expect(await screen.findByText(/Microphone blocked/)).toBeInTheDocument();
  });

  it('rejects oversized recordings client-side without uploading', async () => {
    stubMicStack();
    mockTranscribe('never used');
    renderPage();
    await screen.findByText(/Ask about rent, water, tenants/);
    dictate();
    await screen.findByText('Stop');
    emitAudio(901_001);
    dictate();
    expect(await screen.findByText(/too long/)).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe('Assistant threads and briefing', () => {
  const THREADS = [{ id: 9, title: 'October chase', messageCount: 4, updatedAt: '2026-10-15T08:00:00.000Z' }];
  const BRIEFING = [
    {
      kind: 'top_debtor',
      title: 'Abdi N (Unit 7) owes KSh 5,000',
      detail: 'Rent balance KSh 5,000, water KSh 0, unpaid.',
      tenantId: 7,
      unitNumber: '7',
      linkTo: '/arrears',
    },
  ];
  const THREAD_MESSAGES = {
    id: 9,
    title: 'October chase',
    messages: [
      { role: 'user', content: 'who owes?', toolCalls: [], drafts: [] },
      { role: 'assistant', content: 'Abdi N owes 5,000.', toolCalls: ['get_arrears_summary'], drafts: [] },
    ],
  };

  beforeEach(() => {
    mockedDel.mockReset();
    mockedDel.mockResolvedValue({ data: {} });
    mockedGet.mockImplementation((url: string) => {
      if (url === '/api/assistant/threads/9/messages') return Promise.resolve({ data: THREAD_MESSAGES });
      if (url === '/api/assistant/threads') return Promise.resolve({ data: THREADS });
      if (url === '/api/assistant/briefing') return Promise.resolve({ data: BRIEFING });
      return Promise.resolve({ data: { enabled: true, model: 'openai/gpt-oss-20b' } });
    });
  });

  it('shows the briefing when the chat is empty', async () => {
    renderPage();
    expect(await screen.findByText('What needs attention')).toBeInTheDocument();
    expect(screen.getByText('Abdi N (Unit 7) owes KSh 5,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abdi N (Unit 7) owes KSh 5,000' })).toHaveAttribute('href', '/arrears');
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("switching threads loads that thread's messages", async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Conversation'), { target: { value: '9' } });
    expect(await screen.findByText('who owes?')).toBeInTheDocument();
    expect(screen.getByText('Abdi N owes 5,000.')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/api/assistant/threads/9/messages');
  });

  it('deleting a thread asks confirm and returns to a fresh chat', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Conversation'), { target: { value: '9' } });
    await screen.findByText('who owes?');
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete this conversation? It cannot be undone.');
    await waitFor(() => expect(mockedDel).toHaveBeenCalledWith('/api/assistant/threads/9'));
    expect(await screen.findByText('What needs attention')).toBeInTheDocument();
    expect(screen.queryByText('who owes?')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ask the assistant')).toHaveValue('');
  });
});
