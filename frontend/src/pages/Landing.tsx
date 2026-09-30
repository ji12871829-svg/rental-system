// Public marketing landing page — the front door of the whole system.
//
// Amie design system (design/amie-DESIGN.md): white canvas, achromatic
// surfaces, Inter with tight negative tracking, and one electric sky-blue
// that only fires for actions. Structure (a complete landing anatomy):
//   1. header — wordmark, anchor nav, ghost sign-in + sky CTA
//   2. hero — eyebrow, display headline with one amber highlight, paired
//      CTA + ghost, trust chips, product-frame preview panel
//   3. stat band — three big live metrics ("results" strip)
//   4. capabilities — six-card feature grid with category-tag pills
//   5. workflow — four numbered steps (sticky-left editorial layout)
//   6. M-Pesa band — dark ink section, checklist + phone-frame mock
//   7. audience split — tenant card vs landlord card (dual doors)
//   8. pricing — live room prices from GET /api/public/units
//   9. demo request — POST /api/public/demo-requests + contact cards
//  10. FAQ — accessible accordion
//  11. final CTA — ink band, single sky action + ghost secondary
//  12. footer — dark, link columns, legal, identity
//
// All copy stays honest to what the system actually ships — no invented customers,
// no fake numbers; the stat band and pricing render real data. Branding
// flows from BrandingContext so the page rebrands exactly like Login/portal.
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  ClipboardList,
  Droplets,
  FileSpreadsheet,
  KeyRound,
  Menu,
  MessageCircle,
  ReceiptText,
  Smartphone,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { LandingThemeToggle } from '../components/ThemeToggle';
import { useBranding } from '../lib/BrandingContext';
import { branding } from '../lib/branding';
import { useLandingSeo } from '../lib/seo';
import { useAuth } from '../lib/auth';
import { usePortalAuth } from '../lib/portalAuth';
import { DemoRequest, FaqSection, HowItWorks, Pricing, TrustMarquee, useLandingReveal, usePublicUnits } from './LandingSections';

