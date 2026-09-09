import { useMemo, useRef, useState } from 'react';
import { Button, Modal, useToast } from './ui';
import { api } from '../lib/api';
import { MONTHS, money } from '../lib/format';

// --- Types mirroring POST /api/tenants/:id/data-request-letter ---------------

export interface LetterBundle {
  exportedAt: string;
  subject: Record<string, unknown>;
  unit: Record<string, unknown> | null;
  data: Record<string, Record<string, unknown>[]>;
  retentionNote: string;
}

export interface LetterSummaryEntry {
  count: number;
  total: number;
}

export interface LetterData {
  registerRef: string;
  generatedAt: string;
  responseDays: string | null;
  branding: {
    legal_name: string | null;
    registration_number: string | null;
    address: string | null;
    contact_email: string | null;
    privacy_email: string | null;
    contact_phone: string | null;
    jurisdiction: string | null;
  };
  bundle: LetterBundle;
  /** Per-category record counts + money totals for the summary section. */
  summary: {
    rentPayments: LetterSummaryEntry;
    waterPayments: LetterSummaryEntry;
    waterReadings: LetterSummaryEntry;
    receipts: LetterSummaryEntry;
    smsNotifications: LetterSummaryEntry;
    auditTrail: LetterSummaryEntry;
  };
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Trustworthy cell text: strings pass through escaped, numbers formatted,
// dates humanized, nulls rendered as an em dash.
const cell = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-KE');
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return esc(new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }));
  }
  return esc(v);
};

// (heading, category key in bundle.data, table columns)
const ANNEX_SECTIONS: { heading: string; key: string; cols: [string, (r: Record<string, unknown>) => string][] }[] = [
  {
    heading: 'Annex A1 — Rent payments',
    key: 'rentPayments',
    cols: [
      ['Reference', (r) => cell(r.payment_reference)],
      ['Period', (r) => `${MONTHS[Number(r.billing_month) - 1]} ${r.billing_year}`],
      ['Paid on', (r) => cell(r.payment_date)],
      ['Amount', (r) => money(Number(r.amount))],
      ['Method', (r) => esc(String(r.payment_method ?? '').replace('_', '-'))],
    ],
  },
  {
    heading: 'Annex A2 — Water payments',
    key: 'waterPayments',
    cols: [
      ['Reference', (r) => cell(r.payment_reference)],
      ['Period', (r) => `${MONTHS[Number(r.billing_month) - 1]} ${r.billing_year}`],
      ['Paid on', (r) => cell(r.payment_date)],
      ['Amount', (r) => money(Number(r.amount))],
      ['Method', (r) => esc(String(r.payment_method ?? '').replace('_', '-'))],
    ],
  },
  {
    heading: 'Annex A3 — Water meter readings',
    key: 'waterReadings',
    cols: [
      ['Period', (r) => `${MONTHS[Number(r.billing_month) - 1]} ${r.billing_year}`],
      ['Read on', (r) => cell(r.reading_date)],
      ['Previous', (r) => cell(r.previous_reading)],
      ['Current', (r) => cell(r.current_reading)],
      ['Consumption', (r) => cell(r.consumption)],
      ['Bill', (r) => money(Number(r.water_bill))],
    ],
  },
  {
    heading: 'Annex A4 — Receipts issued',
    key: 'receipts',
    cols: [
      ['Receipt no.', (r) => cell(r.receipt_number)],
      ['Type', (r) => esc(String(r.receipt_type ?? ''))],
      ['Period', (r) => `${MONTHS[Number(r.billing_month) - 1]} ${r.billing_year}`],
      ['Paid on', (r) => cell(r.payment_date)],
      ['Rent', (r) => money(Number(r.rent_amount))],
      ['Water', (r) => money(Number(r.water_amount))],
      ['Total', (r) => money(Number(r.total_amount))],
    ],
  },
  {
    heading: 'Annex A5 — SMS messages sent',
    key: 'smsNotifications',
    cols: [
      ['To', (r) => cell(r.phone_number)],
      ['Status', (r) => esc(String(r.status ?? ''))],
      ['Sent at', (r) => cell(r.sent_at)],
      ['Message', (r) => cell(r.message)],
    ],
  },
];

// --- The formal letter, as a standalone printable document -------------------

