// Landing page sections — How-it-works, Pricing, Demo request + contact
// cards, FAQ.
//
// Extracted from Landing.tsx so the public marketing page stays navigable:
// each section is a self-contained component fed by the business branding.
//
//   HowItWorks     — four numbered steps from sign-up to a running system
//   Pricing        — live room prices from GET /api/public/units (the
//                    operator's real roster: types, rent ranges, availability)
//   DemoRequest    — POST /api/public/demo-requests with the app-wide Button
//                    loading/success feedback, plus WhatsApp/email contact
//                    cards fed from the business identity
//   FaqSection     — accessible accordion (aria-expanded, keyboard operable)
//
// Dark mode comes free from the app-wide global overrides, same as Login.
import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Check, ChevronDown, Loader2, Mail, MessageCircle, Phone } from 'lucide-react';
import { api } from '../lib/api';
import { useBranding } from '../lib/BrandingContext';
import { Button, TextInput } from '../components/ui';

// Apple-style restrained reveal: sections below the fold rise-and-fade in
// once, via IntersectionObserver (no scroll handlers, no replay). Elements
// mount visible unless JS opts them in, so content is never lost if this
// never runs; prefers-reduced-motion skips the hook entirely.
export function useLandingReveal(): void {
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).classList.add('landing-reveal-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.06 },
    );
    for (const el of els) {
      // Above-the-fold elements stay untouched — the page must not fade in
      // under the visitor's eyes before they've done anything.
      if (el.getBoundingClientRect().top > window.innerHeight * 0.92) {
        el.classList.add('landing-reveal');
        io.observe(el);
      }
    }
    return () => io.disconnect();
  }, []);
}

