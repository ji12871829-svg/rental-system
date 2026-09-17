import { useRef, useState } from 'react';
import { Download, Mail, Plus } from 'lucide-react';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api, authenticatedFetch, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { branding, receiptFooterLines } from '../lib/branding';
import { MONTHS, formatDate, money } from '../lib/format';
import { useQueryParam } from '../lib/useQueryParam';

interface Receipt {
  id: number;
  receipt_number: string;
  receipt_type: 'RENT' | 'WATER' | 'COMBINED';
  tenant_id: number;
  unit_id: number;
  payment_date: string;
  billing_month: number;
  billing_year: number;
  rent_amount: string;
  water_amount: string;
  total_amount: string;
  balance: string;
  generated_at: string;
  tenant_name: string;
  phone_number: string | null;
  unit_number: string;
  unit_type: string;
}

interface TenantOption { id: number; full_name: string; unit_number: string | null }

interface EmailConfig {
  provider: 'mock' | 'smtp' | 'brevo';
  live: boolean;
  from: string | null;
}

interface EmailNotification {
  id: number;
  receipt_id: number | null;
  email_address: string;
  subject: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  failure_reason: string | null;
  created_at: string;
  tenant_name: string;
  unit_number: string | null;
}

const TYPE_STYLES: Record<string, string> = {
  RENT: 'bg-brand-100 text-brand-800',
  WATER: 'bg-sky-100 text-sky-800',
  COMBINED: 'bg-purple-100 text-purple-800',
};

// Full standalone document for one receipt — used both for the in-modal
// preview (iframe srcdoc) and the popup print fallback.
function receiptHtml(r: Receipt, opts: { withButton?: boolean } = {}): string {
  const typeLabel = r.receipt_type === 'RENT' ? 'RENT RECEIPT' : r.receipt_type === 'WATER' ? 'WATER RECEIPT' : 'COMBINED RECEIPT (RENT + WATER)';
  const identityFooter = receiptFooterLines.length > 0 ? `<p class="muted" style="margin-top:10px">${receiptFooterLines.join('<br>')}</p>` : '';
  return `<!doctype html><html><head><title>${r.receipt_number}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 40px; color: #111827; }
      .card { max-width: 640px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; padding: 32px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .muted { color: #6b7280; font-size: 13px; }
      .muted a { color: #6b7280; text-decoration: underline; }
      .num { font-size: 26px; font-weight: 800; margin: 8px 0 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; }
      td { padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
      td:last-child { text-align: right; font-weight: 600; }
      .total { font-size: 16px; font-weight: 800; border-top: 2px solid #111827; }
      @media print { .no-print { display: none; } }
    </style></head><body><div class="card">
    <h1>${branding.appNameLong}</h1>
    <div class="muted">${typeLabel}</div>
    <div class="num">${r.receipt_number}</div>
    <table>
      <tr><td>Tenant</td><td>${r.tenant_name}</td></tr>
      <tr><td>Unit</td><td>${r.unit_number} (${r.unit_type})</td></tr>
      <tr><td>Billing period</td><td>${MONTHS[r.billing_month - 1]} ${r.billing_year}</td></tr>
      <tr><td>Payment date</td><td>${new Date(r.payment_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
      ${Number(r.rent_amount) > 0 ? `<tr><td>Rent paid</td><td>${money(r.rent_amount)}</td></tr>` : ''}
      ${Number(r.water_amount) > 0 ? `<tr><td>Water paid</td><td>${money(r.water_amount)}</td></tr>` : ''}
      <tr><td class="total">Total paid</td><td class="total">${money(r.total_amount)}</td></tr>
      <tr><td>Balance after payment</td><td>${money(r.balance)}</td></tr>
    </table>
    <p class="muted" style="margin-top:24px">Generated ${new Date(r.generated_at).toLocaleString()} — thank you.</p>
    ${identityFooter}
    ${opts.withButton ? `<button class="no-print" style="margin-top:16px;padding:8px 16px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer" onclick="window.print()">Print</button>` : ''}
  </div></body></html>`;
}

