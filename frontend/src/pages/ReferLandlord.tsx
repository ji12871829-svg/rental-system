// Refer a landlord — honest caretaker/agent referral intake. No commissions are
// promised (the product says only what is true): the referral lands in the
// existing demo_requests inbox with a REFERRAL prefix for the operator to
// follow up. Frontend-only: reuses POST /api/public/demo-requests.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button, Field, PageHeader, Select, TextInput } from '../components/ui';
import { api } from '../lib/api';

const ROLES = ['Caretaker', 'Fundi / Handyman', 'Agent / Advocate', 'Service provider', 'Neighbour / Friend', 'Other'];

export default function ReferLandlord() {
  const [form, setForm] = useState({ yourName: '', yourPhone: '', role: 'Caretaker', landlordName: '', landlordContact: '', property: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.yourName.trim().length < 2 || form.landlordName.trim().length < 2) {
      setFailed('Tell us your name and the landlord’s name.');
      return;
    }
    if (form.yourPhone.trim().length < 5 || form.landlordContact.trim().length < 3) {
      setFailed('Add contact details so we can follow up.');
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await api.post('/api/public/demo-requests', {
        name: form.yourName.trim(),
        email: `referral+${Date.now()}@no-email.invalid`,
        phone: form.yourPhone.trim(),
        propertyName: form.property.trim() || undefined,
        message: `[REFERRAL — ${form.role}] Landlord: ${form.landlordName.trim()} (${form.landlordContact.trim()}). ${form.message.trim()}`,
      });
      setDone(true);
    } catch (err) {
      setFailed((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="mx-auto max-w-xl px-4 py-16">
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white">
              <Check size={28} aria-hidden />
            </div>
            <h1 className="mt-5 text-lg font-bold text-gray-900">Thank you — referral received</h1>
            <p className="mt-2 text-sm text-gray-600">We will reach out to {form.landlordName.trim()} shortly. Asante for spreading the word.</p>
            <Link to="/landing" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">Back to home</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link to="/landing" className="text-sm font-bold text-gray-900">Olbano Plaza</Link>
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-8">
        <PageHeader title="Know a landlord? Refer them" subtitle="Caretakers, fundis, agents — send them our way and we handle the rest" />
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Your name">
              <TextInput value={form.yourName} onChange={set('yourName')} placeholder="Your name" />
            </Field>
            <Field label="Your phone">
              <TextInput value={form.yourPhone} onChange={set('yourPhone')} placeholder="+254…" />
            </Field>
          </div>
          <Field label="You are a…">
            <Select value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Landlord name">
              <TextInput value={form.landlordName} onChange={set('landlordName')} placeholder="Landlord name" />
            </Field>
            <Field label="Landlord phone / estate">
              <TextInput value={form.landlordContact} onChange={set('landlordContact')} placeholder="+254… or estate name" />
            </Field>
          </div>
          <Field label="Property (optional)">
            <TextInput value={form.property} onChange={set('property')} placeholder="e.g. 20 units in Ruaka" />
          </Field>
          <Field label="Anything we should know? (optional)">
            <TextInput value={form.message} onChange={set('message')} placeholder="e.g. struggles with water billing" />
          </Field>
          {failed && <div className="text-sm text-red-600">{failed}</div>}
          <Button loading={busy}>Send referral</Button>
        </form>
      </main>
    </div>
  );
}
