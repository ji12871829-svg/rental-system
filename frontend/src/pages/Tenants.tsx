import { useState, type ReactNode } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Field, Modal, PageHeader, Pagination, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { DataRequestLetterModal, type LetterData } from '../components/DataRequestLetter';
import { api, authenticatedFetch, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, formatDate } from '../lib/format';

interface Tenant {
  id: number;
  full_name: string;
  phone_number: string | null;
  email: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  security_deposit: string;
  status: 'ACTIVE' | 'MOVED_OUT';
  unit_number: string | null;
  unit_type: string | null;
  monthly_rent: string | null;
  water_enabled: boolean;
  rent_deadline: string | null;
  current_month_rent_paid: string;
  current_month_rent_status: string;
  has_rent_payment_history: boolean;
  notes: string | null;
  balances?: {
    reportingYear: number;
    rentPaid: number; rentBalance: number; waterBilled: number; waterPaid: number;
    waterBalance: number; combinedBalance: number;
  };
}

export default function Tenants() {
  const { canManage, isAdmin } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Tenant | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<Tenant | null>(null);
  const [transferTarget, setTransferTarget] = useState<Tenant | null>(null);
  const [privacyRequest, setPrivacyRequest] = useState<{ tenant: Tenant; action: 'json' | 'csv' | 'erase' | 'letter' } | null>(null);
  const [letter, setLetter] = useState<LetterData | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [portalTenant, setPortalTenant] = useState<Tenant | null>(null);

  const { data, loading, error } = useFetch(
    () => api.list<Tenant>(`/api/tenants${qs({ q, status: status || undefined, page, limit: 25 })}`),
    [q, status, page, refreshKey]
  );
  const refresh = () => setRefreshKey((k) => k + 1);

  function deadlineStatus(deadline: string | null): string {
    if (!deadline) return 'NO MOVE-IN DATE';
    const today = new Date();
    const due = new Date(`${deadline.slice(0, 10)}T00:00:00`);
    today.setHours(0, 0, 0, 0);
    if (due.getTime() > today.getTime()) return 'UPCOMING';
    if (due.getTime() === today.getTime()) return 'DUE TODAY';
    return 'OVERDUE';
  }

  async function handleTenantAction(action: string, tenant: Tenant) {
    if (action === 'view') {
      const res = await api.get<{ data: Tenant }>(`/api/tenants/${tenant.id}`);
      setDetail(res.data);
    } else if (action === 'ledger') {
      navigate(`/ledger?tenant=${tenant.id}`);
    } else if (action === 'edit') {
      setEdit(tenant);
      setShowForm(true);
    } else if (action === 'transfer') {
      setTransferTarget(tenant);
    } else if (action === 'move-out') {
      if (!window.confirm(`Move ${tenant.full_name} out of unit ${tenant.unit_number}?`)) return;
      try {
        await api.post(`/api/tenants/${tenant.id}/move-out`, { moveOutDate: new Date().toISOString().slice(0, 10) });
        toast('success', `${tenant.full_name} moved out — unit is now VACANT.`);
        refresh();
      } catch (err) { toast('error', (err as Error).message); }
    } else if (action === 'portal') {
      setPortalTenant(tenant);
    } else if (action === 'delete') {
      if (!window.confirm(`Permanently delete ${tenant.full_name}?`)) return;
      try {
        await api.del(`/api/tenants/${tenant.id}`);
        toast('success', 'Tenant deleted.');
        refresh();
      } catch (err) { toast('error', (err as Error).message); }
    }
  }

  // Data-subject rights actions run through PrivacyRequestModal, which
  // captures requester + reason and logs every action in the register.

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Current-month rent status, payment history, and the 10-day move-in deadline"
        actions={canManage ? <Button onClick={() => { setEdit(null); setShowForm(true); }}><Plus size={16} strokeWidth={2} aria-hidden /> Add Tenant</Button> : undefined}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <TextInput placeholder="Search name, phone, email or unit…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="MOVED_OUT">Moved out</option>
        </Select>
      </div>

      {loading && <SkeletonTable cols={8} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tenant</th><th>Phone</th><th>Unit</th><th>Move In</th><th>Rent Deadline</th>
                <th>Current Month</th><th>Payment History</th><th>Deposit</th><th>Status</th><th>Balances (YTD)</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="font-semibold text-gray-900">{t.full_name}</div>
                    <div className="text-xs text-gray-500">
                      {t.email ? (
                        <a href={`mailto:${t.email}`} className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline">{t.email}</a>
                      ) : ''}
                    </div>
                  </td>
                  <td>
                    {t.phone_number ? (
                      <a href={`tel:${t.phone_number.replace(/\s+/g, '')}`} className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline">{t.phone_number}</a>
                    ) : '—'}
                  </td>
                  <td>{t.unit_number ? `Unit ${t.unit_number}` : '—'}</td>
                  <td>{formatDate(t.move_in_date)}</td>
                  <td>
                    <div>{formatDate(t.rent_deadline)}</div>
                    <div className="text-xs text-gray-500">{deadlineStatus(t.rent_deadline)}</div>
                  </td>
                  <td>
                    <StatusBadge status={t.current_month_rent_status} />
                    <div className="mt-1 text-xs text-gray-500">{money(t.current_month_rent_paid)} paid</div>
                  </td>
                  <td><StatusBadge status={t.has_rent_payment_history ? 'PAID' : 'UNPAID'} /></td>
                  <td>{money(t.security_deposit)}</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>
                    {t.status === 'ACTIVE' && (
                      <span className="text-xs">
                        Rent: <b className={Number(t.balances?.rentBalance ?? 0) > 0 ? 'text-red-600' : 'text-emerald-700'}>{money(t.balances?.rentBalance ?? 0)}</b>
                        {' · '}Water: <b className={Number(t.balances?.waterBalance ?? 0) > 0 ? 'text-red-600' : 'text-emerald-700'}>{money(t.balances?.waterBalance ?? 0)}</b>
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end">
                      <select
                        aria-label={`Actions for ${t.full_name}`}
                        defaultValue=""
                        onChange={(event) => {
                          const action = event.target.value;
                          event.currentTarget.value = '';
                          void handleTenantAction(action, t);
                        }}
                        className="min-h-9 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm outline-none transition-colors hover:border-gray-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="" disabled>Actions</option>
                        <option value="view">View details</option>
                        <option value="ledger">Open ledger</option>
                        {canManage && t.status === 'ACTIVE' && t.email && (
                          <option value="portal">Portal access…</option>
                        )}
                      {canManage && t.status === 'ACTIVE' && (
                        <>
                          <option value="edit">Edit tenant</option>
                          <option value="transfer">Transfer unit</option>
                          <option value="move-out">Move out</option>
                        </>
                      )}
                      {isAdmin && (
                        <option value="delete">Delete tenant</option>
                      )}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.data.length === 0 && <div className="p-6"><EmptyState message="No tenants found." /></div>}
        </div>
      )}
      {!loading && !error && data && <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />}

      <TenantForm open={showForm} tenant={edit} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refresh(); toast('success', edit ? 'Tenant updated.' : 'Tenant added.'); }} />

      <Modal open={detail !== null} title={detail?.full_name ?? ''} onClose={() => setDetail(null)} wide>
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Info label="Phone" value={detail.phone_number ? <a href={`tel:${detail.phone_number.replace(/\s+/g, '')}`} className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline">{detail.phone_number}</a> : '—'} />
              <Info label="Email" value={detail.email ? <a href={`mailto:${detail.email}`} className="underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline">{detail.email}</a> : '—'} />
              <Info label="Unit" value={detail.unit_number ? `Unit ${detail.unit_number} (${detail.unit_type})` : '—'} />
              <Info label="Monthly Rent" value={money(detail.monthly_rent)} />
              <Info label="Move In" value={formatDate(detail.move_in_date)} />
              <Info label="Move Out" value={formatDate(detail.move_out_date)} />
              <Info label="Security Deposit" value={money(detail.security_deposit)} />
              <Info label="Water Billing" value={detail.water_enabled ? 'Enabled' : 'Not applicable'} />
            </div>
            {detail.balances && (
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="mb-2 font-semibold text-gray-800">Balances ({detail.balances.reportingYear})</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Info label="Rent Paid" value={money(detail.balances.rentPaid)} />
                  <Info label="Rent Balance" value={money(detail.balances.rentBalance)} />
                  <Info label="Water Paid" value={money(detail.balances.waterPaid)} />
                  <Info label="Water Balance" value={money(detail.balances.waterBalance)} />
                </div>
              </div>
            )}
            {isAdmin && (
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="font-semibold text-gray-800">Data privacy (DPA 2019 / GDPR)</div>
                <p className="mt-1 text-xs text-gray-500">
                  Respond to data-subject requests: export everything the system holds about this tenant, or erase
                  their personal identifiers after the tenancy ends (financial records are always retained).
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setPrivacyRequest({ tenant: detail, action: 'letter' })}>Response letter (print)</Button>
                  <Button variant="secondary" onClick={() => setPrivacyRequest({ tenant: detail, action: 'json' })}>Export personal data (JSON)</Button>
                  <Button variant="secondary" onClick={() => setPrivacyRequest({ tenant: detail, action: 'csv' })}>Export personal data (CSV)</Button>
                  <Button variant="ghost" className="!px-2 !py-1.5 text-xs text-red-600" onClick={() => setPrivacyRequest({ tenant: detail, action: 'erase' })}>Erase personal data…</Button>
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => navigate(`/ledger?tenant=${detail.id}`)}>Open Full Ledger</Button>
            </div>
          </div>
        )}
      </Modal>

      <PrivacyRequestModal
        request={privacyRequest}
        onClose={() => setPrivacyRequest(null)}
        onDone={(msg) => { setPrivacyRequest(null); refresh(); toast('success', msg); }}
        onErased={(msg) => { setPrivacyRequest(null); setDetail(null); refresh(); toast('success', msg); }}
        onLetter={(l) => setLetter(l)}
      />

      <DataRequestLetterModal letter={letter} onClose={() => setLetter(null)} tenantEmail={detail?.email ?? null} />

      <TransferModal tenant={transferTarget} onClose={() => setTransferTarget(null)} onDone={() => { setTransferTarget(null); refresh(); toast('success', 'Tenant transferred.'); }} />

      <PortalAccessModal
        tenant={portalTenant}
        onClose={() => setPortalTenant(null)}
        onDone={(msg) => { setPortalTenant(null); refresh(); toast('success', msg); }}
      />
    </div>
  );
}

