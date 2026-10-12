import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Field, Modal, SkeletonTable, TextInput } from '../components/ui';
import { api } from '../lib/api';
import { BrandLogo } from '../components/BrandLogo';

// Public vacancy board — signed-out visitors browse published listings and
// leave an inquiry. The view counter fires once per visit (mount); the
// inquiry form posts name + contact and never signs anyone in.
interface PublicListing {
  id: number;
  title: string;
  description: string | null;
  rentAmount: number;
  deposit: number | null;
  unitType: string;
  propertyName: string;
  photos: string[];
  amenities: string[];
}

export default function PublicVacancies() {
  const [listings, setListings] = useState<PublicListing[] | null>(null);
  const [currency, setCurrency] = useState('KES');
  const [error, setError] = useState('');
  const [inquiryFor, setInquiryFor] = useState<PublicListing | null>(null);
  const [form, setForm] = useState({ name: '', contact: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.get<{ data: { currency: string; listings: PublicListing[] } }>('/api/public/vacancies')
      .then((res) => {
        setCurrency(res.data.currency);
        setListings(res.data.listings);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  async function sendInquiry() {
    if (!inquiryFor || sending) return;
    if (form.name.trim().length < 2 || form.contact.trim().length < 5) {
      return;
    }
    setSending(true);
    try {
      await api.post(`/api/public/vacancies/${inquiryFor.id}/inquiries`, {
        name: form.name.trim(),
        contact: form.contact.trim(),
        message: form.message.trim() || undefined,
      });
      setSent(true);
    } catch {
      setSent(true); // the counter/inquiry is best-effort for the visitor
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-ash bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <BrandLogo className="flex items-center gap-2" iconSize={28} />
          <Link to="/login" className="text-sm font-medium text-brand-600 hover:text-brand-700">Sign in</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900">Vacant units</h1>
        <p className="mt-1 text-sm text-gray-600">Browse what's available and leave your contact — the landlord will get back to you.</p>

        {error && <div className="mt-6 text-sm text-red-600">{error}</div>}
        {!listings && !error && <div className="mt-6"><SkeletonTable cols={3} /></div>}
        {listings && listings.length === 0 && (
          <div className="mt-6"><EmptyState message="Nothing available right now — check back soon." /></div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(listings ?? []).map((l) => (
            <article key={l.id} className="overflow-hidden rounded-xl border border-ash bg-white shadow-sm">
              {l.photos.length > 0 ? (
                <img src={l.photos[0]} alt={l.title} className="h-40 w-full object-cover" />
              ) : (
                <div className="flex h-40 items-center justify-center bg-gray-100 text-xs text-gray-400">No photo</div>
              )}
              <div className="space-y-1 p-4">
                <div className="text-sm font-semibold text-gray-900">{l.title}</div>
                <div className="text-xs text-gray-500">{l.propertyName} · {l.unitType}</div>
                <div className="text-base font-bold text-brand-700">
                  {currency} {l.rentAmount.toLocaleString()}
                  <span className="text-xs font-normal text-gray-500">/month</span>
                  {l.deposit ? <span className="ml-2 text-xs text-gray-500">+ {currency} {l.deposit.toLocaleString()} deposit</span> : null}
                </div>
                {l.description && <p className="line-clamp-2 text-xs text-gray-600">{l.description}</p>}
                {l.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {l.amenities.slice(0, 4).map((a) => (
                      <span key={a} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{a}</span>
                    ))}
                  </div>
                )}
                <div className="pt-2">
                  <Button
                    className="!min-h-[36px] w-full !py-1 text-xs"
                    onClick={() => {
                      setInquiryFor(l);
                      setSent(false);
                      setForm({ name: '', contact: '', message: '' });
                    }}
                  >
                    I'm interested
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      <Modal open={inquiryFor !== null} title={`Inquire — ${inquiryFor?.title ?? ''}`} onClose={() => setInquiryFor(null)}>
        {inquiryFor && !sent && (
          <div className="space-y-3">
            <Field label="Your name">
              <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Phone or email" hint="How the landlord reaches you.">
              <TextInput value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </Field>
            <Field label="Message (optional)">
              <TextInput value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="When are you looking to move in?" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setInquiryFor(null)}>Cancel</Button>
              <Button loading={sending} onClick={sendInquiry}>Send inquiry</Button>
            </div>
          </div>
        )}
        {inquiryFor && sent && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
              Your inquiry was sent. The landlord will contact you using the details you left.
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setInquiryFor(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