// ----------------------------------------------------------- HowItWorks ---
const STEPS = [
  {
    n: '01',
    title: 'Add your property',
    body: 'Create the property, floors and units with their rents in minutes — import your existing records or start fresh.',
  },
  {
    n: '02',
    title: 'Bring tenants on',
    body: 'Add each tenancy with the tenant\u2019s email and phone. Tenants then claim portal access with that email and set their own password.',
  },
  {
    n: '03',
    title: 'Collect via M-Pesa',
    body: 'Tenants pay by STK push or PayBill. Payments reconcile against the ledger automatically, with a numbered receipt every time.',
  },
  {
    n: '04',
    title: 'Watch the dashboard',
    body: 'Arrears, collections, water bills and expenses update live — from your desk or your phone, with no exercise books.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-t border-gray-100">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Get started in under an hour</h2>
          <p className="mt-3 text-base text-gray-500">
            No training needed. Your first rent payment can land the same day you sign in.
          </p>
        </div>
        <ol data-reveal className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <span className="text-3xl font-bold text-brand-100" aria-hidden>
                {s.n}
              </span>
              <h3 className="mt-2 text-base font-semibold text-gray-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Pricing ---
interface UnitPriceRow {
  unitType: string;
  minRent: number;
  maxRent: number;
  total: number;
  vacant: number;
}

export function Pricing({ currency = 'KSh' }: { currency?: string }) {
  const [rows, setRows] = useState<UnitPriceRow[] | null>(null); // null = loading
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ data: UnitPriceRow[] }>('/api/public/units')
      .then((res) => { if (alive) setRows(res.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return (
    <section id="pricing" className="scroll-mt-20 border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Room prices</h2>
          <p className="mt-3 text-base text-gray-500">
            Transparent, straight from our rent ledger — what you see is what our tenants pay, per month.
          </p>
        </div>

        {failed ? (
          <p className="mt-10 text-center text-sm text-gray-400">
            Prices are unavailable right now — please check back soon.
          </p>
        ) : rows === null ? (
          <div className="mt-10 flex justify-center" role="status" aria-label="Loading prices">
            <Loader2 className="animate-spin text-brand-500" size={28} aria-hidden />
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-10 text-center text-sm text-gray-400">
            Our unit list is being prepared — contact us for current rates.
          </p>
        ) : (
          <div data-reveal className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <article
                key={r.unitType}
                className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                {r.vacant > 0 && (
                  <span className="absolute -top-2.5 right-4 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Available
                  </span>
                )}
                <h3 className="text-lg font-semibold text-gray-900">{r.unitType}</h3>
                <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-gray-900">
                  {currency}
                  {r.minRent.toLocaleString()}
                  {r.maxRent > r.minRent && (
                    <span className="text-base font-medium text-gray-400"> – {currency}{r.maxRent.toLocaleString()}</span>
                  )}
                  <span className="ml-1 text-sm font-normal text-gray-500">/month</span>
                </p>
                <p className="mt-1 flex-1 text-sm text-gray-500">
                  {r.total} unit{r.total === 1 ? '' : 's'} · {r.vacant} available now
                </p>
                <a
                  href="#demo"
                  className="mt-4 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 active:scale-[0.98] active:bg-brand-100"
                >
                  <CalendarClock size={15} aria-hidden /> Request a viewing
                </a>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ DemoRequest ---
const UNITS_OPTIONS = [
  { value: '', label: 'Select…' },
  { value: '1-5', label: '1–5 units' },
  { value: '6-20', label: '6–20 units' },
  { value: '21-50', label: '21–50 units' },
  { value: '50+', label: 'More than 50 units' },
];

export function DemoRequest({ contactEmail }: { contactEmail?: string | null }) {
  const { identity } = useBranding();
  const [form, setForm] = useState({ name: '', email: '', phone: '', propertyName: '', unitsCount: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function setField(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Please tell us your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setFailed(null);
    api
      .post<{ data: { message: string } }>('/api/public/demo-requests', {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        propertyName: form.propertyName.trim() || undefined,
        unitsCount: form.unitsCount || undefined,
        message: form.message.trim() || undefined,
      })
      .then(() => {
        setBusy(false);
        setDone(true);
      })
      .catch((err: Error) => {
        setBusy(false);
        setFailed(err.message || 'Something went wrong. Please try again.');
      });
  }

  const email = identity?.contactEmail ?? contactEmail ?? null;
  const phone = identity?.contactPhone ?? null;
  // Kenya formats WhatsApp and voice identically (+254…); wa.me takes the
  // digits with no plus. Absent/odd numbers just hide the card.
  const waDigits = phone ? phone.replace(/[^0-9]/g, '').replace(/^0/, '254') : '';
  const showWhatsApp = waDigits.length >= 9;

  if (done) {
    return (
      <section id="demo" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="mx-auto max-w-xl rounded-2xl border border-brand-100 bg-brand-50 p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30">
              <Check size={28} aria-hidden />
            </div>
            <h2 className="mt-5 text-2xl font-semibold text-gray-900">Request received</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Thank you — we have your details and will reach out shortly to schedule your demo.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="demo" className="scroll-mt-20 border-t border-gray-100">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Get in touch</h2>
          <p className="mt-3 text-base text-gray-500">
            Questions? Want a walkthrough on your own numbers? Reach out — we usually reply the same day.
          </p>
        </div>

        <div data-reveal className="mt-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Reach-us cards — real contacts from the business identity */}
          <div className="flex flex-col gap-4">
            <div className="flex-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-base font-semibold text-gray-900">Reach us directly</h3>
              <div className="mt-4 space-y-4">
                {showWhatsApp && (
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 rounded-xl border border-gray-100 p-3 transition-colors hover:bg-gray-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <MessageCircle size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">WhatsApp</span>
                      <span className="block truncate text-sm text-gray-600">{phone}</span>
                      <span className="block text-xs text-gray-400">Fastest way to reach us</span>
                    </span>
                  </a>
                )}
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-start gap-3 rounded-xl border border-gray-100 p-3 transition-colors hover:bg-gray-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <Mail size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">Email</span>
                      <span className="block truncate text-sm text-gray-600">{email}</span>
                      <span className="block text-xs text-gray-400">For detailed inquiries</span>
                    </span>
                  </a>
                )}
                {phone && (
                  <div className="flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                      <Phone size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">Phone</span>
                      <span className="block truncate text-sm text-gray-600">{phone}</span>
                    </span>
                  </div>
                )}
              </div>
              {identity?.address && <p className="mt-4 text-xs text-gray-400">{identity.address}</p>}
            </div>
          </div>

          {/* Demo / contact form */}
          <form onSubmit={submit} noValidate className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
            <h3 className="text-base font-semibold text-gray-900">Request a demo</h3>
            <p className="mt-1 text-sm text-gray-500">
              Book a free walkthrough of the dashboard, tenant portal and M-Pesa flow — no commitment.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Your name *</span>
                <TextInput value={form.name} onChange={setField('name')} aria-invalid={!!errors.name} autoComplete="name" />
                {errors.name && <span role="alert" className="mt-1 block text-xs font-medium text-red-700">{errors.name}</span>}
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Email *</span>
                <TextInput type="email" value={form.email} onChange={setField('email')} aria-invalid={!!errors.email} autoComplete="email" />
                {errors.email && <span role="alert" className="mt-1 block text-xs font-medium text-red-700">{errors.email}</span>}
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Phone</span>
                <TextInput type="tel" value={form.phone} onChange={setField('phone')} autoComplete="tel" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Property name</span>
                <TextInput value={form.propertyName} onChange={setField('propertyName')} />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">Number of units</span>
                <select
                  value={form.unitsCount}
                  onChange={setField('unitsCount')}
                  className="flex min-h-[40px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                >
                  {UNITS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">Anything specific you want to see?</span>
                <textarea
                  value={form.message}
                  onChange={setField('message')}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                  placeholder="e.g. we bill water per meter and collect rent via M-Pesa…"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col items-center gap-3">
              <Button type="submit" loading={busy} className="min-h-[44px] w-full sm:w-auto sm:px-8">
                {busy ? 'Sending…' : 'Send message'}
              </Button>
              {failed && <p role="alert" className="text-sm font-medium text-red-700">{failed}</p>}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------- FAQ ---
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do tenants get their accounts?',
    a: 'Your property manager adds each tenancy with the tenant\u2019s email first. The tenant then opens the "Create account" page, claims portal access with that email and sets their own password — instantly, no waiting on the office.',
  },
  {
    q: 'How does M-Pesa rent collection work?',
    a: 'Tenants pay by STK push (a prompt sent straight to their phone) or PayBill. Payments reconcile against the rent ledger automatically, a numbered receipt is issued, and the tenant gets it by email, SMS and in the portal. Bank or cash payments are recorded just as easily.',
  },
  {
    q: 'How is water billed?',
    a: 'Each unit can have its own meter. Staff record readings any time, the system computes consumption per unit, applies your tariff, and the charge lands on the tenant\u2019s bill and portal automatically.',
  },
  {
    q: 'Do tenants see other tenants\u2019 data?',
    a: 'No. The tenant portal is strictly self-service: each tenant sees only their own unit, balance, payments, water readings and statements. Staff data, expenses and reports never appear in the portal.',
  },
  {
    q: 'Who can access the management side?',
    a: 'Only administrator-approved staff. New landlord or agent accounts are requested publicly but created inactive — an administrator reviews and activates them in Users before they can sign in. Every action is written to an audit log.',
  },
  {
    q: 'Can I use my own logo and business name?',
    a: 'Yes. Upload a logo and set your business identity in Settings — it flows through the app header, the tenant portal, email receipts, PDF statements and even this landing page.',
  },
  {
    q: 'What reports can I get?',
    a: 'Monthly income statements, collection performance, arrears ageing, water-consumption and expense reports — viewable on screen, and exportable or emailable to the business contact on schedule.',
  },
  {
    q: 'What does the demo cover?',
    a: 'A walkthrough of the management dashboard (arrears, collections, expenses), the tenant portal from a tenant\u2019s point of view, and the M-Pesa payment and receipt flow — using your own property\u2019s numbers if you like.',
  },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="scroll-mt-20 border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-3xl px-5 py-16 lg:py-20">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Frequently asked questions</h2>
          <p className="mt-3 text-base text-gray-500">
            Everything you need to know about how the system works. Anything else — <a href="#demo" className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800">ask us</a>.
          </p>
        </div>

        <div data-reveal className="mt-8 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white shadow-sm">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  className="flex w-full select-none items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
                >
                  <span className="text-sm font-semibold text-gray-900 sm:text-base">{item.q}</span>
                  <ChevronDown
                    size={18}
                    aria-hidden
                    className={`shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {/* Fluid open/close: the grid-rows 0fr→1fr trick animates the
                    height continuously (no fixed max-height guesswork), so the
                    answer grows under the finger instead of popping. Content
                    stays in the DOM — find-in-page and screen readers keep it. */}
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-sm leading-relaxed text-gray-600">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// Footer helper: one-line anchor strip so every landing section is one click
// from anywhere on the page.
export function SectionLinks({ className = '' }: { className?: string }) {
  const links = [
    { href: '#how-it-works', label: 'How it works' },
    { href: '#features', label: 'Features' },
    { href: '#mpesa', label: 'M-Pesa' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#demo', label: 'Request a demo' },
    { href: '#faq', label: 'FAQs' },
    { href: '#create-account', label: 'Create account' },
  ];
  return (
    <nav aria-label="Page sections" className={className}>
      {links.map((l) => (
        <a key={l.href} href={l.href} className="whitespace-nowrap text-sm text-slate-300 transition-colors hover:text-white">
          {l.label}
        </a>
      ))}
    </nav>
  );
}