export function letterHtml(letter: LetterData, opts: { withButton?: boolean } = {}): string {
  const { branding, bundle } = letter;
  const subject = bundle.subject;
  const unit = bundle.unit;
  const name = String(subject.full_name ?? 'the data subject');

  const letterheadLines = [
    [branding.address, branding.contact_phone, branding.contact_email].filter(Boolean).map((v) => esc(v)).join(' · '),
    branding.privacy_email ? `Privacy contact: ${esc(branding.privacy_email)}` : null,
  ].filter(Boolean);

  const responseDays = letter.responseDays ?? '30';

  const summaryRows: [string, string, string | null][] = [
    ['Rent payments', String(letter.summary.rentPayments.count), money(letter.summary.rentPayments.total)],
    ['Water payments', String(letter.summary.waterPayments.count), money(letter.summary.waterPayments.total)],
    ['Water meter readings', String(letter.summary.waterReadings.count), money(letter.summary.waterReadings.total)],
    ['Receipts issued', String(letter.summary.receipts.count), money(letter.summary.receipts.total)],
    ['SMS messages sent', String(letter.summary.smsNotifications.count), null],
    ['Audit trail entries', String(letter.summary.auditTrail.count), null],
  ];

  const identityRows: [string, string][] = [
    ['Full name', cell(subject.full_name)],
    ['Phone number', cell(subject.phone_number)],
    ['Email address', cell(subject.email)],
    ['Unit', unit ? `Unit ${cell(unit.unit_number)} (${cell(unit.unit_type)})` : '—'],
    ['Tenancy status', cell(subject.status)],
  ];

  const sections = ANNEX_SECTIONS.map(({ heading, key, cols }) => {
    const records = bundle.data[key] ?? [];
    if (records.length === 0) return null;
    const rows = records
      .map((r) => `<tr>${cols.map(([, render]) => `<td>${render(r)}</td>`).join('')}</tr>`)
      .join('');
    return `
      <h2>${heading}</h2>
      <table>
        <thead><tr>${cols.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  })
    .filter(Boolean)
    .join('');

  const annexNote = sections
    ? ''
    : `<p class="muted">No transactional records are held for this person beyond the personal details listed above.</p>`;

  const privacyContact = branding.privacy_email
    ? `<a href="mailto:${esc(branding.privacy_email)}">${esc(branding.privacy_email)}</a>`
    : branding.contact_email
      ? `<a href="mailto:${esc(branding.contact_email)}">${esc(branding.contact_email)}</a>`
      : 'the property office';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(letter.registerRef)} — Response to data request</title>
    <style>
      body { font-family: Georgia, 'Times New Roman', serif; margin: 40px; color: #111827; font-size: 14px; line-height: 1.55; }
      .sheet { max-width: 720px; margin: 0 auto; }
      .letterhead { border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 24px; }
      .letterhead .brand { font-size: 17px; font-weight: 700; font-family: ui-sans-serif, system-ui, sans-serif; }
      .letterhead .lines { color: #6b7280; font-size: 12px; margin-top: 4px; font-family: ui-sans-serif, system-ui, sans-serif; }
      h1 { font-size: 18px; margin: 0 0 4px; font-family: ui-sans-serif, system-ui, sans-serif; }
      .ref { color: #6b7280; font-size: 12.5px; font-family: ui-sans-serif, system-ui, sans-serif; }
      h2 { font-size: 14.5px; margin: 28px 0 8px; font-family: ui-sans-serif, system-ui, sans-serif; }
      p { margin: 10px 0; }
      .muted { color: #6b7280; font-size: 12.5px; }
      table { width: 100%; border-collapse: collapse; margin: 10px 0 4px; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; }
      th { text-align: left; background: #f3f4f6; border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.03em; }
      td { border: 1px solid #e5e7eb; padding: 6px 8px; vertical-align: top; }
      .sign { margin-top: 36px; }
      .enc { margin-top: 20px; padding: 10px 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 12.5px; }
      @media print { .no-print { display: none; } }
    </style></head><body><div class="sheet">
    <div class="letterhead">
      <div class="brand">${branding.legal_name ? esc(branding.legal_name) : esc(name)}</div>
      ${letterheadLines.map((l) => `<div class="lines">${l}</div>`).join('')}
    </div>
    <h1>Response to your personal-data request</h1>
    <div class="ref">Our ref: ${esc(letter.registerRef)} · Dated ${esc(new Date(letter.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</div>

    <p>Dear ${esc(name)},</p>

    <p>We refer to your request for access to the personal data we hold about you. We confirm that we have
    processed your request, and the personal data we hold is set out below and in the annexes to this letter.
    A complete machine-readable copy of the same data is enclosed with this letter as a JSON file.</p>

    <p>This response is provided under the Data Protection Act, 2019 (Kenya) and, where applicable, the General
    Data Protection Regulation (EU) 2016/679. Data-subject requests are answered within ${esc(responseDays)} days of
    receipt, as stated in our Privacy Policy.</p>

    <h2>Personal details held</h2>
    <table>
      <tbody>
        ${identityRows.map(([label, value]) => `<tr><td style="width:35%;background:#f9fafb">${label}</td><td>${value}</td></tr>`).join('')}
      </tbody>
    </table>

    <h2>Summary of the data provided</h2>
    <p class="muted" style="margin-bottom:4px">Record counts per category; the full detail follows in the annexes and the attached data file.</p>
    <table>
      <thead><tr><th>Category</th><th>Records</th><th>Total</th></tr></thead>
      <tbody>
        ${summaryRows.map(([label, count, total]) => `<tr><td>${label}</td><td>${count}</td><td>${total ?? '—'}</td></tr>`).join('')}
      </tbody>
    </table>

    ${sections || annexNote}

    <h2>Retention of financial records</h2>
    <p class="muted">${esc(bundle.retentionNote)}</p>

    <p>If you believe any data is inaccurate, or you wish to exercise any other data-subject right, please contact
    ${privacyContact}.${branding.jurisdiction ? ` This response is governed by the laws of ${esc(branding.jurisdiction)}.` : ''}</p>

    <div class="sign">
      <p>Yours faithfully,</p>
      <p style="margin-top:28px">____________________________<br>
      <span class="muted">For and on behalf of ${branding.legal_name ? esc(branding.legal_name) : 'the operator'}</span></p>
    </div>

    <div class="enc"><b>Enclosure:</b> tenant-${esc(String(subject.id ?? ''))}-personal-data.json — complete copy of the data listed above.</div>

    ${opts.withButton ? `<button class="no-print" style="margin-top:16px;padding:8px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-family:ui-sans-serif,system-ui,sans-serif" onclick="window.print()">Print</button>` : ''}
  </div></body></html>`;
}

// Modal: live letter preview + Print + enclosure download + optional email
// delivery of the letter (with the JSON data file attached) to the tenant.
export function DataRequestLetterModal({ letter, onClose, tenantEmail }: { letter: LetterData | null; onClose: () => void; tenantEmail: string | null }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();
  const [showEmail, setShowEmail] = useState(false);
  const [toEmail, setToEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const subjectId = letter ? String((letter.bundle.subject as { id?: number }).id ?? '') : '';
  const filename = useMemo(() => `tenant-${subjectId}-personal-data.json`, [subjectId]);

  function printLetter() {
    if (!letter) return;
    // Preferred: print the preview iframe, which already holds the letter.
    const frame = frameRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      return;
    }
    // Fallback: popup with an in-document Print button.
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(letterHtml(letter, { withButton: true }));
    w.document.close();
    w.focus();
  }

  function downloadEnclosure() {
    if (!letter) return;
    const blob = new Blob([JSON.stringify(letter.bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function emailLetter() {
    if (!letter || !toEmail.trim()) return;
    setEmailBusy(true);
    try {
      // Reuses THIS letter's register reference — the register entry is not duplicated.
      const res = await api.post<{ data: { registerRef: string; emailStatus: string; sentTo: string; failureReason: string | null } }>(
        `/api/tenants/${subjectId}/data-request-letter/email`,
        { registerRef: letter.registerRef }
      );
      if (res.data.emailStatus === 'SENT') {
        toast('success', `Letter ${res.data.registerRef} emailed to ${res.data.sentTo} with the data file attached.`);
        setShowEmail(false);
      } else {
        toast('error', res.data.failureReason ?? 'The email could not be sent.');
      }
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <Modal open={letter !== null} title={letter ? `Response letter ${letter.registerRef}` : ''} onClose={onClose}>
      {letter && (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-gray-500">
            Formal response to the data-subject request with the register reference and an export summary in the
            letter body. The enclosure is the machine-readable data file — this action is logged in the privacy
            register exactly once, by the server.
          </p>
          <iframe
            ref={frameRef}
            title="Preview of the data-request response letter"
            srcDoc={letterHtml(letter)}
            className="h-[60vh] w-full rounded-lg border border-gray-200 bg-white"
            sandbox="allow-same-origin allow-modals"
          />
          {showEmail && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="font-medium text-gray-800">Email the letter + data file</div>
              <p className="mt-1 text-xs text-gray-500">
                Sends this letter as the email body with the JSON data file attached. Uses this letter's register
                reference — no duplicate register entry.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="tenant@email.com"
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  aria-label="Recipient email address"
                />
                <Button onClick={emailLetter} disabled={emailBusy || !toEmail.trim()}>
                  {emailBusy ? 'Sending…' : 'Send email'}
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button variant="secondary" onClick={() => { setToEmail(tenantEmail ?? ''); setShowEmail((s) => !s); }}>
              {showEmail ? 'Cancel email' : 'Email to tenant…'}
            </Button>
            <Button variant="secondary" onClick={downloadEnclosure}>Download enclosure (JSON)</Button>
            <Button onClick={printLetter}>Print</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