// Header navigation — every section one click from the top of the page.
const NAV_LINKS = [
  { href: '#product', label: 'Product' },
  { href: '#workflow', label: 'How it works' },
  { href: '#mpesa', label: 'M-Pesa' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#demo', label: 'Contact' },
  { href: '#faq', label: 'FAQs' },
];

// Capability grid — six cards, each with a category tag pill whose accent
// follows the design's tag rule (accent colors are border-only, never fills).
const CAPABILITIES: { icon: typeof Wallet; tag: string; tagClass: string; title: string; body: string }[] = [
  {
    icon: Smartphone,
    tag: 'Payments',
    tagClass: 'border-brand-300 text-brand-600',
    title: 'M-Pesa collection on autopilot',
    body: 'Tenants pay by STK push or PayBill. Payments reconcile against the ledger the moment they land, and a numbered receipt goes out by email and SMS.',
  },
  {
    icon: ClipboardList,
    tag: 'Ledger',
    tagClass: 'border-emerald-300 text-emerald-700',
    title: 'A rent ledger that is never stale',
    body: 'Every unit\u2019s balance is current to the last transaction. See who has paid, who is behind and by exactly how much — live, not at month-end.',
  },
  {
    icon: Droplets,
    tag: 'Water',
    tagClass: 'border-brand-300 text-brand-600',
    title: 'Metered water, billed per unit',
    body: 'Record each unit\u2019s meter reading, let the system compute consumption against your tariff, and bill tenants automatically — arguments over.',
  },
  {
    icon: UserRound,
    tag: 'Self-service',
    tagClass: 'border-violet/40 text-violet',
    title: 'Tenants serve themselves',
    body: 'The tenant portal shows balances, payment history, water bills, statements and receipts — so the office phone stops ringing for answers tenants can look up.',
  },
  {
    icon: ReceiptText,
    tag: 'Records',
    tagClass: 'border-amber-300 text-amber-700',
    title: 'Numbered receipts on everything',
    body: 'Every payment gets a sequential receipt. Monthly statements and PDF downloads keep tenants and records in agreement, always.',
  },
  {
    icon: FileSpreadsheet,
    tag: 'Reporting',
    tagClass: 'border-emerald-300 text-emerald-700',
    title: 'Reports you can act on',
    body: 'Collection rates, arrears ageing, expense breakdowns and monthly summaries — on screen, exportable, and emailable to the business contact.',
  },
];

// Hero trust chips — what a new operator gets on day one.
const HERO_CHIPS = ['M-Pesa built in', 'Works on your phone', 'Up in under an hour'];

export default function Landing() {
  const { identity } = useBranding();
  const { token, ready } = useAuth();
  const { tenant } = usePortalAuth();

  // Amie-style restraint: one IntersectionObserver pass marks below-the-fold
  // sections for a single rise-in. No scroll listeners, no replays.
  useLandingReveal();

  // Deep links like /landing#demo (legal pages, shared URLs) must actually
  // scroll: React Router performs no native anchor jump on SPA navigation,
  // and the section only exists after mount. The jump is instant (like a
  // native hash jump, and what reduced motion wants anyway), then corrective
  // frames keep it on target while async content (pricing rows, contact
  // cards) grows the page over the first few hundred milliseconds.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const jump = () => {
      const el = document.querySelector(hash);
      if (!el) return false;
      const top = el.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: Math.max(top, 0), behavior: 'auto' });
      return true;
    };
    if (!jump()) return;
    let frames = 0;
    const settle = () => {
      const el = document.querySelector(hash);
      if (!el || frames++ > 40) return;
      if (Math.abs(el.getBoundingClientRect().top - 72) > 4) {
        jump();
        requestAnimationFrame(settle);
      }
    };
    requestAnimationFrame(settle);
  }, [hash]);

  // Social-preview + SEO metadata while the landing page is mounted (OG,
  // Twitter cards, canonical, JSON-LD LocalBusiness); restored on unmount.
  useLandingSeo(identity);

  // The hero photo badge and stat row render the operator's real roster
  // (live vacancy counts from the public units endpoint). Hook sits above
  // the signed-in redirects below — hooks never follow a conditional.
  const { rows: unitRows } = usePublicUnits();
  const totalUnits = unitRows?.reduce((n, r) => n + r.total, 0) ?? null;
  const totalVacant = unitRows?.reduce((n, r) => n + r.vacant, 0) ?? null;

  // Mobile nav menu (hamburger). Escape closes it like a sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Menu links scroll in JS: the panel is collapsing while the browser would
  // process the anchor jump, which races it. Compute the absolute position
  // and use window.scrollTo (proven reliable), offset by the sticky header.
  function goToSection(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (!el) return;
    const headerOffset = 72;
    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(top, 0), behavior: smooth ? 'smooth' : 'auto' });
  }

  // Signed-in users never see the marketing shell — straight to their app.
  if (ready && token) return <Navigate to="/" replace />;
  if (tenant) return <Navigate to="/portal" replace />;

  // WhatsApp deep link from the business identity's contact phone (Kenya:
  // wa.me takes digits, no plus; leading 0 becomes 254).
  const waDigits = identity?.contactPhone
    ? identity.contactPhone.replace(/[^0-9]/g, '').replace(/^0/, '254')
    : '';
  const waHref = waDigits.length >= 9 ? `https://wa.me/${waDigits}` : null;

  return (
    <div className="min-h-screen bg-white">
      {/* ---------------------------------------------------------- header */}
      <header className="landing-header-material sticky top-0 z-40 border-b border-gray-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
          {/* LEFT END: wordmark + section anchors — the page's own table of
              contents reads as one unit with the brand. Below xl the inline
              list hides (the hamburger menu owns it). */}
          <div className="flex min-w-0 items-center gap-6">
            <Link to="/landing" className="flex min-h-[44px] min-w-0 items-center gap-2.5">
              <BrandLogo
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white shadow-sm sm:h-10 sm:w-10"
                iconSize={18}
                textClassName="text-sm font-bold sm:text-base"
              />
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-900 sm:text-base">{branding.appName}</span>
                {identity?.legalName && (
                  <span className="hidden truncate text-xs text-silver sm:block">{identity.legalName}</span>
                )}
              </div>
            </Link>
            <span className="hidden items-center gap-5 xl:flex">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="inline-flex min-h-[44px] items-center whitespace-nowrap text-sm font-medium text-graphite transition-colors hover:text-black"
                >
                  {l.label}
                </a>
              ))}
            </span>
          </div>
          {/* RIGHT END: theme toggle + account actions. The unified sign-in
              serves both staff and tenants via tabs — one link covers every
              visitor; the sky CTA is the page's single filled action. */}
          <nav className="flex shrink-0 items-center gap-2">
            <LandingThemeToggle />
            {/* Sign in is ALWAYS visible: a ghost text link on sm+ (full
                label) and an icon button on the smallest phones, where four
                full-size controls would truncate the wordmark. The menu
                sheet keeps a Sign in row too — it costs one line and covers
                the open-menu browsing flow. */}
            <Link
              to="/login"
              aria-label="Sign in"
              className="press hidden min-h-[44px] items-center whitespace-nowrap rounded-xl border border-ash px-4 py-2 text-sm font-semibold text-graphite transition-[background-color,color] hover:bg-fog sm:flex"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              aria-label="Sign in"
              className="press flex min-h-[44px] w-11 items-center justify-center rounded-xl border border-ash text-graphite transition-[background-color,color] hover:bg-fog sm:hidden"
            >
              <KeyRound size={17} aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="landing-nav-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="press flex h-11 w-11 items-center justify-center rounded-lg border border-ash text-graphite transition-[background-color,color] hover:bg-fog lg:hidden"
            >
              {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
            <Link
              to="/register"
              className="press flex min-h-[44px] items-center whitespace-nowrap rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,color] hover:bg-brand-600 sm:px-4"
            >
              <span className="hidden sm:inline">Get started</span>
              <span className="sm:hidden">Start</span>
            </Link>
          </nav>
        </div>

        {/* Mobile menu sheet — an OVERLAY pinned below the bar, so opening it
            never changes document height and scroll targets stay stable. */}
        <div
          id="landing-nav-menu"
          className={`absolute inset-x-0 top-full z-40 grid border-b border-gray-200 bg-white transition-[grid-template-rows] duration-300 ease-out lg:hidden ${
            menuOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <nav aria-label="Page sections" className="mx-auto max-w-6xl px-4 pb-4 sm:px-5">
              <ul className="grid gap-1">
                {NAV_LINKS.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      onClick={(e) => goToSection(e, l.href)}
                      className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-graphite transition-[background-color,color] hover:bg-fog hover:text-black"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
                {/* Sign-in lives in the sheet on phones: the header bar only
                    keeps theme + the Start CTA so the wordmark never
                    truncates, and the unified login serves staff and tenants
                    from one door anyway. */}
                <li className="mt-1 border-t border-gray-100 pt-1">
                  <Link
                    to="/login"
                    className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-gray-900 transition-[background-color,color] hover:bg-fog"
                  >
                    Sign in
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        {/* The building this software actually runs — a light treatment now:
            the photo is the product's home, not a texture, so the scrim only
            deepens the bottom edge where the ink band meets it. */}
        <picture aria-hidden>
          <source
            type="image/webp"
            srcSet="/building/building-1-480.webp 480w, /building/building-1-800.webp 800w, /building/building-1-1600.webp 1600w"
          />
          <img
            src="/building/building-1-800.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-[0.12]"
            loading="eager"
            decoding="async"
          />
        </picture>

        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-14 text-center lg:pb-24 lg:pt-20">
          {/* Eyebrow — the design's inline label, not a pill. */}
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-graphite">
            <Building2 size={14} strokeWidth={1.75} className="text-brand-500" aria-hidden />
            Property management for{' '}
            <strong className="font-extrabold text-gray-900">{branding.appName}</strong>
          </p>

          {/* Display headline: Inter 700, tight tracking, ONE amber highlight
              per the design's inline-highlight rule. Centered like the photo-led
              hero: message first, the building itself as the visual anchor. */}
          <h1 className="type-display mx-auto mt-5 max-w-3xl text-gray-900">
            Run <span className="bg-sun px-1">{branding.appName}</span> from one ledger.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-graphite">
            Rent, water, receipts and messages for every unit at{' '}
            <strong className="font-semibold text-gray-900">{branding.appName}</strong> — in one place.
            M-Pesa payments post themselves to the ledger, and tenants check their balance,
            bills and statements without calling the office.
          </p>

          {/* The building photo card — the property this software runs, with a
              live vacancies badge straight from the rent ledger. Renders bare
              until the endpoint answers: the photo is the focal point, not the
              chrome around it. */}
          <div className="relative mx-auto mt-10 w-full max-w-3xl">
            <figure className="overflow-hidden rounded-2xl shadow-md ring-1 ring-black/5">
              <picture>
                <source
                  type="image/webp"
                  srcSet="/building/building-1-480.webp 480w, /building/building-1-800.webp 800w, /building/building-1-1600.webp 1600w"
                  sizes="(min-width: 768px) 768px, 100vw"
                />
                <img
                  src="/building/building-1-800.webp"
                  alt="The building this property management system runs"
                  className="h-60 w-full object-cover sm:h-80"
                  loading="eager"
                  decoding="async"
                />
              </picture>
            </figure>
            {totalVacant != null && (
              <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-900 shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                {totalVacant > 0 ? `${totalVacant} units available now` : 'Fully occupied'}
              </span>
            )}
          </div>

          {/* Two-stat row — the reference's post-photo strip, live numbers. */}
          {totalUnits != null && (
            <dl className="mx-auto mt-8 grid max-w-lg grid-cols-2 gap-4">
              <div className="rounded-xl border border-ash bg-white px-4 py-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-silver">Units on the ledger</dt>
                <dd className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-gray-900">{totalUnits}</dd>
              </div>
              <div className="rounded-xl border border-ash bg-white px-4 py-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-silver">Vacant now</dt>
                <dd className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-gray-900">{totalVacant}</dd>
              </div>
            </dl>
          )}

          {/* Paired choice: sky CTA + ghost secondary, the design's binary. */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="press inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-[background-color,color] hover:bg-brand-600"
            >
              Create an account <ArrowRight size={16} aria-hidden />
            </Link>
            <a
              href="#demo"
              className="press inline-flex items-center gap-2 rounded-xl border border-ash bg-white px-5 py-3 text-sm font-semibold text-graphite transition-[background-color,color] hover:bg-fog"
            >
              <MessageCircle size={16} aria-hidden /> Talk to us
            </a>
          </div>

          {/* Trust chips */}
          <ul className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2">
            {HERO_CHIPS.map((t) => (
              <li key={t} className="flex items-center gap-1.5 text-xs font-medium text-graphite">
                <Check size={13} className="text-brand-500" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------- trust marquee */}
      <TrustMarquee />

      {/* -------------------------------------------------------- stat band */}
      {/* Honest "results" strip: the numbers a landlord actually cares about,
          framed as what the system answers — no invented customer counts. */}
      <section className="border-y border-gray-200 bg-fog py-12">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 sm:grid-cols-3">
          {[
            { k: '60 seconds', v: 'From payment to posted receipt', d: 'M-Pesa lands, the ledger updates, the tenant is notified.' },
            { k: 'Per unit', v: 'Water billed from real meters', d: 'No flat-rate guessing, no end-of-month arguments.' },
            { k: 'One place', v: 'Rent, water, expenses, messages', d: 'The exercise book and the scattered spreadsheets retire.' },
          ].map((s) => (
            <div key={s.k}>
              <p className="type-heading text-gray-900">{s.k}</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{s.v}</p>
              <p className="mt-1 text-sm text-graphite">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- capabilities */}
      <section id="product" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="type-heading text-gray-900">Everything the ledger touches</h2>
            <p className="mt-3 text-base text-graphite">
              Six jobs a landlord does every month — the system does all of them in one place.
            </p>
          </div>
          <div data-reveal className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, tag, tagClass, title, body }) => (
              <article key={title} className="group relative flex flex-col rounded-xl bg-white p-6 shadow-md transition-[box-shadow,transform] duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-lg">
                {/* Category tag pill: accent is border-only, per the design. */}
                <span className={`absolute -top-2.5 right-4 rounded-full border bg-white px-2.5 py-0.5 text-[10px] font-semibold ${tagClass}`}>
                  {tag}
                </span>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-fog text-gray-700 transition-colors duration-300 group-hover:text-brand-500">
                  <Icon size={22} strokeWidth={1.75} aria-hidden />
                </div>
                <h3 className="type-heading-sm mt-4 text-gray-900">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-graphite">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- workflow */}
      <HowItWorks />

      {/* ---------------------------------------------- M-Pesa deep-dive */}
      <section id="mpesa" className="scroll-mt-20 bg-ink">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-silver">
                <Smartphone size={13} aria-hidden /> M-Pesa built in
              </span>
              <h2 className="type-heading mt-4 text-white">Payments that post themselves</h2>
              <p className="mt-3 max-w-lg text-base leading-relaxed text-silver">
                No more &ldquo;I sent but it didn&rsquo;t reflect.&rdquo; The moment a payment lands,
                the ledger knows — and so does the tenant.
              </p>
              <ul className="mt-6 space-y-4">
                {[
                  { t: 'STK push — one tap to pay', d: 'The tenant taps Pay Rent in their portal; the M-Pesa prompt appears on their phone. PIN, done.' },
                  { t: 'Automatic reconciliation', d: 'Payments are matched to the right tenant and month. Balances update instantly.' },
                  { t: 'PayBill, too', d: 'PayBill and manual channels flow through the same ledger, with the same receipts.' },
                  { t: 'A live status timeline', d: 'Tenants watch their payment move: request sent → M-Pesa confirmed → posted to ledger.' },
                ].map((item) => (
                  <li key={item.t} className="flex items-start gap-3">
                    <Check size={16} className="mt-1 shrink-0 text-brand-400" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-white">{item.t}</span>
                      <span className="block text-sm text-silver">{item.d}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Phone frame: the design's product-preview treatment on ink. */}
            <div className="mx-auto w-full max-w-xs">
              <div className="gray-reveal rounded-b-[2rem] rounded-t-[2.5rem] border-[6px] border-charcoal bg-white p-5 shadow-2xl">
                <p className="text-[11px] font-medium uppercase tracking-wide text-silver">Tenant portal</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">Pay April rent</p>
                <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-gray-900">KSh 9,000</p>
                <p className="text-xs text-silver">Balance due in 12 days</p>
                <button
                  type="button"
                  tabIndex={-1}
                  className="mt-4 w-full cursor-default rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white"
                >
                  Send M-Pesa request
                </button>
                <div className="mt-4 space-y-2">
                  {[
                    { s: 'Request sent', done: true },
                    { s: 'M-Pesa confirmed', done: true },
                    { s: 'Posted to ledger', done: false },
                  ].map((st, i) => (
                    <div key={st.s} className="flex items-center gap-2">
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${st.done ? 'bg-brand-500 text-white' : 'bg-gray-100 text-silver'}`}>
                        {st.done ? '✓' : i + 1}
                      </span>
                      <span className={`text-xs ${st.done ? 'text-gray-900' : 'text-silver'}`}>{st.s}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- audience split */}
      <section id="create-account" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="max-w-2xl">
            <h2 className="type-heading text-gray-900">Two doors, one system</h2>
            <p className="mt-3 text-base text-graphite">
              Tenants get instant self-service. Landlord and agent accounts are approved by an
              administrator before they touch money.
            </p>
          </div>

          <div data-reveal className="mt-10 grid gap-6 md:grid-cols-2">
            {/* Tenants */}
            <div className="flex flex-col rounded-xl border border-ash bg-white p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-fog text-gray-700">
                <UserRound size={24} strokeWidth={1.75} aria-hidden />
              </div>
              <h3 className="type-heading-sm mt-4 text-gray-900">I'm a tenant</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-graphite">
                Your property manager adds your tenancy first — then you claim portal access with
                the email on file and set your own password. Instant, self-serve.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-graphite">
                {['Rent balance & payment history', 'Water readings and bills', 'Receipts and statements', 'Pay rent via M-Pesa'].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check size={15} className="text-brand-500" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
              <Link
                to="/register?type=tenant"
                className="press mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[background-color,color] hover:bg-brand-600"
              >
                Create tenant access <ArrowRight size={15} aria-hidden />
              </Link>
              <p className="mt-3 text-center text-xs text-silver">
                Already have access?{' '}
                <Link to="/login?type=tenant" className="font-medium text-gray-900 underline underline-offset-2 hover:text-brand-600">
                  Sign in to the tenant portal
                </Link>
              </p>
            </div>

            {/* Landlords */}
            <div className="flex flex-col rounded-xl border border-ash bg-white p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-white">
                <Users size={24} strokeWidth={1.75} aria-hidden />
              </div>
              <h3 className="type-heading-sm mt-4 text-gray-900">I'm a landlord or agent</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-graphite">
                Request a staff account for the management dashboard. An administrator reviews and
                activates it — nobody reaches the money side uninvited.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-graphite">
                {['Full management dashboard', 'Record payments, expenses, readings', 'M-Pesa review & messaging tools', 'Reports and audit logs'].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Check size={15} className="text-gray-900" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
              <Link
                to="/register?type=landlord"
                className="press mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-[background-color,color] hover:bg-charcoal"
              >
                Request staff access <ArrowRight size={15} aria-hidden />
              </Link>
              <p className="mt-3 text-center text-xs text-silver">
                Already approved?{' '}
                <Link to="/login" className="font-medium text-gray-900 underline underline-offset-2 hover:text-brand-600">
                  Sign in as staff
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- pricing (live data) */}
      <Pricing />

      {/* --------------------------------------------- request a demo */}
      <DemoRequest />

      {/* ------------------------------------------------------ FAQs */}
      <FaqSection />

      {/* ----------------------------------------------------- final CTA */}
      <section className="bg-ink">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center lg:py-20">
          <h2 className="type-heading text-white sm:text-4xl">
            The next rent payment could post itself.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-silver">
            Create your account, bring your property on, and let the ledger, water meters and
            M-Pesa receipts do the chasing.
          </p>
          <div data-reveal className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="press inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-[background-color,color] hover:bg-brand-600"
            >
              Create an account <ArrowRight size={16} aria-hidden />
            </Link>
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-[background-color] hover:bg-white/10"
              >
                <MessageCircle size={16} aria-hidden /> WhatsApp us
              </a>
            )}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      {/* The design's one inversion closes the page: dark, airy link columns. */}
      <footer className="bg-ink">
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <BrandLogo className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white" iconSize={16} />
                <span className="text-sm font-semibold text-white">{branding.appName}</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-silver">
                {/* The legal name repeats the wordmark more often than not —
                    only render it when it actually adds information. */}
                {identity?.legalName && identity.legalName !== branding.appName && (
                  <span className="block">{identity.legalName}</span>
                )}
                {identity?.address && <span className="block">{identity.address}</span>}
              </p>
            </div>
            <nav aria-label="Page sections" className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-white">Explore</p>
              {NAV_LINKS.slice(0, 4).map((l) => (
                <a key={l.href} href={l.href} className="text-xs text-silver transition-colors hover:text-white">
                  {l.label}
                </a>
              ))}
            </nav>
            <nav aria-label="Get started" className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-white">Get started</p>
              <Link to="/register" className="text-xs text-silver transition-colors hover:text-white">Create an account</Link>
              <Link to="/login" className="text-xs text-silver transition-colors hover:text-white">Sign in</Link>
              <Link to="/register?type=tenant" className="text-xs text-silver transition-colors hover:text-white">Tenant access</Link>
              <a href="#demo" className="text-xs text-silver transition-colors hover:text-white">Request a demo</a>
            </nav>
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-white">Legal</p>
              <Link to="/privacy" className="text-xs text-silver transition-colors hover:text-white">Privacy Policy</Link>
              <Link to="/terms" className="text-xs text-silver transition-colors hover:text-white">Terms &amp; Conditions</Link>
              <Link to="/cookies" className="text-xs text-silver transition-colors hover:text-white">Cookies &amp; Storage</Link>
              <Link to="/refunds" className="text-xs text-silver transition-colors hover:text-white">Refund Policy</Link>
            </div>
          </div>
          <div className="mt-10 border-t border-white/10 pt-6 text-xs text-silver">
            © {new Date().getFullYear()} {identity?.legalName ?? branding.appName}
          </div>
        </div>
      </footer>

      {/* Spacer so the sticky bar never covers the footer's last line — it
          also lifts by the storage banner's height when that notice is
          showing, so the two bottom-docked surfaces never overlap. */}
      <div aria-hidden className="h-[calc(76px+var(--rpms-banner-h,0px))] lg:hidden" />

      {/* Sticky mobile action bar — the reference's thumb-first conversion
          pair, pinned while browsing the listings. Desktop hides it: the
          header CTAs are already in reach. */}
      <div
        className="fixed inset-x-0 z-30 flex gap-2 border-t border-gray-200 bg-white/95 p-3 backdrop-blur lg:hidden"
        style={{ bottom: 'var(--rpms-banner-h, 0px)' }}
      >
        <a
          href="#demo"
          className="press flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-ash bg-white px-4 text-sm font-semibold text-gray-900 transition-[background-color,color,transform] hover:bg-fog"
        >
          <CalendarClock size={16} aria-hidden /> Book viewing
        </a>
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="press flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,color,transform] hover:bg-emerald-700"
          >
            <MessageCircle size={16} aria-hidden /> WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
