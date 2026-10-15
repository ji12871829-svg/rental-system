// Staff copilot: text + voice questions against live data, answers quoted
// from tool results, and reminder DRAFTS the human approves. Nothing on this
// page sends by itself: each draft card's Approve posts to the existing
// POST /api/sms/campaign (role-guarded there), and the mic is browser-native
// speech recognition (no key, hidden where unsupported).
import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Volume2, VolumeX } from 'lucide-react';
import { Button, Field, PageHeader, TextInput, useToast } from '../components/ui';
import { api } from '../lib/api';
import { getSpeechRecognitionCtor, speak, supportsSpeechSynthesis } from '../lib/voice';
import type { AssistantChatReply, AssistantConfig, AssistantDraft } from '@rpms/shared';

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

export default function Assistant() {
  const { toast } = useToast();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const micSupported = getSpeechRecognitionCtor() !== null;
  const voiceOutSupported = supportsSpeechSynthesis();

  useEffect(() => {
    api
      .get<{ data: AssistantConfig }>('/api/assistant/config')
      .then((r) => setConfig(r.data))
      .catch(() => setConfig({ enabled: false, model: '' }));
  }, []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    try {
      const res = await api.post<{ data: AssistantChatReply }>('/api/assistant/chat', {
        message: question,
        history: history.current,
      });
      history.current = [...history.current, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: res.data.reply }].slice(-10);
      setMessages((m) => [...m, { role: 'assistant', text: res.data.reply, drafts: res.data.drafts }]);
      if (readAloud) speak(res.data.reply);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function dictate() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-KE';
    rec.interimResults = false;
    rec.onresult = (event) => {
      const transcript = event.results
        .map((alternative) => alternative[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (transcript) setInput(transcript);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
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
      <PageHeader
        title="Assistant"
        subtitle="Ask about rent, water, tenants and arrears — answers come from live data, reminders stay drafts until you approve them"
      />
      {config && !config.enabled && (
        <div role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The assistant is disabled — no LLM key is configured. Set <code>GROQ_API_KEY</code> (free tier, no card) in the backend environment and redeploy to enable it.
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <Button key={s} variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void send(s)} disabled={busy}>
            {s}
          </Button>
        ))}
      </div>
      <div aria-live="polite" className="mb-4 space-y-3">
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
            <Mic size={16} strokeWidth={2} aria-hidden /> {listening ? 'Listening…' : ''}
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