export default function Receipts() {
  const { toast } = useToast();
  const { canManage } = useAuth();
  const now = new Date();
  const [q, setQ] = useState('');
  // Filters live in the URL (?receiptType=&month=) so dashboard chart bars
  // can deep-link straight to a filtered receipt list — shared hook syncs
  // both ways.
  const [typeFilter, setTypeFilter] = useQueryParam('receiptType');
  const [monthFilter, setMonthFilter] = useQueryParam('month');
  const [yearFilter, setYearFilter] = useState(String(now.getFullYear()));
  const [page, setPage] = useState(1);
  const [showGenerate, setShowGenerate] = useState(false);
  const [printTarget, setPrintTarget] = useState<Receipt | null>(null);
  const [emailTarget, setEmailTarget] = useState<Receipt | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useFetch(
    () => api.list<Receipt>(`/api/receipts${qs({ page, limit: 20, q: q || undefined, receiptType: typeFilter || undefined, month: monthFilter || undefined, year: yearFilter || undefined })}`),
    [page, q, typeFilter, monthFilter, yearFilter, refreshKey]
  );
  const { data: tenants } = useFetch(() => api.list<TenantOption>('/api/tenants?status=ACTIVE&limit=100'));
  const { data: emailConfig } = useFetch(() => api.get<{ data: EmailConfig }>('/api/emails/config'), []);

  const refresh = () => setRefreshKey((k) => k + 1);

  // Downloads the server-generated PDF (pdf-lib) as a file. Uses a raw fetch
  // with the auth header, then a temporary object URL for the blob.
  async function downloadReceiptPdf(r: Receipt) {
    setPdfBusy(true);
    try {
      const res = await authenticatedFetch(`/api/receipts/${r.id}/pdf`);
      if (!res.ok) throw new Error('Could not generate the PDF.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.receipt_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  // Prints the exact receipt document shown in the preview iframe; falls back
  // to a popup (same HTML) if iframe printing is unavailable.
  function printReceipt(r: Receipt) {
    const frame = previewFrameRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      return;
    }
    const win = window.open('', '_blank', 'width=800,height=900');
    if (!win) {
      toast('error', 'Printing was blocked — allow pop-ups for this site.');
      return;
    }
    win.document.write(receiptHtml(r, { withButton: true }));
    win.document.close();
  }

  return (
    <div>
      <PageHeader
        title="Receipts"
        subtitle="RC- = rent, WC- = water, RWC- = combined. Click View to preview a receipt before printing it."
        actions={<Button onClick={() => setShowGenerate(true)}><Plus size={16} strokeWidth={2} aria-hidden /> Generate Combined Receipt</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput placeholder="Search number, tenant or unit…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-40">
          <option value="">All types</option>
          <option value="RENT">Rent (RC)</option>
          <option value="WATER">Water (WC)</option>
          <option value="COMBINED">Combined (RWC)</option>
        </Select>
        <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="w-40">
          <option value="">All months</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
        <Select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="w-24">
          {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        {/* Bulk export: every receipt of the chosen month merged into one PDF. */}
        {monthFilter && (
          <a
            href={`${import.meta.env.VITE_API_URL ?? ''}/api/receipts/export.pdf?month=${monthFilter}&year=${yearFilter || now.getFullYear()}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 active:scale-[0.98]"
            onClick={(e) => {
              e.preventDefault();
              authenticatedFetch(`/api/receipts/export.pdf?month=${monthFilter}&year=${yearFilter || now.getFullYear()}`)
                .then(async (r) => {
                  if (!r.ok) {
                    const body = await r.json().catch(() => null);
                    throw new Error(body?.message ?? `Export failed (${r.status}).`);
                  }
                  return r.blob();
                })
                .then((blob) => {
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `receipts-${yearFilter || now.getFullYear()}-${String(monthFilter).padStart(2, '0')}.pdf`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                })
                .catch((err) => toast('error', (err as Error).message));
            }}
          >
            <Download size={15} strokeWidth={1.75} aria-hidden /> Download all (PDF)
          </a>
        )}
      </div>

      {loading && <SkeletonTable cols={11} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Receipt #</th><th>Type</th><th>Tenant</th><th>Unit</th><th>Month</th>
                  <th>Rent</th><th>Water</th><th>Total</th><th>Balance</th><th>Generated</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs font-semibold text-gray-900">{r.receipt_number}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_STYLES[r.receipt_type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {r.receipt_type}
                      </span>
                    </td>
                    <td className="font-medium">{r.tenant_name}</td>
                    <td>Unit {r.unit_number}</td>
                    <td>{MONTHS[r.billing_month - 1].slice(0, 3)} {r.billing_year}</td>
                    <td>{money(r.rent_amount)}</td>
                    <td>{money(r.water_amount)}</td>
                    <td className="font-semibold">{money(r.total_amount)}</td>
                    <td className={Number(r.balance) > 0 ? 'font-medium text-red-600' : 'text-emerald-700'}>{money(r.balance)}</td>
                    <td className="text-xs text-gray-500">{formatDate(r.generated_at)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setPrintTarget(r)}>View</Button>
                        {canManage && (
                          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setEmailTarget(r)}>
                            <Mail size={14} strokeWidth={1.75} aria-hidden className="mr-1" />Email
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No receipts found — receipts are generated automatically with every payment." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      <GenerateModal
        open={showGenerate}
        tenants={tenants?.data ?? []}
        onClose={() => setShowGenerate(false)}
        onSaved={(msg) => { setShowGenerate(false); refresh(); toast('success', msg); }}
      />

      {canManage && (
        <EmailModal
          receipt={emailTarget}
          provider={emailConfig?.data.provider ?? 'mock'}
          live={emailConfig?.data.live ?? false}
          from={emailConfig?.data.from ?? null}
          onClose={() => setEmailTarget(null)}
        />
      )}

      {/* Detail modal: live receipt preview + print. */}
      <Modal open={printTarget !== null} title={printTarget ? `Receipt ${printTarget.receipt_number}` : ''} onClose={() => setPrintTarget(null)}>
        {printTarget && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusBadge status={printTarget.receipt_type} />
              <span className="text-gray-500">{printTarget.tenant_name} — Unit {printTarget.unit_number}</span>
            </div>
            <iframe
              ref={previewFrameRef}
              title={`Preview of receipt ${printTarget.receipt_number}`}
              srcDoc={receiptHtml(printTarget)}
              className="h-[60vh] w-full rounded-lg border border-gray-200 bg-white"
              sandbox="allow-same-origin allow-modals"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPrintTarget(null)}>Close</Button>
              <Button variant="secondary" onClick={() => downloadReceiptPdf(printTarget)} disabled={pdfBusy}>
                {pdfBusy ? 'Generating…' : 'Download PDF'}
              </Button>
              <Button onClick={() => printReceipt(printTarget)}>Print</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Email-receipt dialog: sends the receipt as the email body plus the real
// receipt PDF as attachment via the configured provider (mock = simulated).
function EmailModal({ receipt, provider, live, from, onClose }: {
  receipt: Receipt | null;
  provider: 'mock' | 'smtp' | 'brevo';
  live: boolean;
  from: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [toEmail, setToEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(toEmail.trim());

  async function send() {
    if (!receipt) return;
    setBusy(true);
    try {
      await api.post<{ data: EmailNotification }>(
        `/api/receipts/${receipt.id}/email`,
        toEmail.trim() ? { toEmail: toEmail.trim() } : undefined
      );
      toast('success', `Receipt ${receipt.receipt_number} emailed${provider === 'mock' ? ' (simulated — recorded, not delivered)' : ` to ${toEmail.trim() || 'the tenant'}.`}`);
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={receipt !== null} title={receipt ? `Email receipt ${receipt.receipt_number}` : ''} onClose={onClose}>
      {receipt && (
        <div className="space-y-4 text-sm">
          <p className="text-gray-600">
            Sends <strong>{receipt.receipt_number}</strong> ({receipt.tenant_name} — Unit {receipt.unit_number}) as the email body with the real receipt PDF attached.
          </p>
          <Field
            label="Send to"
            hint="Leave empty to use the tenant's email address on file."
          >
            <TextInput
              type="email"
              placeholder="tenant@example.com"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
            />
          </Field>
          <p className={`rounded-lg px-3 py-2 text-xs ${provider === 'mock' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}>
            {provider === 'mock'
              ? 'Email provider is in simulated mode — the send is recorded in history but not delivered. Set EMAIL_PROVIDER=brevo with BREVO_API_KEY, EMAIL_FROM, and BREVO_TEST_RECIPIENTS for safe testing.'
              : live
                ? provider === 'brevo'
                  ? `Delivers via Brevo from ${from ?? 'the configured sender'}; test recipients are controlled by BREVO_TEST_RECIPIENTS.`
                  : `Delivers via SMTP from ${from ?? 'the configured sender'}.`
                : provider === 'brevo'
                  ? 'Brevo is selected but not fully configured — set BREVO_API_KEY, EMAIL_FROM, and EMAIL_FROM_NAME.'
                  : 'SMTP is selected but not fully configured — sends will fail until SMTP_HOST / SMTP_USER / SMTP_PASS / EMAIL_FROM are set in backend/.env.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={send} disabled={busy || (toEmail.trim() !== '' && !valid)}>
              {busy ? 'Sending…' : provider === 'mock' ? 'Simulate send' : 'Send email'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function GenerateModal({ open, tenants, onClose, onSaved }: { open: boolean; tenants: TenantOption[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [tenantId, setTenantId] = useState<number | ''>('');
  const [billingMonth, setBillingMonth] = useState(now.getMonth() + 1);
  const [billingYear, setBillingYear] = useState(now.getFullYear());
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (tenantId === '') { toast('error', 'Select a tenant.'); return; }
    setBusy(true);
    try {
      const res = await api.post<{ data: Receipt }>('/api/receipts/generate', { tenantId, billingMonth, billingYear });
      onSaved(`Combined receipt ${res.data.receipt_number} ready.`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Generate Combined (RWC) Receipt" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Tenant">
          <Select value={tenantId} onChange={(e) => setTenantId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">— Select tenant —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.full_name}{t.unit_number ? ` — Unit ${t.unit_number}` : ''}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Billing Month">
            <Select value={billingMonth} onChange={(e) => setBillingMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Billing Year"><TextInput type="number" value={billingYear} onChange={(e) => setBillingYear(Number(e.target.value))} /></Field>
        </div>
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Aggregates every rent and water payment the tenant made in that month into one RWC-YYYY-#### receipt. Generating twice reuses the same receipt.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate Receipt'}</Button>
        </div>
      </div>
    </Modal>
  );
}
