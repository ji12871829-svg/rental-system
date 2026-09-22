// Public marketing landing page — the front door of the whole system.
//
// Sits at "/" and is shown to signed-out visitors; an authenticated staff
// user hitting "/" is bounced straight to the dashboard (see the redirect
// below), so the landing never gets between staff and their work.
//
// Structure (modelled on the rentall.co.ke marketing pattern, honest to what
// this system actually does):
//   1. light hero with headline and dual CTA over the real building photo
//   2. "sound familiar?" problem→solution pairs (the classic pain points of
//      Kenyan rent collection, each answered by a real capability)
//   3. features grid (what the system actually ships)
//   4. how-it-works steps · M-Pesa deep-dive band
//   5. pricing (live) · demo/contact form · FAQs
//   6. final CTA + footer with link columns
//
// All branding (logo, business name, contacts) flows from BrandingContext so
// the page rebrands itself exactly like Login and the portal do.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardList,
  Droplets,
  FileSpreadsheet,
  KeyRound,
  MessageCircle,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  UserRound,
  Users,
  Wallet,
  X,
  Menu,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { useBranding } from '../lib/BrandingContext';
import { branding } from '../lib/branding';
import { useAuth } from '../lib/auth';
import { usePortalAuth } from '../lib/portalAuth';
import { DemoRequest, FaqSection, HowItWorks, Pricing, SectionLinks, useLandingReveal } from './LandingSections';

// The pain→answer pairs. Left column is the landlord's old month; right is
// the same job in this system. Copy stays within what RPMS genuinely does —
// no mobile apps or caretaker portals we don't have.
const PROBLEMS: { pain: string; fix: string }[] = [
  { pain: 'Chasing tenants for rent every month', fix: 'M-Pesa STK push — tenants pay in seconds' },
  { pain: 'No idea who has paid and who owes', fix: 'Live ledger shows every unit\u2019s balance at a glance' },
  { pain: 'Water bills argued at the end of the month', fix: 'Per-unit meters with automatic, itemised billing' },
  { pain: 'Exercise books and scattered spreadsheets', fix: 'Payments, expenses and receipts in one system' },
  { pain: 'Can\u2019t keep an eye on the property from a distance', fix: 'Full dashboard from anywhere, on phone or laptop' },
  { pain: 'Awkward move-outs and deposit disputes', fix: 'Complete payment history and statements per tenant' },
];

const FEATURES: { icon: typeof Wallet; title: string; body: string; badge?: string }[] = [
  {
    icon: Smartphone,
    badge: 'Kenya\u2019s #1 payment method',
    title: 'M-Pesa rent collection',
    body: 'Tenants pay by STK push or PayBill. Payments reconcile automatically and a numbered receipt goes out by email and SMS.',
  },
  {
    icon: ClipboardList,
    title: 'Rent ledger & arrears',
    body: 'Every unit\u2019s balance is always current. See who has paid, who is behind and by how much — live, not at month-end.',
  },
  {
    icon: Droplets,
    title: 'Metered water billing',
    body: 'Record readings per unit, let the system compute consumption and charges, and bill tenants automatically.',
  },
  {
    icon: UserRound,
    title: 'Tenant self-service portal',
    body: 'Tenants check balances, pay rent, download statements and receipts, and follow their water bills without calling you.',
  },
  {
    icon: ReceiptText,
    title: 'Receipts & statements',
    body: 'Numbered receipts on every payment. Monthly statements and PDF downloads for tenants, and email delivery built in.',
  },
  {
    icon: Wallet,
    title: 'Expense tracking',
    body: 'Log property expenses by category, tie them to the month and the unit, and see net performance, not just collections.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Reports & analytics',
    body: 'Monthly summaries, collection rates, arrears ageing and expense breakdowns — on screen, exportable, emailable.',
  },
  {
    icon: ShieldCheck,
    title: 'Audit trail & access control',
    body: 'Staff accounts are admin-approved; every action is written to an audit log. Tenants see only their own data.',
  },
  {
    icon: MessageCircle,
    title: 'Email & SMS messaging',
    body: 'Receipts, water bills and notices reach tenants automatically — with delivery status and balance visibility on the dashboard.',
  },
];

