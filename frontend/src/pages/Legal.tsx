import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { branding } from '../lib/branding';
import { useBranding } from '../lib/BrandingContext';
import { BrandMark } from '../components/BrandMark';
import { Toon } from '../components/Toon';

/*
 * Legal pages. The business identity and policy details are live from the
 * backend (business_branding, editable on the Settings page). Unfilled
 * values are null — the affected clauses are omitted rather than showing
 * placeholder text on a public page. The "Last updated" date comes from the
 * shared BrandingContext (live DB updated_at, build-time branding.ts mtime
 * as fallback) — the same date shown on the Settings plate and app footer.
 *
 * Content reflects what the system actually does today: staff accounts,
 * the self-service tenant portal (with M-Pesa payments initiated from it),
 * and the public landing page's demo-request form.
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
          to="/landing"
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-brand-600 transition-colors duration-150 hover:text-brand-700"
        >
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
          Back to {branding.appName}
        </Link>
        <article className="mt-4 rounded-xl border border-gray-200 bg-white p-6 shadow-md sm:p-10">
          <div className="flex items-center gap-2.5">
            <BrandMark className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white" iconSize={18} />
            <div className="leading-tight">
              <div className="text-sm font-bold text-gray-900">{branding.appName}</div>
              {legalNameDisplay && <div className="text-[11px] text-gray-500">Operated by {legalNameDisplay}</div>}
            </div>
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 text-xs text-gray-500">Last updated: {lastUpdatedDisplay}</p>
          <div className="mt-6 space-y-6 text-sm leading-6 text-gray-700">{children}</div>
          {/* Warmth: the mascot points readers with questions to the contact
              section — the Instructions-page onboarding banner's idiom,
              quieted for a legal footer. Decorative: the link carries the
              meaning for screen readers. */}
          <div className="mt-8 flex items-center gap-4 rounded-xl border border-ash bg-fog p-4">
            <Toon size={64} pose="point" className="shrink-0" />
            <p className="text-sm leading-6 text-graphite">
              Questions about this policy?{' '}
              <Link
                to="/landing#demo"
                className="font-medium text-brand-600 underline underline-offset-2 transition-colors duration-150 hover:text-brand-700"
              >
                Reach us here
              </Link>{' '}
              — we usually reply the same day.
            </p>
          </div>
          <nav aria-label="Other policies" className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-gray-100 pt-5 text-xs">
            <span className="font-medium text-gray-500">Other policies:</span>
            {[
              { to: '/privacy', label: 'Privacy Policy' },
              { to: '/terms', label: 'Terms & Conditions' },
              { to: '/cookies', label: 'Cookie & Storage Policy' },
              { to: '/refunds', label: 'Refund Policy' },
            ]
              .filter((l) => !location.pathname.startsWith(l.to))
              .map((l) => (
                <Link key={l.to} to={l.to} className="font-medium text-brand-600 underline-offset-2 transition-colors duration-150 hover:text-brand-700 hover:underline">
                  {l.label}
                </Link>
              ))}
          </nav>
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
          <li><strong>Staff accounts:</strong> name, email, phone number, and a password stored only as a cryptographic hash. Staff accounts are requested publicly but created and activated by an administrator.</li>
          <li><strong>Tenant records:</strong> full name, phone number, email (optional), move-in/move-out dates, security deposit, unit assignment, and notes.</li>
          <li><strong>Tenant portal accounts:</strong> the tenant&rsquo;s email and a password stored only as a cryptographic hash, used to sign in to the self-service portal.</li>
          <li><strong>Property &amp; financial records:</strong> units, rent payments (including M-Pesa transactions), water meter readings and bills, water purchase costs, expenses, receipts, and a log of SMS notifications sent to tenants.</li>
          <li><strong>Enquiries:</strong> if you request a demo or contact us through the public site, we keep the name, email, phone number and property details you submit so we can respond.</li>
          <li><strong>Audit trail:</strong> which user created, changed, or deleted a record and when.</li>
        </ul>
      </Section>
      <Section heading="Why we collect it">
        <p>
          To administer the rental property: collect rent and bill water per metered readings, issue receipts,
          track arrears and expenses, keep the financial records required for accounting and tax purposes, and
          communicate with tenants. Tenant contact details are stored with the tenant&rsquo;s consent, confirmed through
          the consent checkbox on the tenant record form. Where a tenant portal account exists, the email is used to
          give the tenant self-service access to their own balance, receipts, water bills and statements, and to let
          them pay rent via M-Pesa without visiting the office.
        </p>
      </Section>
      <Section heading="Where the data lives">
        <p>
          All data is stored in a PostgreSQL database controlled by the operator. The system does
          <strong> not</strong> use third-party analytics, advertising networks, or social-media trackers, and sends
          no data to external services beyond what operating the product requires. SMS messages are logged in the
          system; actual delivery is performed by the operator&rsquo;s chosen provider <strong>{branding.smsProviderName}</strong> when SMS sending is configured.
          Rent payments made through M-Pesa are processed by Safaricom&rsquo;s M-Pesa service to the operator&rsquo;s
          own account; the payment result is recorded in the ledger.
        </p>
      </Section>
      <Section heading="How long we keep it">
        <p>
          Records for an active tenancy are kept while the tenant resides at the property. Financial records are
          retained for <strong>{identity?.retentionPeriod ?? 'the period required'}</strong> as required for accounting and tax purposes.
          Former tenants may request deletion of their contact details at any time; a portal access account is
          deactivated when a tenancy ends.
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
          and every change to a financial record is written to an audit log. Tenant portal accounts see only their
          own unit, balance, payments, water readings and statements — never other tenants&rsquo; data, staff records,
          expenses or reports. Sessions are kept in secure HttpOnly cookies with cross-site request forgery
          protection, and the database is accessible only to the operator.
        </p>
      </Section>
    </LegalShell>
  );
}