// Staff dialog to grant/rotate/revoke a tenant's portal credentials.
// The generated password is shown exactly once — only its hash is stored.
function PortalAccessModal({ tenant, onClose, onDone }: {
  tenant: Tenant | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [deliverEmail, setDeliverEmail] = useState(true);
  const [credentials, setCredentials] = useState<{ email: string; password: string; emailed: string } | null>(null);

  async function issue() {
    if (!tenant) return;
    setBusy(true);
    try {
      // The API wraps payloads in { data }: read res.data, not res itself.
      // deliverEmail=true sends the generated password straight to the
      // tenant; false keeps the old show-once-only flow.
      const res = await api.post<{ data: { email: string; temporaryPassword?: string; credentialsEmailed?: string } }>(
        `/api/tenants/${tenant.id}/portal-access`,
        { deliverEmail },
      );
      const d = res.data;
      if (d.temporaryPassword) {
        // Keep the modal OPEN so the one-time password is actually seen —
        // rotation has already happened server-side. The emailed flag drives
        // the status note under the credentials.
        setCredentials({ email: d.email, password: d.temporaryPassword, emailed: d.credentialsEmailed ?? 'skipped' });
      } else {
        // Custom password (or none generated): nothing to display.
        onDone(deliverEmail
          ? 'Portal access issued. Custom passwords are not emailed — share it yourself.'
          : 'Portal access issued.');
      }
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!tenant || !window.confirm(`Disable portal access for ${tenant.full_name}? The tenant is signed out on their next request.`)) return;
    setBusy(true);
    try {
      await api.del(`/api/tenants/${tenant.id}/portal-access`);
      // No credentials to show here — closing is correct for revoke.
      onDone('Portal access revoked.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Closing after an issue confirms success (toast + refresh); closing
  // without issuing is a plain dismiss.
  function handleClose() {
    const c = credentials;
    setCredentials(null);
    if (c) {
      onDone(c.emailed === 'sent'
        ? 'Portal access issued. Credentials were emailed to the tenant.'
        : 'Portal access issued. Share the password securely — it is shown only once.');
    } else {
      onClose();
    }
  }

  return (
    <Modal open={tenant !== null} title={`Tenant Portal — ${tenant?.full_name ?? ''}`} onClose={handleClose}>
      {tenant && (
        <div className="space-y-4 text-sm">
          <p className="text-gray-600">
            Issues a login for <b>{tenant.email}</b> at <b>/portal</b>. The tenant can view their
            rent balance, water charges, payment history and download their statement, and can pay
            rent via M-Pesa.
          </p>
          {credentials && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
              <div className="font-medium text-brand-800">Share these credentials now — shown only once:</div>
              <div className="mt-2 font-mono text-xs text-gray-800">Email: {credentials.email}</div>
              <div className="font-mono text-xs text-gray-800">Password: {credentials.password}</div>
              {credentials.emailed === 'sent' && (
                <div className="mt-2 text-xs font-medium text-emerald-700">✓ A copy of these credentials was emailed to the tenant.</div>
              )}
              {credentials.emailed === 'pending' && (
                <div className="mt-2 text-xs font-medium text-amber-700">The email is queued but not yet confirmed sent — if it does not arrive, share the password manually.</div>
              )}
              {credentials.emailed === 'failed' && (
                <div className="mt-2 text-xs font-medium text-amber-700">Email delivery failed — share the password manually, or check the email provider settings and regenerate.</div>
              )}
              {credentials.emailed === 'skipped' && (
                <div className="mt-2 text-xs text-brand-700">Closing this dialog dismisses the password for good. "Regenerate password" issues a new one at any time.</div>
              )}
            </div>
          )}
          {!credentials && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={deliverEmail} onChange={(e) => setDeliverEmail(e.target.checked)} disabled={busy} />
              Email the password to the tenant automatically
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose}>Close</Button>
            <Button variant="secondary" onClick={revoke} disabled={busy}><KeyRound size={14} className="mr-1" /> Revoke</Button>
            <Button onClick={issue} disabled={busy}>{busy ? 'Working…' : credentials ? 'Regenerate password' : 'Issue access'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Data-subject request dialog: captures WHO requested the action (the tenant
// themselves, their agent, or the operator proactively) and WHY — both are
// required and recorded in the privacy register before the action runs.
function PrivacyRequestModal({ request, onClose, onDone, onErased, onLetter }: {
  request: { tenant: Tenant; action: 'json' | 'csv' | 'erase' | 'letter' } | null;
  onClose: () => void;
  onDone: (msg: string) => void;
  onErased: (msg: string) => void;
  onLetter: (letter: LetterData) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requester, setRequester] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = requester.trim().length >= 2 && reason.trim().length >= 2;

  async function submit() {
    if (!request || !ready) return;
    setBusy(true);
    try {
      if (request.action === 'erase') {
        await api.post<{ data: unknown }>(`/api/tenants/${request.tenant.id}/erase-personal-data`, {
          requester: requester.trim(),
          reason: reason.trim(),
        });
        onErased('Personal data erased. Financial records were retained for accounting.');
      } else if (request.action === 'letter') {
        const res = await api.post<{ data: LetterData }>(`/api/tenants/${request.tenant.id}/data-request-letter`, {
          requester: requester.trim(),
          reason: reason.trim(),
        });
        // The register entry was written by the server (once). Opening the
        // letter modal happens after the request modal closes.
        onDone(`Response letter ${res.data.registerRef} generated and logged in the privacy register.`);
        onLetter(res.data);
      } else {
        const params = new URLSearchParams({ requester: requester.trim(), reason: reason.trim() });
        const res = await authenticatedFetch(
          `/api/tenants/${request.tenant.id}/data-export${request.action === 'csv' ? '.csv' : ''}?${params}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message ?? `Export failed (${res.status}).`);
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tenant-${request.tenant.id}-personal-data.${request.action}`;
        a.click();
        URL.revokeObjectURL(a.href);
        onDone(`Personal data export (${request.action.toUpperCase()}) downloaded and logged in the privacy register.`);
      }
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const label =
    request?.action === 'erase'
      ? 'Erase personal data'
      : request?.action === 'letter'
        ? 'Data-request response letter'
        : `Export personal data (${request?.action.toUpperCase()})`;
  return (
    <Modal open={request !== null} title={request ? `${label} — ${request.tenant.full_name}` : ''} onClose={onClose}>
      {request && (
        <div className="space-y-4 text-sm">
          {request.action === 'erase' && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
              This permanently erases the tenant's name, phone, email and notes, and redacts their SMS history and audit
              entries. Financial records are retained for accounting/tax. This cannot be undone.
            </p>
          )}
          <Field label="Requested by" hint="Who asked for this — the tenant, their agent, or you (proactive disclosure)?">
            <TextInput value={requester} onChange={(e) => setRequester(e.target.value)} placeholder={user?.name ?? 'Requester name'} maxLength={120} />
          </Field>
          <Field label="Reason for the request" hint="Recorded in the privacy register (DPA 2019 / GDPR accountability).">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Written DSAR received 8 Sep 2026" maxLength={500} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant={request.action === 'erase' ? 'danger' : 'primary'} onClick={submit} disabled={busy || !ready}>
              {busy ? 'Working…' : request.action === 'erase' ? 'Erase & log' : request.action === 'letter' ? 'Generate letter' : 'Export & log'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="font-medium text-gray-800">{value}</div>
    </div>
  );
}

function TenantForm({ open, tenant, onClose, onSaved }: { open: boolean; tenant: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [units, setUnits] = useState<{ id: number; unit_number: string; occupancy_status: string }[]>([]);
  const [fullName, setFullName] = useState(tenant?.full_name ?? '');
  const [phoneNumber, setPhoneNumber] = useState(tenant?.phone_number ?? '');
  const [email, setEmail] = useState(tenant?.email ?? '');
  const [moveInDate, setMoveInDate] = useState(tenant?.move_in_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [securityDeposit, setSecurityDeposit] = useState(tenant ? Number(tenant.security_deposit) : 0);
  const [notes, setNotes] = useState(tenant?.notes ?? '');
  const [unitId, setUnitId] = useState<number | ''>(tenant?.unit_number ? 0 : '');
  const [consent, setConsent] = useState(Boolean(tenant));
  const [busy, setBusy] = useState(false);

  // Load units when the modal opens.
  const { data: unitData } = useFetch(() => api.list<{ id: number; unit_number: string; occupancy_status: string }>('/api/units?limit=100'), [open]);
  if (open && units.length === 0 && unitData) {
    setUnits(unitData.data);
    if (tenant?.unit_number) {
      const match = unitData.data.find((u) => u.unit_number === tenant.unit_number);
      if (match) setUnitId(match.id);
    }
  }

  async function save() {
    if (fullName.trim().length < 2) {
      toast('error', 'Tenant name is required.');
      return;
    }
    if (!consent) {
      toast('error', "Please confirm the tenant's consent to storing their contact details.");
      return;
    }
    setBusy(true);
    try {
      const body = { fullName: fullName.trim(), phoneNumber, email: email || undefined, moveInDate, securityDeposit, notes, unitId: unitId === '' ? null : unitId };
      if (tenant) await api.put(`/api/tenants/${tenant.id}`, body);
      else await api.post('/api/tenants', body);
      onSaved();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={tenant ? `Edit ${tenant.full_name}` : 'Add Tenant'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Full Name"><TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><TextInput value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} /></Field>
          <Field label="Email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Move-In Date"><TextInput type="date" value={moveInDate} onChange={(e) => setMoveInDate(e.target.value)} /></Field>
          <Field label="Security Deposit"><TextInput type="number" min={0} value={securityDeposit} onChange={(e) => setSecurityDeposit(Number(e.target.value))} /></Field>
        </div>
        <Field label="Unit" hint={tenant ? 'Change unit to transfer (the new unit must be vacant).' : 'Assigning a unit marks it OCCUPIED.'}>
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">— No unit —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id} disabled={u.occupancy_status === 'OCCUPIED' && u.unit_number !== tenant?.unit_number}>
                Unit {u.unit_number} {u.occupancy_status === 'OCCUPIED' ? '(occupied)' : '(vacant)'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {/* Data-protection consent: tenant contact details are personal data. */}
        <label className="flex items-start gap-2.5 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>I confirm the tenant has consented to their contact details being stored in this system.</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({ tenant, onClose, onDone }: { tenant: Tenant | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [units, setUnits] = useState<{ id: number; unit_number: string; occupancy_status: string }[]>([]);
  const [targetId, setTargetId] = useState<number | ''>('');
  const { data: unitData } = useFetch(() => api.list<{ id: number; unit_number: string; occupancy_status: string }>('/api/units?limit=100'), [tenant !== null]);
  if (tenant && units.length === 0 && unitData) setUnits(unitData.data.filter((u) => u.occupancy_status === 'VACANT'));

  async function doTransfer() {
    if (!tenant || targetId === '') {
      toast('error', 'Choose a vacant unit to transfer to.');
      return;
    }
    try {
      await api.post(`/api/tenants/${tenant.id}/transfer`, { newUnitId: targetId });
      onDone();
    } catch (err) {
      toast('error', (err as Error).message);
    }
  }

  return (
    <Modal open={tenant !== null} title={`Transfer ${tenant?.full_name ?? ''}`} onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">
        The tenant's payments and ledger stay attached to the tenant; the unit changes and both units' occupancy updates automatically.
      </p>
      <Field label="New Unit (vacant units)">
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value === '' ? '' : Number(e.target.value))}>
          <option value="">— Select vacant unit —</option>
          {units.map((u) => <option key={u.id} value={u.id}>Unit {u.unit_number}</option>)}
        </Select>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={doTransfer}>Transfer</Button>
      </div>
    </Modal>
  );
}