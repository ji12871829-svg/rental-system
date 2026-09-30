// Landing page sections — workflow, Pricing, Demo request + contact cards,
// FAQ.
//
// Extracted from Landing.tsx so the public marketing page stays navigable:
// each section is a self-contained component fed by the business branding.
//
//   HowItWorks     — four numbered steps from sign-up to a running system
//   TrustMarquee   — capability chips on the Amie marquee
//   Pricing        — live room prices from GET /api/public/units (the
//                    operator's real roster: types, rent ranges, availability)
//   DemoRequest    — POST /api/public/demo-requests with the app-wide Button
//                    loading/success feedback, plus WhatsApp/email contact
//                    cards fed from the business identity
//   FaqSection     — accessible accordion (aria-expanded, keyboard operable)
//
// Dark mode comes free from the app-wide global overrides, same as Login.
import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import {
  CalendarClock, Check, ChevronDown, Droplets, Loader2, Mail, MessageCircle, Phone,
  ReceiptText, ShieldCheck, Smartphone, UserRound, Wallet,
} from 'lucide-react';
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

// ------------------------------------------------------- usePublicUnits ---
// One fetch, two consumers: the hero's live badge/stat row and the Available
// Units listings both render the operator's real roster from the public
// endpoint (types, rent ranges, vacancy). null = still loading; failed=true
// lets callers degrade to honest static copy.
interface UnitPriceRow {
  unitType: string;
  minRent: number;
  maxRent: number;
  total: number;
  vacant: number;
}

