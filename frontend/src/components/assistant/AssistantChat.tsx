// Shared copilot chat: text + voice questions against live data, answers
// quoted from tool results, and reminder DRAFTS the human approves. Rendered
// both by the /assistant page and by the floating cube widget — one
// component, identical labels and behavior in both places.
//
// Voice input records audio (tap mic to start, tap again to stop, 60 s cap)
// and transcribes it server-side via Groq Whisper — far stronger on accented
// speech than the browser's built-in recognizer, which garbled even short
// English queries. Nothing here sends by itself: each draft card's Approve
// posts to the existing POST /api/sms/campaign (role-guarded there).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, Send, Volume2, VolumeX } from 'lucide-react';
import { Button, Field, Select, TextInput, useToast } from '../ui';
import { api } from '../../lib/api';
import { speak, supportsSpeechSynthesis } from '../../lib/voice';
import type { AssistantChatReply, AssistantConfig, AssistantDraft, AssistantThread, BriefingItem } from '@rpms/shared';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  drafts?: AssistantDraft[];
}

const SUGGESTIONS = [
  'Who has not paid October rent?',
  'How much rent came in this month?',
  'Draft reminders for the most overdue tenants',
];

export default function AssistantChat() {
  const { toast } = useToast();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [briefing, setBriefing] = useState<BriefingItem[] | null>(null);
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  // Live MediaRecorder (null when idle). Tap mic to start, tap again to
  // stop and transcribe; a 60 s timer stops runaway recordings.
  const recorder = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Audio chunks accumulate here from the moment recording starts (handlers
  // attach at start, not at stop — data emitted mid-recording must land
  // somewhere even though stop() comes later).
  const audioChunks = useRef<Blob[]>([]);
  const recordTimer = useRef<number | null>(null);
  const micSupported = typeof window !== 'undefined' && 'MediaRecorder' in window;
  const voiceOutSupported = supportsSpeechSynthesis();

  useEffect(() => {
    api
      .get<{ data: AssistantConfig }>('/api/assistant/config')
      .then((r) => setConfig(r.data))
      .catch(() => setConfig({ enabled: false, model: '' }));
    // Threads + briefing degrade to today's UI on failure (never a crash):
    // a non-array payload (or a rejected fetch) leaves threads empty and the
    // briefing hidden, exactly as before this feature existed.
    api
      .get<{ data: AssistantThread[] }>('/api/assistant/threads')
      .then((r) => { if (Array.isArray(r.data)) setThreads(r.data); })
      .catch(() => setThreads([]));
    api
      .get<{ data: BriefingItem[] }>('/api/assistant/briefing')
      .then((r) => { if (Array.isArray(r.data)) setBriefing(r.data); })
      .catch(() => setBriefing(null));
  }, []);

  // Stop any live recording when the component unmounts (page change while
  // dictating must not leave the mic hot).
  useEffect(() => () => {
    try {
      recorder.current?.stop();
    } catch {
      // Already stopped.
    }
    releaseMic();
  }, []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    try {
      const res = await api.post<{ data: AssistantChatReply & { threadId?: number } }>('/api/assistant/chat', {
        message: question,
        history: history.current,
        threadId: threadId ?? undefined,
      });
      history.current = [...history.current, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: res.data.reply }].slice(-10);
      setMessages((m) => [...m, { role: 'assistant', text: res.data.reply, drafts: res.data.drafts }]);
      if (typeof res.data.threadId === 'number') setThreadId(res.data.threadId);
      // Counts/titles change after a turn — refresh the switcher, ignoring
      // failures (the chat itself already succeeded).
      api
        .get<{ data: AssistantThread[] }>('/api/assistant/threads')
        .then((r) => { if (Array.isArray(r.data)) setThreads(r.data); })
        .catch(() => {});
      if (readAloud) speak(res.data.reply);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    setThreadId(null);
    setMessages([]);
    history.current = [];
  }

  async function resumeThread(id: number) {
    setThreadId(id);
    try {
      const r = await api.get<{ data: { id: number; title: string; messages: { role: 'user' | 'assistant'; content: string; drafts?: AssistantDraft[] }[] } }>(
        `/api/assistant/threads/${id}/messages`,
      );
      // Rebuild both the bubbles and the model history from ALL stored
      // turns (capped to the last 10) so follow-ups ("and their phone
      // numbers?") resolve against the resumed conversation.
      setMessages(r.data.messages.map((m) => ({ role: m.role, text: m.content, drafts: m.drafts ?? [] })));
      history.current = r.data.messages.map((m) => ({ role: m.role, content: m.content })).slice(-10);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  async function deleteThread() {
    if (threadId === null) return;
    if (!window.confirm('Delete this conversation? It cannot be undone.')) return;
    try {
      await api.del(`/api/assistant/threads/${threadId}`);
    } catch (err) {
      toast('error', (err as Error).message);
      return;
    }
    newChat();
    api
      .get<{ data: AssistantThread[] }>('/api/assistant/threads')
      .then((r) => { if (Array.isArray(r.data)) setThreads(r.data); })
      .catch(() => {});
  }

  function releaseMic() {
    if (recordTimer.current !== null) {
      window.clearTimeout(recordTimer.current);
      recordTimer.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorder.current = null;
    setListening(false);
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result ?? '');
        const comma = url.indexOf(',');
        resolve(comma >= 0 ? url.slice(comma + 1) : url);
      };
      reader.onerror = () => reject(new Error('Could not read the recording.'));
      reader.readAsDataURL(blob);
    });
  }

  async function dictate() {
    // Tap-again: the chunks are already collected (handlers attached at
    // start); stopping flushes the last one, then onstop resolves.
    if (recorder.current) {
      const rec = recorder.current;
      const done = new Promise<Blob>((resolve, reject) => {
        rec.onstop = () => resolve(new Blob(audioChunks.current, { type: rec.mimeType || 'audio/webm' }));
        rec.onerror = () => reject(new Error('Recording failed — try again.'));
      });
      setBusy(true);
      try {
        rec.stop();
      } catch {
        // Already stopped — onstop still fires.
      }
      try {
        const blob = await done;
        releaseMic();
        if (blob.size === 0) {
          toast('error', 'Nothing was recorded — tap the mic and speak, then tap again to stop.');
          return;
        }
        if (blob.size > 900_000) {
          toast('error', 'Recording too long — keep it under a minute and try again.');
          return;
        }
        const audioBase64 = await blobToBase64(blob);
        const res = await api.post<{ data: { text: string } }>('/api/assistant/transcribe', {
          audioBase64,
          mimeType: blob.type || 'audio/webm',
        });
        setInput(res.data.text);
      } catch (err) {
        releaseMic();
        toast('error', (err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!micSupported) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('error', 'Microphone blocked — allow microphone access for this site, then tap the mic again.');
      return;
    }
    streamRef.current = stream;
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    audioChunks.current = [];
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) audioChunks.current.push(e.data);
    };
    rec.onerror = () => {
      toast('error', 'Recording failed — try again.');
      releaseMic();
    };
    setListening(true);
    // Runaway guard: 60 s is plenty for a question and keeps uploads small.
    recordTimer.current = window.setTimeout(() => {
      void dictate();
    }, 60_000);
    rec.start();
  }

  async function approveDraft(d: AssistantDraft) {
    if (!window.confirm(`Send this SMS to ${d.tenantName ?? 'the tenant'} (${d.phoneNumber ?? 'no phone on file'})?\n\n${d.text}`)) return;
    try {
      await api.post('/api/sms/campaign', { tenantIds: [d.tenantId], message: d.text });
      toast('success', 'Reminder sent for approval queue — check SMS history for delivery.');
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  return (
    <div>
      {config && !config.enabled && (
        <div role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The assistant is disabled — no LLM key is configured. Set <code>GROQ_API_KEY</code> (free tier, no card) in the backend environment and redeploy to enable it.
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Conversation"
          value={threadId === null ? '' : String(threadId)}
          onChange={(e) => {
            if (e.target.value === '') {
              newChat();
              return;
            }
            void resumeThread(Number(e.target.value));
          }}
        >
          <option value="">New chat</option>
          {threads.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.title}
            </option>
          ))}
        </Select>
        <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={newChat} disabled={busy}>
          New chat
        </Button>
        {threadId !== null && (
          <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void deleteThread()} disabled={busy}>
            Delete conversation
          </Button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <Button key={s} variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void send(s)} disabled={busy}>
            {s}
          </Button>
        ))}
      </div>
      <div aria-live="polite" className="mb-4 space-y-3">
        {messages.length === 0 && briefing !== null && (
          <div className="max-w-2xl rounded-xl bg-white px-4 py-3 ring-1 ring-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">What needs attention</h2>
            {briefing.length === 0 ? (
              <p className="mt-1 text-sm text-gray-700">All clear — nothing owed right now.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {briefing.map((item, i) => (
                  <li key={i} className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
                    <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                    <p className="mt-0.5 text-xs text-gray-700">{item.detail}</p>
                    {item.linkTo && (
                      <Link to={item.linkTo} aria-label={item.title} className="mt-1 inline-block text-xs font-semibold text-brand-600 hover:text-brand-700">
                        Open →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-2xl rounded-xl px-4 py-3 text-sm ${m.role === 'user' ? 'ml-auto bg-brand-500 text-white' : 'bg-white text-gray-900 ring-1 ring-gray-200'}`}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.drafts?.map((d) => (
              <div key={d.tenantId} className="mt-2 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
                <p className="text-xs font-semibold text-gray-700">
                  Draft for {d.tenantName ?? `tenant ${d.tenantId}`} ({d.phoneNumber ?? 'no phone on file'})
                </p>
                <p className="mt-1 text-xs text-gray-700">{d.text}</p>
                <Button variant="secondary" className="mt-2 !px-3 !py-1 text-xs" onClick={() => void approveDraft(d)}>
                  Approve and send
                </Button>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Ask the assistant">
            <TextInput
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. who has not paid October rent?"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send(input);
              }}
            />
          </Field>
        </div>
        {micSupported && (
          <Button
            variant="secondary"
            aria-label="Dictate question"
            aria-pressed={listening}
            onClick={dictate}
            disabled={busy}
            className={listening ? '!border-red-400 !text-red-600' : ''}
          >
            <Mic size={16} strokeWidth={2} aria-hidden /> {listening ? 'Stop' : ''}
          </Button>
        )}
        {voiceOutSupported && (
          <Button
            variant="secondary"
            aria-label={readAloud ? 'Stop reading replies aloud' : 'Read replies aloud'}
            aria-pressed={readAloud}
            onClick={() => setReadAloud((v) => !v)}
          >
            {readAloud ? <Volume2 size={16} strokeWidth={2} aria-hidden /> : <VolumeX size={16} strokeWidth={2} aria-hidden />}
          </Button>
        )}
        <Button onClick={() => void send(input)} disabled={busy} loading={busy} aria-label="Send question">
          <Send size={16} strokeWidth={2} aria-hidden />
        </Button>
      </div>
      {!micSupported && (
        <p className="mt-2 text-xs text-gray-500">Voice dictation needs Chrome or Edge — typing works everywhere.</p>
      )}
    </div>
  );
}
