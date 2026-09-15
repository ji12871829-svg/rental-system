import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { branding } from '../lib/branding';
import { useBranding } from '../lib/BrandingContext';
import { BrandMark } from '../components/BrandMark';

/*
 * Legal pages. The business identity and policy details are live from the
 * backend (business_branding, editable on the Settings page). Unfilled
 * values are null — the affected clauses are omitted rather than showing
 * placeholder text on a public page. The "Last updated" date comes from the
 * shared BrandingContext (live DB updated_at, build-time branding.ts mtime
 * as fallback) — the same date shown on the Settings plate and app footer.
 */

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  const { tabTitleBrand, legalNameDisplay, lastUpdatedDisplay } = useBranding();
  useEffect(() => {
    document.title = `${title} · ${tabTitleBrand}`;
  }, [title, tabTitleBrand]);
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="mx-auto w-full max-w-3xl px-4">
        <Link
          to="/"
          className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700"
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Back to {branding.appName}
        </Link>
        <article className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="flex items-center gap-2.5">
            <BrandMark className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white" iconSize={18} />
            <div className="leading-tight">
              <div className="text-sm font-bold text-gray-900">{branding.appName}</div>
              {legalNameDisplay && <div className="text-[11px] text-gray-500">Operated by {legalNameDisplay}</div>}
            </div>
          </div>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mt-1 text-xs text-gray-500">Last updated: {lastUpdatedDisplay}</p>
          <div className="mt-6 space-y-6 text-sm leading-6 text-gray-700">{children}</div>
        </article>
      </div>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

// A contact detail that renders nothing when unfilled (callers omit the
// clause) and a clickable tel:/mailto: link once the real value exists.
function Contact({ kind, value }: { kind: 'email' | 'phone'; value: string | null }) {
  if (!value) return null;
  const href = kind === 'email'
    ? `mailto:${value}`
    : `tel:${value.replace(/[^+\d]/g, '')}`;
  return (
    <strong>
      <a
        href={href}
        className="font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline"
      >
        {value}
      </a>
    </strong>
  );
}

const Email = ({ email }: { email: string | null }) => <Contact kind="email" value={email} />;
const Phone = ({ phone }: { phone: string | null }) => <Contact kind="phone" value={phone} />;

// -------------------------------------------------------------------- Privacy
export function Privacy() {
  const { identity } = useBranding();
  return (
    <LegalShell title="Privacy Policy">
      <Section heading="Who we are">
        <p>
          {branding.appName} ({branding.appNameFull}) is operated by <strong>{identity?.legalName ?? branding.appNameLong}</strong>
          {identity?.registrationNumber && (<> , registered under no. <strong>{identity.registrationNumber}</strong></>)}
          {identity?.address && (<> , of <strong>{identity.address}</strong></>)}.
          {(identity?.privacyEmail || identity?.contactPhone) && (
            <>
              {' '}For any privacy question or request, contact <Email email={identity?.privacyEmail ?? null} />
              {identity?.privacyEmail && identity?.contactPhone ? ' or ' : ''}
              <Phone phone={identity?.contactPhone ?? null} />.
            </>
          )}
        </p>
      </Section>
      <Section heading="What data we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Staff accounts:</strong> name, email, phone number, and a password stored only as a cryptographic hash.</li>
          <li><strong>Tenant records:</strong> full name, phone number, email (optional), move-in/move-out dates, security deposit, unit assignment, and notes.</li>
          <li><strong>Property &amp; financial records:</strong> units, rent payments, water meter readings and bills, water purchase costs, expenses, receipts, and a log of SMS notifications sent to tenants.</li>
          <li><strong>Audit trail:</strong> which user created, changed, or deleted a record and when.</li>
        </ul>
      </Section>
      <Section heading="Why we collect it">
        <p>
          To administer the rental property: collect rent and bill water per metered readings, issue receipts,
          track arrears and expenses, keep the financial records required for accounting and tax purposes, and
          communicate with tenants. Tenant contact details are stored with the tenant's consent, confirmed through
          the consent checkbox on the tenant record form.
        </p>
      </Section>
      <Section heading="Where the data lives">
        <p>
          All data is stored in a PostgreSQL database controlled by the operator. The system does
          <strong> not</strong> use third-party analytics, advertising networks, or social-media trackers, and sends
          no data to external services. SMS messages are logged in the system; actual delivery is performed by the
          operator's chosen provider <strong>{branding.smsProviderName}</strong> when SMS sending is configured.
        </p>
      </Section>
      <Section heading="How long we keep it">
        <p>
          Records for an active tenancy are kept while the tenant resides at the property. Financial records are
          retained for <strong>{identity?.retentionPeriod ?? 'the period required'}</strong> as required for accounting and tax purposes.
          Former tenants may request deletion of their contact details at any time.
        </p>
      </Section>
      <Section heading="Your rights">
        <p>
          You may request a copy of your data, correction of inaccurate data, or deletion of data we are not
          legally required to keep, by writing to <Email email={identity?.privacyEmail ?? null} />. We respond within
          <strong>{identity?.responseDays ?? '30'} days</strong>. A copy of your data is provided as a machine-readable (JSON)
          file. Where financial records must be retained for accounting and tax purposes, an erasure request removes
          your personal identifiers (name, phone, email, notes, message history) while those records are preserved
          without them. This policy is prepared with the Kenya Data Protection Act, 2019 in mind;
          where the GDPR or another law applies to you, equivalent rights are honoured.
        </p>
      </Section>
      <Section heading="How we protect it">
        <p>
          Passwords are hashed (never stored in plain text), access is limited by role (admin / manager / staff),
          every change to a financial record is written to an audit log, and the database is accessible only to the
          operator.
        </p>
      </Section>
    </LegalShell>
  );
}

