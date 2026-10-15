// Shared copilot chat: text + voice questions against live data, answers
// quoted from tool results, and reminder DRAFTS the human approves. Rendered
// both by the /assistant page and by the floating cube widget — one
// component, identical labels and behavior in both places.
//
// Nothing here sends by itself: each draft card's Approve posts to the
// existing POST /api/sms/campaign (role-guarded there). The mic is
// browser-native speech recognition (no key, hidden where unsupported) in
// CONTINUOUS mode with live interim text: tap to start, tap again (or wait
// for silence) to stop. Single-shot recognition ends at the first pause,
// which is the "mic dies after a second" bug this replaces.
import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Volume2, VolumeX } from 'lucide-react';
import { Button, Field, TextInput, useToast } from '../ui';
import { api } from '../../lib/api';
import { getSpeechRecognitionCtor, speak, supportsSpeechSynthesis } from '../../lib/voice';
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

export default function AssistantChat() {
  const { toast } = useToast();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  // Only stop() is ever called on the live recognizer — no need for the
  // full (unexported) recognizer type here.
  const recognizer = useRef<{ stop(): void } | null>(null);
  const finalText = useRef('');
  const micSupported = getSpeechRecognitionCtor() !== null;
  const voiceOutSupported = supportsSpeechSynthesis();

  useEffect(() => {
    api
      .get<{ data: AssistantConfig }>('/api/assistant/config')
      .then((r) => setConfig(r.data))
      .catch(() => setConfig({ enabled: false, model: '' }));
  }, []);

  // Stop any live recognition when the component unmounts (page change while
  // dictating must not leave the mic hot).
  useEffect(() => () => {
    recognizer.current?.stop();
    recognizer.current = null;
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
    // Tap-again stops: the recognizer runs until the operator stops it or
    // silence ends it, never a single-shot cut.
    if (recognizer.current) {
      recognizer.current.stop();
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recognizer.current = rec;
    finalText.current = '';
    rec.lang = 'en-KE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let interim = '';
      for (const result of event.results) {
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalText.current += `${text} `;
        else interim += text;
      }
      setInput(`${finalText.current}${interim}`.trim());
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast('error', 'Microphone blocked — allow microphone access for this site, then tap the mic again.');
      }
      setListening(false);
      recognizer.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recognizer.current = null;
    };
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