// --------------------------------------------------------------------- Terms
// Numbered, comprehensive terms in the usual order of a terms-of-use page
// (agreement → accounts → IP → acceptable use → records → payments →
// availability → termination → liability → law → contact). Written for what
// this system actually is — an internal property-management tool with a
// self-service tenant portal — with the operator's live identity woven in.
export function Terms() {
  const { identity } = useBranding();
  const law = identity?.jurisdiction ?? 'Kenya';
  return (
    <LegalShell title="Terms & Conditions">
      <Section heading="1. Agreement to these terms">
        <p>
          These Terms &amp; Conditions form a binding agreement between you and <strong>{identity?.legalName ?? branding.appNameLong}</strong>
          {identity?.registrationNumber && (<> (registration no. <strong>{identity.registrationNumber}</strong>)</>) }
          {identity?.address && (<> , of <strong>{identity.address}</strong></>) }
          , the operator of {branding.appName} ({branding.appNameFull}).
        </p>
        <p>
          By visiting the site, signing in as staff, or using the tenant portal, you confirm that you have read,
          understood and accepted these terms. If you do not accept them, stop using the system immediately. The
          <Link to="/privacy"> Privacy Policy</Link>, <Link to="/cookies">Cookie &amp; Storage Policy</Link> and
          <Link to="/refunds"> Refund Policy</Link> work alongside these terms; where a tenancy agreement governs
          rent, deposits or refunds for your unit, that agreement governs the money side.
        </p>
        <p>
          We may update these terms at any time by posting a revised version with a new &ldquo;last updated&rdquo;
          date — you will not receive a separate notice of each change. Continuing to use the system after a change
          means you accept the revised terms. The system is intended for people aged 18 or over, and for use in
          connection with the property it manages.
        </p>
      </Section>
      <Section heading="2. Accounts and eligibility">
        <p>
          Staff accounts are requested publicly but created and activated by an administrator; tenant portal access
          is issued from the tenancy recorded on file, using the email the operator holds. By using the system you
          confirm that: you are at least 18 and legally able to agree to these terms; the information you give is
          true, current and complete; you will not sign in through automated means such as bots or scripts; and you
          will use the system only for lawful purposes, in line with these terms.
        </p>
        <p>
          You are responsible for your credentials and for everything done through your account. Keep your password
          confidential, never use another person&rsquo;s account, and tell us promptly if you suspect unauthorised
          use. If information you provided turns out to be untrue or incomplete, we may suspend or end your access
          and refuse future use.
        </p>
      </Section>
      <Section heading="3. Intellectual property">
        <p>
          The system — including its source code, design, features, text, graphics and the {branding.appName} name
          and marks — is owned by the operator or licensed to it, and is protected by copyright and other
          intellectual property laws. You are granted a limited, revocable licence to use the system for its
          intended purpose: managing the property as staff, or viewing and paying your own account as a tenant.
        </p>
        <p>
          Except as that licence or applicable law allows, you may not copy, modify, distribute, sell, publicly
          display, decompile or reverse engineer any part of the system, or use its content or data for any
          commercial purpose without written permission.
        </p>
      </Section>
      <Section heading="4. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>use, or let anyone else use, an account that is not yours, or sign in under a false identity;</li>
          <li>access records that are not yours — another tenant&rsquo;s data, other users&rsquo; details, or staff-only information;</li>
          <li>enter or alter data you are not authorised to store;</li>
          <li>interfere with payment flows — manipulating, faking or replaying M-Pesa confirmations, or attempting to post payments outside the recorded channels;</li>
          <li>probe, scan or test the security of the system, or try to bypass its access controls, without written permission;</li>
          <li>harvest data at scale, scrape the system, or build a directory or database from its contents;</li>
          <li>upload malware, or anything that disrupts, overloads or impairs the system;</li>
          <li>harass, threaten or abuse other users, tenants or our staff;</li>
          <li>use the system for any unlawful purpose, or in any way that violates the Kenya Data Protection Act, 2019 or any other applicable law.</li>
        </ul>
        <p>Breaking these rules may mean your access is suspended or ended, and we may take any further action the law allows.</p>
      </Section>
      <Section heading="5. Records and content you enter">
        <p>
          The system is a working ledger, not a public forum. You are responsible for the accuracy of the rent
          payments, meter readings, expenses, tenant details and any other records you enter or confirm. Every
          change to a financial record is written to an audit trail, and deleting a rent payment deliberately
          preserves the original receipt for history.
        </p>
        <p>
          You keep ownership of the records and documents you enter; you give the operator permission to store,
          process and use them to run the property. If you send suggestions or feedback about the system, we may use
          and share them freely, without compensation or obligation.
        </p>
      </Section>
      <Section heading="6. Payments">
        <p>
          Paying rent from the tenant portal sends an M-Pesa request to the operator&rsquo;s own account. A payment
          is only considered made once M-Pesa confirms it and it is posted to the ledger, at which point a numbered
          receipt is issued. A request you cancel, let expire or never complete is never charged.
        </p>
        <p>
          Your obligation to pay rent, and everything about deposits and refunds, comes from your tenancy agreement
          and the <Link to="/refunds">Refund Policy</Link> — these terms govern the software, not the tenancy. If a
          payment does not appear on your ledger after M-Pesa confirmed it, contact us with the confirmation code.
        </p>
      </Section>
      <Section heading="7. Availability and changes">
        <p>
          We aim to keep the system available, but we cannot guarantee uninterrupted access. Maintenance,
          third-party services (hosting, M-Pesa, SMS and email providers) and events beyond our control can
          interrupt it. We may add, change, suspend or remove features at any time.
        </p>
        <p>
          Figures, summaries and reports produced by the system are management aids, not audited accounts. Verify
          anything you rely on against source receipts and statements before using it formally.
        </p>
      </Section>
      <Section heading="8. Suspension and termination">
        <p>
          These terms apply while you use the system. An administrator may suspend or deactivate any account at any
          time — for breach of these terms, misuse, or housekeeping such as closing a portal account when a tenancy
          ends. We may also block access from addresses or devices that abuse the system.
        </p>
        <p>
          If your access is ended for breach, you may not re-register under the same or another identity without our
          permission. The sections covering intellectual property, acceptable use, liability and governing law
          survive the end of your access.
        </p>
      </Section>
      <Section heading="9. Corrections">
        <p>
          Figures, readings, tariffs and other information in the system may contain errors, and we may correct
          them at any time. A recorded error — a mistyped reading, a duplicated payment, a wrong amount — is fixed
          on the ledger, with the correction visible in the records. Report anything that looks wrong through the
          contacts below.
        </p>
      </Section>
      <Section heading="10. Disclaimers">
        <p>
          THE SYSTEM IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;. TO THE FULLEST EXTENT THE LAW
          ALLOWS, THE OPERATOR DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED — INCLUDING MERCHANTABILITY, FITNESS
          FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT — AND DOES NOT WARRANT THAT THE SYSTEM WILL BE
          UNINTERRUPTED, ERROR-FREE OR COMPLETELY SECURE.
        </p>
      </Section>
      <Section heading="11. Limitation of liability">
        <p>
          TO THE FULLEST EXTENT THE LAW ALLOWS, THE OPERATOR IS NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL OR
          CONSEQUENTIAL DAMAGES — LOST PROFITS, LOST DATA OR LOST RENT, FOR EXAMPLE — ARISING FROM YOUR USE OF THE
          SYSTEM. Our total liability for any claim is limited to the amounts you paid us for use of the system in
          the three months before the claim arose, or KSh 10,000 if you paid nothing. Nothing in these terms limits
          liability that cannot lawfully be limited.
        </p>
      </Section>
      <Section heading="12. Indemnification">
        <p>
          You agree to compensate the operator, its owners and staff for any loss, claim or expense (including
          reasonable legal fees) they suffer because of your use of the system, your breach of these terms, or your
          breach of another person&rsquo;s rights.
        </p>
      </Section>
      <Section heading="13. Governing law and disputes">
        <p>
          These terms are governed by the laws of <strong>{law}</strong>. If a dispute arises, tell us first — most
          problems are solved by looking at the ledger together. Where that does not resolve it, the courts of{' '}
          <strong>{law}</strong> have exclusive jurisdiction.
        </p>
      </Section>
      <Section heading="14. Electronic communications">
        <p>
          Visiting the site, signing in, and the emails, SMS and portal notices the system sends are electronic
          communications, and you accept them as satisfying any legal requirement to be in writing. Electronic
          signatures and records — including M-Pesa confirmations and the numbered receipts the system issues — are
          as valid as paper originals.
        </p>
      </Section>
      <Section heading="15. Data protection">
        <p>
          Personal data is handled under the <Link to="/privacy">Privacy Policy</Link>, which forms part of these
          terms. It sets out what we collect, why, how long we keep it, and how to ask for a copy, a correction or
          deletion.
        </p>
      </Section>
      <Section heading="16. Miscellaneous">
        <p>
          These terms, the Privacy Policy and the tenancy agreements and policies they reference make up the whole
          agreement between you and the operator about the system. If a court finds any provision unenforceable, the
          rest stands. Failing to enforce a provision is not a waiver of it. We may assign our rights and
          obligations to a successor operating the property. Neither these terms nor your use of the system creates
          a partnership, employment or agency relationship between us, and neither party is liable for delays
          caused by events beyond its reasonable control.
        </p>
      </Section>
      <Section heading="17. Contact us">
        <p>For a complaint, a correction, or anything else about these terms, reach the operator:</p>
        <ul className="list-disc space-y-1 pl-5">
          {identity?.contactPhone && (<li>Phone: <Phone phone={identity.contactPhone} /></li>)}
          {identity?.contactEmail && (<li>Email: <Email email={identity.contactEmail} /></li>)}
          {!identity?.contactPhone && !identity?.contactEmail && (
            <li>Through the contact links on the <Link to="/landing#demo">landing page</Link>.</li>
          )}
        </ul>
        <p>We usually reply the same day.</p>
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
          <li><strong>Sign-in session cookies (required):</strong> after you sign in — as staff or as a tenant — a secure HttpOnly cookie keeps that session signed in. Signing out removes it.</li>
          <li><strong>Request-protection cookies (required):</strong> a matching token cookie for each session, read by the app itself to validate that changes you make genuinely come from the app (cross-site request forgery protection). It holds no personal data.</li>
          <li><strong>Preferences in local storage:</strong> your light/dark theme choice, and whether you have dismissed the storage notice and identity banners.</li>
          <li><strong>Update flags (session storage):</strong> transient markers the app uses once after a new deployment, so a stale page can refresh itself cleanly. They are cleared when you close the tab.</li>
        </ul>
        <p>These are functional, not behavioural: they exist only to make sign-in and payments work and remember your choices on this device.</p>
      </Section>
      <Section heading="Clearing stored data">
        <p>
          Signing out removes your session and request-protection cookies. You can also clear site data at any time
          through your browser&rsquo;s settings (&ldquo;Clear browsing data&rdquo; &rarr; &ldquo;Cookies and other
          site data&rdquo;). The next visit will simply ask you to sign in again and reset your theme preference.
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
          <strong>{identity?.paymentChannels ?? 'the payment channels stated on your receipts'}</strong> — including
          M-Pesa payments initiated from the tenant portal.
        </p>
      </Section>
      <Section heading="Rent overpayments">
        <p>
          If a tenant pays more than the amount due, the surplus is first credited against future months on the
          tenant&rsquo;s ledger. A cash refund of the surplus can be requested and is made through the original payment
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
            method. Verified errors are reversed promptly and a corrected receipt issued. Where possible the refund
            is made to the original payment method — for an M-Pesa payment, to the number that paid.
          </p>
        </Section>
      )}
      <Section heading="Failed M-Pesa requests">
        <p>
          A payment request sent to your phone that you do not complete, cancel, or that expires is never charged.
          If money left your M-Pesa account but no receipt appears in your portal, contact us with the M-Pesa
          confirmation code and the payment will be traced and either posted to your ledger or returned.
        </p>
      </Section>
    </LegalShell>
  );
}