export function usePublicUnits(): { rows: UnitPriceRow[] | null; failed: boolean; currency: string } {
  const [rows, setRows] = useState<UnitPriceRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<{ currency: string; data: UnitPriceRow[] }>('/api/public/units')
      .then((res) => { if (alive) { setRows(res.data); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return { rows, failed, currency: 'KSh' };
}

// ---------------------------------------------------------- TrustMarquee ---
// Amie social-proof strip (design/amie-DESIGN.md): chips sit directly on the
// white page — no card container — and drift on a 70s linear marquee that
// pauses on hover and parks for reduced-motion users. Every chip renders
// desaturated via the .gray-reveal filter and blooms to its category color
// on hover, per the design's imagery rule. Content is the product's REAL
// capabilities — no invented customer logos.
const TRUST_ITEMS: { icon: typeof Wallet; label: string; accent: string }[] = [
  { icon: Smartphone, label: 'M-Pesa STK push & PayBill', accent: 'border-brand-300 text-brand-600' },
  { icon: Droplets, label: 'Per-unit water meters', accent: 'border-mint/40 text-mint' },
  { icon: UserRound, label: 'Tenant self-service portal', accent: 'border-violet/40 text-violet' },
  { icon: ReceiptText, label: 'Numbered receipts, every payment', accent: 'border-amber-300 text-amber-600' },
  { icon: Wallet, label: 'Live arrears ledger', accent: 'border-emerald-300 text-emerald-600' },
  { icon: ShieldCheck, label: 'Audit trail & access control', accent: 'border-ash text-charcoal' },
];

export function TrustMarquee() {
  return (
    <section aria-label="What the system handles" className="py-10">
      {/* Caption: Inter 12px graphite, left-aligned — the .md's strip label. */}
      <div className="mx-auto max-w-6xl px-5">
        <p className="text-xs font-medium uppercase tracking-wide text-graphite">Everything the ledger touches</p>
      </div>
      {/* Full-bleed drift with soft edge fade; the track carries two copies
          of the list so the -50% translate loops seamlessly (second copy is
          aria-hidden — screen readers read the list once). */}
      <div className="mt-4 overflow-hidden [-webkit-mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
        <div className="marquee-track flex w-max items-center gap-3 pr-3">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1} className="flex items-center gap-3">
              {TRUST_ITEMS.map(({ icon: Icon, label, accent }) => (
                <li
                  key={label}
                  tabIndex={copy === 0 ? 0 : undefined}
                  className={`gray-reveal flex items-center gap-2 whitespace-nowrap rounded-full border bg-white px-4 py-1.5 text-sm font-medium ${accent}`}
                >
                  <Icon size={15} strokeWidth={1.75} aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------- HowItWorks ---
const STEPS = [
  {
    n: '01',
    title: 'Set up the building',
    body: 'Create the property, floors and units with their rents. Import existing records or start fresh — most buildings are in before lunch.',
  },
  {
    n: '02',
    title: 'Invite your tenants',
    body: 'Add each tenancy with the tenant\u2019s email and phone. Tenants then claim portal access with that email and set their own password.',
  },
  {
    n: '03',
    title: 'Turn on M-Pesa',
    body: 'Tenants pay by STK push or PayBill. Payments reconcile against the ledger automatically, with a numbered receipt every time.',
  },
  {
    n: '04',
    title: 'Let the ledger run',
    body: 'Arrears, collections, water bills and expenses update live — from your desk or your phone, with no exercise books.',
  },
];

export function HowItWorks() {
  return (
    <section id="workflow" className="scroll-mt-20 border-t border-gray-100">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        {/* Sticky-left editorial: the intro pins while the numbered steps
            scroll past — the design's long-read treatment for sequences. */}
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="type-heading text-gray-900">Live in four steps</h2>
            <p className="mt-3 text-base text-graphite">
              No training needed. Your first rent payment can land the same day you
              sign in — bring the building on, invite the tenants, switch on M-Pesa
              and let the ledger take it from there.
            </p>
            <a
              href="#demo"
              className="press mt-6 inline-flex min-h-[44px] items-center rounded-xl border border-ash bg-white px-5 py-2.5 text-sm font-semibold text-graphite transition-[background-color,color] hover:bg-fog"
            >
              Book a walkthrough
            </a>
          </div>
          <ol data-reveal className="grid gap-4">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-5 rounded-xl bg-white p-6 shadow-md">
                <span className="text-3xl font-bold tracking-tight text-brand-400" aria-hidden>
                  {s.n}
                </span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-graphite">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Pricing ---
// The Available Units showcase — the page's conversion heart. Listing-style
// cards: photo, unit type, bold KSh price, live availability line, amenity
// chips, and a paired action row (book a viewing + WhatsApp), rendered from
// the operator's real rent ledger.

// One real photo per listing. The building shots carry the bedroom types
// (they ARE the building); interior/unit photos carry the smaller types.
const LISTING_PHOTOS: Record<string, { src: string; alt: string }> = {
  'Room': { src: '/photos/keys-move-in.jpg', alt: 'A tenant receiving keys at move-in' },
  'Bedsitter': { src: '/photos/unit-viewing.jpg', alt: 'A bright, empty studio unit during a viewing' },
  '1 Bedroom': { src: '/building/building-1-800.webp', alt: 'The building facade where the one-bedroom units are' },
  '2 Bedroom': { src: '/building/building-1-1600.webp', alt: 'The building facade where the two-bedroom units are' },
};

export function Pricing({ currency = 'KSh' }: { currency?: string }) {
  const { rows, failed } = usePublicUnits();
  const { identity } = useBranding();
  const waDigits = identity?.contactPhone
    ? identity.contactPhone.replace(/[^0-9]/g, '').replace(/^0/, '254')
    : '';
  const waHref = waDigits.length >= 9 ? `https://wa.me/${waDigits}` : null;

  const totalUnits = rows?.reduce((n, r) => n + r.total, 0) ?? 0;
  const totalVacant = rows?.reduce((n, r) => n + r.vacant, 0) ?? 0;

  return (
    <section id="pricing" className="scroll-mt-20 border-t border-gray-100 bg-gray-50">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="type-heading text-gray-900">Available units</h2>
            <p className="mt-3 text-base text-graphite">
              Real rates from our rent ledger — what tenants pay, per month, with
              live availability. Book a viewing or message us on WhatsApp.
            </p>
          </div>
          {rows && rows.length > 0 && (
            <p className="text-sm font-medium text-gray-900" aria-live="polite">
              {totalVacant} of {totalUnits} vacant now
            </p>
          )}
        </div>

        {failed ? (
          <p className="mt-10 text-center text-sm text-gray-500">
            Prices are unavailable right now — please check back soon, or reach us below.
          </p>
        ) : rows === null ? (
          <div className="mt-10 flex justify-center" role="status" aria-label="Loading prices">
            <Loader2 className="animate-spin text-brand-500" size={28} aria-hidden />
          </div>
        ) : rows.length === 0 ? (
          <p className="mt-10 text-center text-sm text-gray-500">
            Our unit list is being prepared — contact us for current rates.
          </p>
        ) : (
          <div data-reveal className="mt-10 grid gap-6 md:grid-cols-2">
            {rows.map((r) => {
              const photo = LISTING_PHOTOS[r.unitType];
              return (
                <article
                  key={r.unitType}
                  className="flex flex-col overflow-hidden rounded-2xl border border-ash bg-white shadow-sm transition-shadow duration-200 hover:shadow-md"
                >
                  {/* Photo header with the live availability badge — the
                      reference's photo-led listing treatment. */}
                  <div className="relative h-44 w-full overflow-hidden bg-fog">
                    {photo ? (
                      <img
                        src={photo.src}
                        alt={photo.alt}
                        className="gray-reveal h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center" aria-hidden>
                        <UserRound size={40} className="text-gray-300" />
                      </div>
                    )}
                    {r.vacant > 0 && (
                      <span className="absolute right-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700 shadow-sm">
                        {r.vacant} available
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-6">
                    {/* flex-wrap: at 320px the price wraps below the name
                        instead of clipping (nowrap overflowed the card). */}
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-lg font-semibold text-gray-900">{r.unitType}</h3>
                      <p className="text-xl font-bold tracking-tight tabular-nums text-gray-900">
                        {currency} {r.minRent.toLocaleString()}
                        {r.maxRent > r.minRent && (
                          <span className="text-sm font-semibold text-gray-500"> – {currency}{r.maxRent.toLocaleString()}</span>
                        )}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">{r.total} unit{r.total === 1 ? '' : 's'} · rent per month · M-Pesa accepted</p>

                    {/* Amenity chips — only claims the system itself backs. */}
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {['Metered water', 'Numbered receipts', 'Self-service portal'].map((chip) => (
                        <li key={chip} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-graphite">
                          {chip}
                        </li>
                      ))}
                    </ul>

                    {/* Paired actions: outline booking + WhatsApp, the
                        reference's conversion pair. WhatsApp omits itself
                        when the business identity has no usable number. */}
                    <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                      <a
                        href="#demo"
                        className="press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-ash bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 transition-[background-color,color,transform] hover:bg-fog"
                      >
                        <CalendarClock size={15} aria-hidden /> Book viewing
                      </a>
                      {waHref && (
                        <a
                          href={waHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="press inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,color,transform] hover:bg-emerald-700"
                        >
                          <MessageCircle size={15} aria-hidden /> WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
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
          <div className="mx-auto max-w-xl rounded-xl border border-ash bg-white p-8 text-center shadow-lg">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-500 text-white">
              <Check size={28} aria-hidden />
            </div>
            <h2 className="type-heading-sm mt-5 text-gray-900">Request received</h2>
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
          <h2 className="type-heading text-gray-900">See it on your own numbers</h2>
          <p className="mt-3 text-base text-graphite">
            A walkthrough on your real rents, meters and tenants — reach out and we usually reply the same day.
          </p>
        </div>

        <div data-reveal className="mt-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Reach-us cards — real contacts from the business identity, with a
              photo of what a walkthrough actually looks like. */}
          <div className="flex flex-col gap-4">
            <figure className="relative overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5">
              <img
                src="/photos/unit-viewing.jpg"
                alt="An agent showing a couple around a bright, empty unit"
                className="gray-reveal h-40 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <div className="flex-1 rounded-xl border border-ash bg-white p-6 shadow-sm">
              <h3 className="type-heading-sm text-gray-900">Reach us directly</h3>
              <div className="mt-4 space-y-4">
                {showWhatsApp && (
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 rounded-xl border border-gray-100 p-3 transition-colors hover:bg-fog"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <MessageCircle size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">WhatsApp</span>
                      <span className="block truncate text-sm text-gray-600">{phone}</span>
                      <span className="block text-xs text-silver">Fastest way to reach us</span>
                    </span>
                  </a>
                )}
                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="flex items-start gap-3 rounded-xl border border-gray-100 p-3 transition-colors hover:bg-fog"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-fog text-gray-700">
                      <Mail size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">Email</span>
                      <span className="block truncate text-sm text-gray-600">{email}</span>
                      <span className="block text-xs text-silver">For detailed inquiries</span>
                    </span>
                  </a>
                )}
                {phone && (
                  <div className="flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-fog text-gray-700">
                      <Phone size={18} aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">Phone</span>
                      <span className="block truncate text-sm text-gray-600">{phone}</span>
                    </span>
                  </div>
                )}
              </div>
              {identity?.address && <p className="mt-4 text-xs text-silver">{identity.address}</p>}
            </div>
          </div>

          {/* Demo / contact form */}
          <form onSubmit={submit} noValidate className="rounded-xl border border-ash bg-white p-6 shadow-sm sm:p-8">
            <h3 className="text-base font-semibold text-gray-900">Request a demo</h3>
            <p className="mt-1 text-sm text-gray-500">
              Book a free walkthrough of the dashboard, tenant portal and M-Pesa flow — no commitment.
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Your name *</span>
                <TextInput value={form.name} onChange={setField('name')} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'demo-name-error' : undefined} autoComplete="name" />
                {errors.name && <span role="alert" id="demo-name-error" className="mt-1 block text-xs font-medium text-red-700">{errors.name}</span>}
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Email *</span>
                <TextInput type="email" value={form.email} onChange={setField('email')} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'demo-email-error' : undefined} autoComplete="email" />
                {errors.email && <span role="alert" id="demo-email-error" className="mt-1 block text-xs font-medium text-red-700">{errors.email}</span>}
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
                  className="flex min-h-[44px] w-full rounded-lg border border-ash bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-300/40"
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
                  className="w-full rounded-lg border border-ash bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-silver focus:border-brand-400 focus:ring-2 focus:ring-brand-300/40"
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
          <h2 className="type-heading text-gray-900">Frequently asked questions</h2>
          <p className="mt-3 text-base text-gray-500">
            The questions every landlord asks before moving off the exercise book. Anything else — <a href="#demo" className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">ask us</a>.
          </p>
        </div>

        <div data-reveal className="mt-8 divide-y divide-gray-200 rounded-xl bg-white shadow-md">
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