// Header navigation — every section one click from the top of the page.
// Shared by the desktop inline row (xl+) and the mobile hamburger panel.
const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#mpesa', label: 'M-Pesa' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#demo', label: 'Contact' },
  { href: '#faq', label: 'FAQs' },
];

export default function Landing() {
  const { identity } = useBranding();
  const { token, ready } = useAuth();
  const { tenant } = usePortalAuth();

  // Apple-style restraint: one IntersectionObserver pass marks below-the-fold
  // sections for a single rise-in. No scroll listeners, no replays.
  useLandingReveal();

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
  // process the anchor jump, which races it — and scrollIntoView is flaky in
  // some Chromium builds when the collapsing grid ancestor is in play. Compute
  // the absolute position and use window.scrollTo (proven reliable), offset by
  // the sticky header so section titles don't hide beneath it.
  function goToSection(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    const el = document.querySelector(href);
    if (!el) return;
    const headerOffset = 72; // sticky header height + breathing room
    const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(top, 0), behavior: smooth ? 'smooth' : 'auto' });
  }

  // Signed-in users never see the marketing shell — straight to their app.
  if (ready && token) return <Navigate to="/" replace />; // handled by App route guard too
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
      <header className="landing-header-material sticky top-0 z-40 border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
          {/* LEFT END: brand + the section anchors — the page's own table of
              contents reads as one unit with the wordmark. Below xl the inline
              list hides (the hamburger menu owns it) so the brand breathes. */}
          <div className="flex min-w-0 items-center gap-6">
            <Link to="/landing" className="flex min-w-0 items-center gap-2.5">
              <BrandLogo
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm shadow-brand-500/30 sm:h-10 sm:w-10"
                iconSize={18}
                textClassName="text-sm font-bold sm:text-base"
              />
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-900 sm:text-base">{branding.appName}</span>
                {identity?.legalName && (
                  <span className="hidden truncate text-xs text-gray-500 sm:block">{identity.legalName}</span>
                )}
              </div>
            </Link>
            <span className="hidden items-center gap-5 xl:flex">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="whitespace-nowrap text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
                >
                  {l.label}
                </a>
              ))}
            </span>
          </div>
          {/* RIGHT END: theme toggle + account actions, pushed hard against
              the far edge. The unified sign-in serves both staff and tenants
              via tabs, so one link covers every visitor. */}
          <nav className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            {/* Phone/tablet: hamburger opens the section menu sheet. */}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="landing-nav-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100 lg:hidden"
            >
              {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
            <Link
              to="/login"
              aria-label="Staff sign in"
              className="hidden min-h-[40px] items-center whitespace-nowrap rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 sm:flex"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              aria-label="Staff sign in"
              className="flex min-h-[40px] w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition-colors hover:bg-gray-50 sm:hidden"
            >
              <KeyRound size={17} aria-hidden />
            </Link>
            <Link
              to="/register"
              className="flex min-h-[40px] items-center whitespace-nowrap rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700 sm:px-4"
            >
              <span className="hidden sm:inline">Create account</span>
              <span className="sm:hidden">Sign up</span>
            </Link>
          </nav>
        </div>

        {/* Mobile menu sheet — an OVERLAY pinned below the bar (absolute inside
            the sticky header), so opening it never changes document height and
            scroll targets stay stable. Same fluid height animation as the FAQ
            rows; closes on selection or Escape. */}
        <div
          id="landing-nav-menu"
          className={`absolute inset-x-0 top-full z-40 grid border-b border-gray-100 bg-white/95 shadow-xl backdrop-blur-md transition-[grid-template-rows] duration-300 ease-out lg:hidden ${
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
                      className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}              </ul>
            </nav>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden bg-[#0b1f3a]">
        {/* Same facade photo the login page uses — the building this software
            actually runs — with a deep navy scrim for copy legibility. */}
        <picture aria-hidden>
          <source
            type="image/webp"
            srcSet="/building/building-1-480.webp 480w, /building/building-1-800.webp 800w, /building/building-1-1600.webp 1600w"
          />
          <img
            src="/building/building-1-800.webp"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-60"
            loading="eager"
            decoding="async"
          />
        </picture>
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b1f3a]/95 via-[#0b1f3a]/80 to-[#0b1f3a]/40" aria-hidden />

        <div className="relative mx-auto max-w-6xl px-5 py-16 lg:py-24">
          {/* Left: pitch */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-medium tracking-wide text-slate-200 backdrop-blur-sm">
              <Building2 size={14} aria-hidden />
              Property management for Olbano Plaza
            </div>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl">
              Automate rent collection. Track water. Run your property from anywhere.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300">
              RPMS keeps landlords, managers and tenants working from the same truth: live arrears,
              metered water billing, M-Pesa payments, receipts and messages.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700"
              >
                Create an account <ArrowRight size={16} aria-hidden />
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 active:scale-[0.98] active:bg-white/15"
              >
                <MessageCircle size={16} aria-hidden /> Talk to us
              </a>
            </div>

            {/* Trust chips — the reference site's "setup in 2 minutes" strip */}
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2">
              {['M-Pesa built in', 'Works on your phone', 'No training needed'].map((t) => (
                <li key={t} className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Check size={13} className="text-brand-300" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------ problem → solution */}
      <section className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Sound familiar?</h2>
          <p className="mt-3 text-base text-gray-500">
            Every landlord faces these problems. This system solves each one.
          </p>
        </div>
        <div data-reveal className="mt-10 grid gap-4 md:grid-cols-2">
          {PROBLEMS.map(({ pain, fix }) => (
            <div key={pain} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:flex-row md:items-stretch">
              <div className="flex flex-1 items-start gap-3 p-5">
                <X size={16} className="mt-0.5 shrink-0 text-red-500" aria-hidden />
                <p className="text-sm text-gray-600">{pain}</p>
              </div>
              <div className="flex flex-1 items-start gap-3 border-t border-brand-100 bg-brand-50 p-5 md:border-l md:border-t-0">
                <Check size={16} className="mt-0.5 shrink-0 text-brand-600" aria-hidden />
                <p className="text-sm font-medium text-gray-900">{fix}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- features */}
      <section id="features" className="scroll-mt-20 border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Everything you need to run your property</h2>
            <p className="mt-3 text-base text-gray-500">
              From M-Pesa rent collection to metered water billing — the tools landlords and
              managers actually use, in one place.
            </p>
          </div>
          <div data-reveal className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body, badge }) => (
              <article key={title} className="relative flex flex-col rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                {badge && (
                  <span className="absolute -top-2.5 right-4 rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    {badge}
                  </span>
                )}
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon size={22} aria-hidden />
                </div>
                <h3 className="mt-4 text-base font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- how it works */}
      <HowItWorks />

      {/* ---------------------------------------------- M-Pesa deep-dive */}
      <section id="mpesa" className="scroll-mt-20 bg-[#0b1f3a]">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/15">
                <Smartphone size={13} aria-hidden /> M-Pesa built in
              </span>
              <h2 className="mt-4 text-3xl font-semibold text-white">Rent collection that actually works</h2>
              <p className="mt-3 text-base leading-relaxed text-slate-300">
                No more chasing tenants. No more &ldquo;I sent but it didn&rsquo;t reflect.&rdquo; Payments land on the
                ledger the moment they are made.
              </p>
              <ul className="mt-6 space-y-4">
                {[
                  { t: 'STK push — one tap to pay', d: 'The tenant taps Pay Rent in their portal; the M-Pesa prompt appears on their phone. PIN, done.' },
                  { t: 'Automatic reconciliation', d: 'Payments are matched to the right tenant and month. Balances update instantly.' },
                  { t: 'Instant receipts', d: 'A numbered receipt is generated and sent by email and SMS the moment payment lands.' },
                  { t: 'PayBill & other channels', d: 'PayBill payments flow through the same ledger; cash and bank records are just as easy to keep.' },
                ].map((item) => (
                  <li key={item.t} className="flex items-start gap-3">
                    <Check size={16} className="mt-1 shrink-0 text-brand-300" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold text-white">{item.t}</span>
                      <span className="block text-sm text-slate-300">{item.d}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {/* A stylised phone frame with the payment moment — echoes the
                reference's app screenshots without pretending we have one. */}
            <div className="mx-auto w-full max-w-xs">
              <div className="rounded-[2rem] border-[6px] border-gray-900 bg-gray-50 shadow-2xl">
                <div className="rounded-[1.6rem] bg-white p-5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Tenant portal</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">Unit B4 · April rent</p>
                  <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-gray-900">KSh 9,000</p>
                  <p className="text-xs text-gray-500">Balance due in 12 days</p>
                  <div className="mt-4 rounded-xl bg-emerald-50 p-3">
                    <p className="text-xs font-semibold text-emerald-700">M-Pesa STK push</p>
                    <p className="mt-0.5 text-xs text-emerald-600">Enter PIN on your phone to pay</p>
                  </div>
                  <div className="mt-3 rounded-xl bg-brand-50 p-3">
                    <p className="text-xs font-semibold text-brand-800">Receipt RCP-0142</p>
                    <p className="mt-0.5 text-xs text-brand-700">Sent by email &amp; SMS · ledger updated</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- create account */}
      <section id="create-account" className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gray-900">Built for every role</h2>
          <p className="mt-3 text-base text-gray-500">
            Two doors, one system. Tenants get instant access; landlord and agent accounts are
            approved by an administrator before they go live.
          </p>
        </div>

        <div data-reveal className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Tenants */}
          <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-7 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <UserRound size={24} aria-hidden />
            </div>
            <h3 className="mt-4 text-xl font-semibold text-gray-900">I'm a tenant</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">
              Your property manager adds your tenancy first — then you claim portal access with the
              email on file and set your own password. Instant, self-serve, nothing to wait for.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              {['Rent balance & payment history', 'Water readings and bills', 'Receipts and statements', 'Pay rent via M-Pesa'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check size={15} className="text-brand-600" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <Link
              to="/register?type=tenant"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-5 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100"
            >
              Create tenant access <ArrowRight size={15} aria-hidden />
            </Link>
            <p className="mt-3 text-center text-xs text-gray-400">
              Already have access?{' '}
              <Link to="/login?type=tenant" className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
                Sign in to the tenant portal
              </Link>
            </p>
          </div>

          {/* Landlords */}
          <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-7 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-900 text-white">
              <Users size={24} aria-hidden />
            </div>
            <h3 className="mt-4 text-xl font-semibold text-gray-900">I'm a landlord or agent</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-500">
              Request a staff account for the management dashboard. An administrator reviews and
              activates it — nobody gets into the money side of the system uninvited.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              {['Full management dashboard', 'Record payments, expenses, readings', 'M-Pesa review & messaging tools', 'Reports and audit logs'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check size={15} className="text-gray-900" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <Link
              to="/register?type=landlord"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black"
            >
              Request staff access <ArrowRight size={15} aria-hidden />
            </Link>
            <p className="mt-3 text-center text-xs text-gray-400">
              Already approved?{' '}
              <Link to="/login" className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900">
                Sign in as staff
              </Link>
            </p>
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
      <section className="bg-[#0b1f3a]">
        <div className="mx-auto max-w-6xl px-5 py-16 text-center lg:py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Stop chasing rent. Start seeing every shilling.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-300">
            Create your account, bring your property on, and let the ledger, water meters and
            M-Pesa receipts do the chasing for you.
          </p>
        <div data-reveal className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/30 transition-colors hover:bg-brand-700"
            >
              Create an account <ArrowRight size={16} aria-hidden />
            </Link>
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                <MessageCircle size={16} aria-hidden /> WhatsApp us
              </a>
            )}
            <a
              href="#demo"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Request a demo
            </a>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto max-w-6xl px-5 py-10">
          {/* Section anchors repeated here — every section one click away. */}
          <SectionLinks className="flex flex-wrap gap-x-6 gap-y-2" />
          <div className="mt-6 flex flex-col gap-4 border-t border-gray-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-500">
              {identity?.legalName ?? branding.appName}
              {identity?.address && <span className="block text-xs text-gray-400">{identity.address}</span>}
            </div>
            <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-500">
              <Link to="/privacy" className="hover:text-gray-800">Privacy Policy</Link>
              <Link to="/terms" className="hover:text-gray-800">Terms &amp; Conditions</Link>
              <Link to="/cookies" className="hover:text-gray-800">Cookies &amp; Storage</Link>
              <Link to="/refunds" className="hover:text-gray-800">Refund Policy</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