// --------------------------------------------------------------------- Terms
export function Terms() {
  const { identity } = useBranding();
  return (
    <LegalShell title="Terms & Conditions">
      <Section heading="Agreement">
        <p>
          By signing in to {branding.appName} you agree to these terms. The system is an internal business tool made available to
          authorised staff of <strong>{identity?.legalName ?? branding.appNameLong}</strong> only. Accounts are created by an
          administrator and may be deactivated at any time.
        </p>
      </Section>
      <Section heading="Accounts and roles">
        <p>
          You are responsible for keeping your sign-in credentials confidential. Each account is assigned a role
          (admin, manager, or staff) that determines what it can see and change. Administrators may reset passwords
          and change roles; misuse of an account is the responsibility of the account holder.
        </p>
      </Section>
      <Section heading="Records you enter">
        <p>
          Users are responsible for the accuracy of the rent payments, meter readings, expenses, and tenant details
          they record. The system keeps an audit trail of changes to financial records; deletions of rent payments
          intentionally preserve the original receipt for history.
        </p>
      </Section>
      <Section heading="Acceptable use">
        <p>
          Do not enter data you are not authorised to store, attempt to access other users' accounts, or use the
          system for any unlawful purpose. Tenant personal data may only be used for managing the tenancy.
        </p>
      </Section>
      <Section heading="Availability and changes">
        <p>
          The system is provided &ldquo;as is&rdquo; without warranty of uninterrupted availability. Features may be
          added, changed, or removed. The operator is not liable for losses arising from reliance on reports or
          summaries produced by the system; figures should be verified against source receipts and statements before
          being used in formal accounting.
        </p>
      </Section>
      <Section heading="Governing law">
          <p>These terms are governed by the laws of <strong>{identity?.jurisdiction ?? 'Kenya'}</strong>.</p>
      </Section>
    </LegalShell>
  );
}

// -------------------------------------------------------- Cookies & storage
export function Cookies() {
  return (
    <LegalShell title="Cookie & Storage Policy">
      <Section heading="No tracking">
        <p>
          {branding.appName} does <strong>not</strong> use advertising cookies, analytics services, social-media pixels, or any
          third-party tracking. Nothing you do here is shared with advertisers or data brokers.
        </p>
      </Section>
      <Section heading="What we do store in your browser">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Session cookie (required):</strong> after you sign in, a secure HttpOnly cookie keeps you signed in. Signing out removes it.</li>
          <li><strong>Notice acknowledgement:</strong> whether you have dismissed the storage notice banner.</li>
        </ul>
        <p>These are functional, not behavioural: they exist only to make sign-in work and remember your choices on this device.</p>
      </Section>
      <Section heading="Clearing stored data">
        <p>
          Signing out removes your session cookie. You can also clear site data at any time through your browser's
          settings (&ldquo;Clear browsing data&rdquo; &rarr; &ldquo;Cookies and other site data&rdquo;). The next
          visit will simply ask you to sign in again.
        </p>
      </Section>
    </LegalShell>
  );
}

// -------------------------------------------------------------------- Refund
export function Refund() {
  const { identity } = useBranding();
  return (
    <LegalShell title="Refund Policy">
      <Section heading="Scope">
        <p>
          This policy covers rent payments, water billings, and deposits recorded in {branding.appName}
          {identity?.propertyScope && (<> for <strong>{identity.propertyScope}</strong></>)}, paid via{' '}
          <strong>{identity?.paymentChannels ?? 'the payment channels stated on your receipts'}</strong>.
        </p>
      </Section>
      <Section heading="Rent overpayments">
        <p>
          If a tenant pays more than the amount due, the surplus is first credited against future months on the
          tenant's ledger. A cash refund of the surplus can be requested and is made through the original payment
          method within <strong>{identity?.refundWindowDays ?? '7–14'} days</strong> of the request being verified.
        </p>
      </Section>
      <Section heading="Water billing corrections">
        <p>
          Water is billed from metered readings. If a reading or tariff is recorded in error, the correction is
          applied to the next monthly statement, or refunded if the tenancy has ended. Meter readings can be
          re-verified on request.
        </p>
      </Section>
      <Section heading="Security deposits">
        <p>
          Deposits are held and returned in line with the tenancy agreement and applicable law. Any deductions are
          itemised in writing at the end of the tenancy.
        </p>
      </Section>
      {(identity?.contactEmail || identity?.contactPhone) && (
        <Section heading="Duplicate or erroneous payments">
          <p>
            If a payment is recorded twice or in the wrong amount, contact <Email email={identity?.contactEmail ?? null} />
            {identity?.contactEmail && identity?.contactPhone ? ' or ' : ''}
            <Phone phone={identity?.contactPhone ?? null} /> with the unit number, receipt number, amount, payment date, and
            method. Verified errors are reversed promptly and a corrected receipt issued.
          </p>
        </Section>
      )}
    </LegalShell>
  );
}
