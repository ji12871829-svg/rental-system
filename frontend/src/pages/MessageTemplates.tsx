// Message Templates — staff editors for the 9 outbound message templates
// (receipts, reminders, WhatsApp composes, tenant email campaign) with
// mail-merge chips, live preview and SMS segment accounting. Saving stores a
// `message_templates` row (every future send of that kind uses it); Revert
// deletes the row and the hardcoded default takes over again.
import { useMemo, useRef, useState } from 'react';
import { MessageSquareText, RotateCcw, Save } from 'lucide-react';
import { Button, Field, PageHeader, SkeletonTable, TextInput, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';

interface TemplateState {
  kind: string;
  label: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
  description: string;
  fields: string[];
  hasSubject: boolean;
  defaultSubject: string | null;
  defaultBody: string;
  customized: boolean;
  subject: string | null;
  body: string;
  updated_at: string | null;
}

const CHANNEL_LABEL: Record<TemplateState['channel'], string> = {
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
};

const CHANNEL_ACTIVE =
  'rounded-full border border-brand-600 bg-brand-600 px-4 py-1.5 text-sm font-medium text-white';
const CHANNEL_IDLE =
  'rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';

// Client-side mirror of backend src/utils/mergeFields.ts — identical rules:
// {{token}} (whitespace tolerated), known-but-empty renders as '', unknown
// tokens stay visible so typos surface instead of silently disappearing.
function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (match, token: string) =>
    Object.prototype.hasOwnProperty.call(vars, token) ? vars[token] ?? '' : match,
  );
}

// GSM-7 segment accounting for concatenated SMS: 160 chars per segment, or
// 153 per segment once a message needs more than one. UCS-2 fallback for
// non-GSM characters (e.g. emoji): 70/67 chars instead.
const GSM_7 =
  "@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
function smsInfo(text: string): { segments: number; chars: number } {
  const chars = [...text].length;
  const isGsm = [...text].every((ch) => GSM_7.includes(ch) || ch === '\n');
  const [single, joined] = isGsm ? [160, 153] : [70, 67];
  if (chars <= single) return { segments: 1, chars };
  return { segments: Math.ceil(chars / joined), chars };
}

// Sample values for the live preview — real values are resolved per tenant at
// send time by the backend (utils/mergeFields.ts).
const SAMPLE_VARS: Record<string, string> = {
  name: 'Jane Wanjiru',
  unit: 'A4',
  month: 'October',
  year: '2026',
  amount: '12,000',
  rent: '12,000',
  water: '1,500',
  total: '13,500',
  balance: '0',
  receipt: 'RCP-0123',
  currency: 'KES',
  business: 'Olbano Plaza',
  total_due: '13,500',
  account: 'A4',
  payment_method: 'M-Pesa',
  current_rent: '12,000',
  previous_balance: '0',
  amount_due: '13,500',
  support_link: ' Click here to chat with support if you have any questions: https://wa.me/254700000000.',
};

