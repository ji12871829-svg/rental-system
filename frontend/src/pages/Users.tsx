import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, EmptyState, Field, Modal, PageHeader, Select, SkeletonTable, StatusBadge, TextInput, useFetch, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

interface UserRow {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'PROPERTY_MANAGER' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
}

const ROLES: { value: UserRow['role']; label: string; description: string }[] = [
  { value: 'ADMIN', label: 'Admin', description: 'Full access incl. users, settings, audit logs, deletes.' },
  { value: 'PROPERTY_MANAGER', label: 'Property Manager', description: 'Day-to-day management: tenants, units, payments, expenses.' },
  { value: 'STAFF', label: 'Staff', description: 'Data entry: record payments, readings, expenses.' },
];

export default function Users() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [edit, setEdit] = useState<UserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useFetch(() => api.get<{ data: UserRow[] }>('/api/users').then((r) => r.data), [refreshKey]);
  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Admins, property managers and staff accounts — roles decide what each person can do"
        actions={<Button onClick={() => { setEdit(null); setShowForm(true); }}><Plus size={16} strokeWidth={2} aria-hidden /> Add User</Button>}
      />

      {loading && <SkeletonTable cols={7} />}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="font-semibold text-gray-900">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">YOU</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.phone ?? '—'}</td>
                  <td>
                    <Select
                      value={u.role}
                      className="!w-44 !py-1 text-xs"
                      disabled={u.id === me?.id}
                      onChange={async (e) => {
                        try {
                          await api.put(`/api/users/${u.id}`, { role: e.target.value });
                          toast('success', `${u.name} is now ${ROLES.find((r) => r.value === e.target.value)?.label}.`);
                          refresh();
                        } catch (err) { toast('error', (err as Error).message); }
                      }}
                    >
                      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </Select>
                    <div className="mt-1 text-[10px] text-gray-400">{ROLES.find((r) => r.value === u.role)?.description}</div>
                  </td>
                  <td><StatusBadge status={u.status} /></td>
                  <td className="text-xs text-gray-500">{formatDate(u.created_at)}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => { setEdit(u); setShowForm(true); }}>Edit</Button>
                      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setResetTarget(u)}>Reset Password</Button>
                      {u.id !== me?.id && (
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 text-xs"
                          onClick={async () => {
                            const nextStatus = u.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                            try {
                              await api.put(`/api/users/${u.id}`, { status: nextStatus });
                              toast('success', `${u.name} is now ${nextStatus.toLowerCase()}.`);
                              refresh();
                            } catch (err) { toast('error', (err as Error).message); }
                          }}
                        >
                          {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                      {u.id !== me?.id && (
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={async () => {
                          if (!window.confirm(`Permanently delete ${u.name} (${u.email})? This cannot be undone.`)) return;
                          try { await api.del(`/api/users/${u.id}`); toast('success', 'User deleted.'); refresh(); }
                          catch (err) { toast('error', (err as Error).message); }
                        }}>Delete</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <div className="p-6"><EmptyState message="No users found." /></div>}
        </div>
      )}

      <UserForm open={showForm} user={edit} onClose={() => setShowForm(false)} onSaved={(msg) => { setShowForm(false); refresh(); toast('success', msg); }} />

      <ResetPasswordModal
        user={resetTarget}
        onClose={() => setResetTarget(null)}
        onSaved={(msg) => { setResetTarget(null); toast('success', msg); }}
      />
    </div>
  );
}

function UserForm({ open, user, onClose, onSaved }: { open: boolean; user: UserRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRow['role']>(user?.role ?? 'STAFF');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name.trim().length < 2) { toast('error', 'Name is required.'); return; }
    if (!user && password.length < 8) { toast('error', 'Password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      if (user) {
        await api.put(`/api/users/${user.id}`, {
          name: name.trim(), phone: phone || undefined, role,
          ...(password ? { password } : {}),
        });
        onSaved(`${name.trim()} updated.`);
      } else {
        await api.post('/api/users', { name: name.trim(), email: email.trim(), phone: phone || undefined, password, role });
        onSaved(`${name.trim()} added as ${ROLES.find((r) => r.value === role)?.label}.`);
      }
      setPassword('');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={user ? `Edit ${user.name}` : 'Add User'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Phone"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        </div>
        {!user && (
          <Field label="Email"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        )}
        <Field label="Role" hint={ROLES.find((r) => r.value === role)?.description}>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRow['role'])}>
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label={user ? 'New Password (leave blank to keep current)' : 'Password'} hint="At least 8 characters.">
          <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} loading={busy}>{busy ? 'Saving…' : 'Save User'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (!user || password.length < 8) { toast('error', 'New password must be at least 8 characters.'); return; }
    setBusy(true);
    try {
      await api.put(`/api/users/${user.id}`, { password });
      onSaved(`Password reset for ${user.name}.`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={user !== null} title={`Reset Password — ${user?.name ?? ''}`} onClose={onClose}>
      <p className="mb-3 text-sm text-gray-600">
        The user will sign in with this new password on their next login. Share it with them securely.
      </p>
      <Field label="New Password" hint="At least 8 characters.">
        <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={reset} disabled={busy} loading={busy}>{busy ? 'Resetting…' : 'Reset Password'}</Button>
      </div>
    </Modal>
  );
}