export default function MessageTemplates() {
  const { toast } = useToast();
  const { data, loading, error, refresh } = useFetch(() => api.list<TemplateState>('/api/templates'), []);
  const templates = data?.data ?? [];
  const [channel, setChannel] = useState<TemplateState['channel']>('SMS');
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const channelKinds = useMemo(() => templates.filter((t) => t.channel === channel), [templates, channel]);
  const selected = useMemo(
    () => channelKinds.find((t) => t.kind === selectedKind) ?? channelKinds[0] ?? null,
    [channelKinds, selectedKind],
  );

  // Derived-state sync: when the selection changes, reload the draft from the
  // currently effective template (custom row, else the hardcoded default).
  if (selected && draftKind !== selected.kind) {
    setDraftKind(selected.kind);
    setDraftSubject(selected.subject ?? '');
    setDraftBody(selected.body);
  }
  const dirty = !!selected && (draftBody !== selected.body || draftSubject !== (selected.subject ?? ''));

  function insertField(field: string) {
    const token = `{{${field}}}`;
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraftBody((current) => `${current}${token}`);
      return;
    }
    const start = textarea.selectionStart ?? draftBody.length;
    const end = textarea.selectionEnd ?? start;
    setDraftBody(`${draftBody.slice(0, start)}${token}${draftBody.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + token.length;
      textarea.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    if (!selected || busy) return;
    if (!draftBody.trim()) {
      toast('error', 'Template body is required.');
      return;
    }
    setBusy(true);
    try {
      await api.put(`/api/templates/${selected.kind}`, {
        subject: selected.hasSubject ? draftSubject : undefined,
        body: draftBody,
      });
      toast('success', `"${selected.label}" template saved — new sends will use it.`);
      await refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revert() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api.del(`/api/templates/${selected.kind}`);
      toast('success', `"${selected.label}" reverted to the built-in default.`);
      await refresh();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const previewBody = selected ? renderTemplate(draftBody, SAMPLE_VARS) : '';
  const info = selected && selected.channel === 'SMS' ? smsInfo(previewBody) : null;

  return (
    <div>
      <PageHeader
        title="Message Templates"
        subtitle="Customize the SMS, WhatsApp and email messages sent to tenants — revert to the built-in wording any time"
      />
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {loading && <SkeletonTable cols={1} rows={4} />}
      {!loading && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CHANNEL_LABEL) as TemplateState['channel'][]).map((key) => (
              <button key={key} type="button" onClick={() => setChannel(key)}
                className={key === channel ? CHANNEL_ACTIVE : CHANNEL_IDLE}>
                {CHANNEL_LABEL[key]}
              </button>
            ))}
          </div>
          {channelKinds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {channelKinds.map((t) => (
                <button key={t.kind} type="button" onClick={() => setSelectedKind(t.kind)}
                  className={t.kind === selected?.kind
                    ? 'flex items-center rounded-full border border-ash bg-fog px-4 py-1.5 text-sm font-medium text-brand-700'
                    : 'flex items-center rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50'}>
                  {t.customized && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-600" aria-hidden />}
                  {t.label}
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)]">
              <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                      <MessageSquareText size={18} className="text-brand-600" aria-hidden />
                      {selected.label}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">{selected.description}</p>
                  </div>
                  <span className={selected.customized
                    ? 'rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700'
                    : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600'}>
                    {selected.customized ? 'Customized' : 'Default'}
                  </span>
                </div>
                <div className="mt-5 space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {selected.fields.map((f) => (
                      <button key={f} type="button" onClick={() => insertField(f)} title={`Insert {{${f}}}`}
                        className="rounded-full bg-fog px-2.5 py-1 font-mono text-xs text-brand-700 hover:bg-ash">
                        {`{{${f}}}`}
                      </button>
                    ))}
                  </div>
                  {selected.hasSubject && (
                    <Field label="Subject">
                      <TextInput value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)}
                        placeholder={selected.defaultSubject ?? ''} />
                    </Field>
                  )}
                  <Field label="Body" hint="Click a merge field chip to insert it at the cursor position.">
                    <textarea ref={textareaRef} value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={9}
                      placeholder={selected.defaultBody}
                      className="w-full rounded-lg border border-ash bg-white px-3 py-2 text-base text-gray-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 md:text-sm" />
                  </Field>
                  <div className="flex items-center gap-4">
                    <Button onClick={save} disabled={busy || !dirty} loading={busy}>
                      <Save size={16} aria-hidden />
                      Save Template
                    </Button>
                    {selected.customized && (
                      <button type="button" onClick={revert} disabled={busy}
                        className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:underline disabled:opacity-50">
                        <RotateCcw size={14} aria-hidden />
                        Revert to default
                      </button>
                    )}
                  </div>
                  {selected.customized && selected.updated_at && (
                    <p className="text-xs text-gray-500">Customized {new Date(selected.updated_at).toLocaleString()}</p>
                  )}
                </div>
              </section>
              <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Live preview</h3>
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-ash bg-fog px-3 py-2 text-sm text-gray-900">
                  {previewBody}
                </pre>
                {info && (
                  <p className="mt-2 text-xs text-gray-600">
                    {info.segments} SMS segment{info.segments === 1 ? '' : 's'} · {info.chars} character{info.chars === 1 ? '' : 's'}
                  </p>
                )}
                <p className="mt-3 text-xs text-gray-500">
                  Preview uses sample data; real values are filled in per tenant at send time. Unknown merge tokens are left visible so typos are easy to spot.
                </p>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}