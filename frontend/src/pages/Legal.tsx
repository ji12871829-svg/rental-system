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

function Section({ heading, id, children }: { heading: string; id?: string; children: ReactNode }) {
  return (
    <section>
      <h2 id={id} className="text-base font-semibold text-gray-900 scroll-mt-6">{heading}</h2>
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

// One contact-block shape for every legal page — bold legal name, postal
// address, phone and email as they exist in the branding record, or a
// fallback to the landing page's contact links when nothing is filled.
// Shared so the four pages cannot drift into different contact shapes.
function OperatorContact({ privacyEmail }: { privacyEmail?: string | null }) {
  const { identity } = useBranding();
  const email = privacyEmail ?? identity?.contactEmail ?? null;
  return (
    <ul className="list-disc space-y-1 pl-5">
      {identity?.legalName && <li><strong>{identity.legalName}</strong></li>}
      {identity?.address && <li>{identity.address}</li>}
      {identity?.contactPhone && (<li>Phone: <Phone phone={identity.contactPhone} /></li>)}
      {email && (<li>Email: <Email email={email} /></li>)}
      {!identity?.contactPhone && !email && (
        <li>Through the contact links on the <Link to="/landing#demo">landing page</Link>.</li>
      )}
    </ul>
  );
}

// -------------------------------------------------------------------- Privacy
// Structured like a standard privacy notice — what we collect, why, sharing,
// cookies, retention, security, minors, rights, updates, contact, review —
// but stating only what this system truly does: no trackers, no ad tech, no
// social logins, and M-Pesa payments the operator never sees card data for.
// Operator identity, retention periods and response times come from the live
// business_branding record.
const PRIVACY_TOC: { id: string; title: string }[] = [
  { id: 'privacy-collect', title: 'What information we collect' },
  { id: 'privacy-use', title: 'How we use your information' },
  { id: 'privacy-share', title: 'Will your information be shared?' },
  { id: 'privacy-cookies', title: 'Cookies and tracking technologies' },
  { id: 'privacy-social', title: 'Social logins' },
  { id: 'privacy-retention', title: 'How long we keep your information' },
  { id: 'privacy-security', title: 'How we keep your information safe' },
  { id: 'privacy-minors', title: 'Information from minors' },
  { id: 'privacy-rights', title: 'Your privacy rights' },
  { id: 'privacy-dnt', title: 'Do-Not-Track signals' },
  { id: 'privacy-updates', title: 'Updates to this notice' },
  { id: 'privacy-contact', title: 'Contacting us about this notice' },
  { id: 'privacy-review', title: 'Reviewing, updating or deleting your data' },
];

export function Privacy() {
  const { identity } = useBranding();
  const privacyEmail = identity?.privacyEmail ?? identity?.contactEmail ?? null;
  return (
    <LegalShell title="Privacy Policy">
      <p>
        Thank you for trusting <strong>{identity?.legalName ?? branding.appNameLong}</strong>
        {identity?.registrationNumber && (<> (registration no. <strong>{identity.registrationNumber}</strong>)</>) }
        {identity?.address && (<> , of <strong>{identity.address}</strong></>) }
        , the operator of {branding.appName} ({branding.appNameFull}). We are committed to protecting your personal
        information and your right to privacy.
      </p>
      <p>
        This privacy notice describes how we collect and use your information when you visit the site, request a
        demo, sign in as staff, or use the tenant portal (together, the &ldquo;services&rdquo;). It explains, in the
        clearest way we can, what information we collect, how we use it, and what rights you have in relation to it.
        <strong> Please read it carefully</strong> — if there is anything here you do not agree with, please stop
        using the services. This notice works alongside the <Link to="/terms">Terms &amp; Conditions</Link>.
      </p>
      <nav aria-label="Table of contents" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contents</p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm sm:columns-2 sm:gap-6">
          {PRIVACY_TOC.map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline">
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <Section heading="1. What information we collect" id="privacy-collect">
        <p>We collect personal information you give us — directly, through sign-in, the tenant record the office keeps, or a form on this site. It includes:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Staff accounts:</strong> name, email, phone number, and a password stored only as a cryptographic hash. Staff accounts are requested publicly but created and activated by an administrator.</li>
          <li><strong>Tenant records:</strong> full name, phone number, email (optional), move-in/move-out dates, security deposit, unit assignment, and notes.</li>
          <li><strong>Tenant portal accounts:</strong> the tenant&rsquo;s email and a password stored only as a cryptographic hash, used to sign in to the self-service portal.</li>
          <li><strong>Property &amp; financial records:</strong> units, rent payments, water meter readings and bills, water purchase costs, expenses, receipts, and a log of SMS notifications sent to tenants.</li>
          <li><strong>Enquiries:</strong> if you request a demo or contact us through the public site, the name, email, phone number and property details you submit.</li>
          <li><strong>Audit trail:</strong> which user created, changed, or deleted a record, and when.</li>
        </ul>
        <p>
          <strong>We never collect card numbers or M-Pesa credentials.</strong> Rent paid through M-Pesa is
          processed by Safaricom straight to the operator&rsquo;s own account; the system records only the payment
          result and reference. All information you provide must be true, complete and accurate, and you should
          tell us when it changes.
        </p>
      </Section>
      <Section heading="2. How we use your information" id="privacy-use">
        <p>We use your information to run the property and deliver the services — on the grounds of performing our agreement with you, our legitimate business interests, our legal obligations, and your consent where required:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Property administration:</strong> collecting rent, billing water from metered readings, issuing numbered receipts, tracking arrears and expenses, and keeping the financial records required for accounting and tax purposes.</li>
          <li><strong>Delivering the services:</strong> giving staff the tools to manage units and records, and giving tenants self-service access to their own balance, payments, water bills, statements and M-Pesa payments.</li>
          <li><strong>Account management:</strong> creating, securing and administering staff and portal accounts, verifying sign-ins, and keeping sessions working.</li>
          <li><strong>Administrative communications:</strong> sending receipts, statements, and service notices by SMS or email — messages that are necessary for your tenancy or account, not marketing blasts.</li>
          <li><strong>Safety and fraud prevention:</strong> keeping the system secure, monitoring misuse, and maintaining the audit trail.</li>
          <li><strong>Responding to you:</strong> answering enquiries, demo requests and support questions.</li>
          <li><strong>Complying with legal obligations:</strong> retaining records as the law requires and responding to lawful requests.</li>
        </ul>
        <p>
          Tenant contact details are stored with the tenant&rsquo;s consent, confirmed through the consent checkbox
          on the tenant record form. We do <strong>not</strong> sell your data, run advertising, build behavioural
          profiles, or send promotional campaigns. If you asked for a demo, we may follow up on that enquiry; you
          can ask us to stop at any time.
        </p>
      </Section>
      <Section heading="3. Will your information be shared?" id="privacy-share">
        <p>
          <strong>We do not sell or rent your personal information — ever.</strong> We share it only in these
          situations:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Service providers we rely on:</strong> SMS delivery through <strong>{branding.smsProviderName}</strong> when SMS is configured, the operator&rsquo;s chosen email delivery service, and our hosting provider — each processing data only on the operator&rsquo;s behalf, to run the services.</li>
          <li><strong>Payments:</strong> M-Pesa payments are processed by Safaricom to the operator&rsquo;s own account; the payment result is recorded in the ledger.</li>
          <li><strong>Legal obligations:</strong> where disclosure is required by law, a court order, or a lawful request from an authority (including under the Kenya Data Protection Act, 2019).</li>
          <li><strong>Protection of rights:</strong> to investigate or prevent fraud, misuse, or threats to any person&rsquo;s safety.</li>
          <li><strong>Business transfers:</strong> if the property or the business operating it is sold or transferred, tenant records may pass to the successor, who must honour this notice.</li>
        </ul>
      </Section>
      <Section heading="4. Cookies and tracking technologies" id="privacy-cookies">
        <p>
          The services use no advertising cookies, analytics services, social-media pixels or third-party tracking
          of any kind. The only things stored in your browser are strictly functional: your sign-in session, request
          protection against cross-site forgery, and your interface preferences. Exactly what is stored, and how to
          clear it, is set out in the <Link to="/cookies">Cookie &amp; Storage Policy</Link>.
        </p>
      </Section>
      <Section heading="5. Social logins" id="privacy-social">
        <p>
          The services have no social logins. You cannot — and need not — sign in with Facebook, Google or any
          other third-party account. Access works only through accounts issued or activated by the operator, using
          an email address and password. We therefore receive no profile data from social media providers.
        </p>
      </Section>
      <Section heading="6. How long we keep your information" id="privacy-retention">
        <p>
          Records for an active tenancy are kept while the tenant resides at the property. Financial records are
          retained for <strong>{identity?.retentionPeriod ?? 'the period required'}</strong>, as required for
          accounting and tax purposes. A portal access account is deactivated when a tenancy ends. Enquiries are
          kept only as long as needed to respond and follow up.
        </p>
        <p>
          When we have no ongoing need to process your personal information — and no legal obligation to keep it —
          we delete or anonymise it. Where financial records must be retained, an erasure request removes your
          personal identifiers (name, phone, email, notes, message history) while the records are preserved without
          them. Data recently deleted may persist briefly in routine backup archives until those backups cycle.
        </p>
      </Section>
      <Section heading="7. How we keep your information safe" id="privacy-security">
        <p>
          We apply technical and organisational measures to protect your information: passwords are hashed (never
          stored in plain text), access is limited by role (admin / manager / staff), and every change to a
          financial record is written to an audit log. Tenant portal accounts see only their own unit, balance,
          payments, water readings and statements — never other tenants&rsquo; data, staff records, expenses or
          reports. Sessions are kept in secure HttpOnly cookies with cross-site request forgery protection, and the
          database is accessible only to the operator.
        </p>
        <p>
          No electronic transmission or storage is ever 100% secure; despite our safeguards, we cannot guarantee
          that unauthorised parties will never defeat our measures. Access the services only in a secure
          environment, and tell us promptly if you suspect anything is wrong.
        </p>
      </Section>
      <Section heading="8. Information from minors" id="privacy-minors">
        <p>
          The services are not directed at children, and we do not knowingly collect data from anyone under 18
          years of age. By using the services you confirm you are at least 18. If we learn that personal information
          from a person under 18 has been collected, we will deactivate the account and take reasonable measures to
          delete the data promptly. If you believe a minor&rsquo;s data may have reached us, contact us using the
          details in section 12.
        </p>
      </Section>
      <Section heading="9. Your privacy rights" id="privacy-rights">
        <p>
          This notice is prepared with the <strong>Kenya Data Protection Act, 2019</strong> in mind. Subject to that
          law, you may: request <strong>access</strong> to the personal data we hold about you and a copy of it;
          request <strong>correction</strong> of inaccurate data; request <strong>erasure</strong> of data we are
          not legally required to keep; <strong>object</strong> to processing, or ask that it be restricted;
          request your data in a portable, machine-readable format; and <strong>withdraw consent</strong> where
          processing rests on consent — without affecting the lawfulness of processing already carried out. Where
          the GDPR or another law applies to you, equivalent rights are honoured.
        </p>
        <p>
          To exercise any right, write to us using the contacts in section 12. We respond within{' '}
          <strong>{identity?.responseDays ?? '30'} days</strong> after verifying who you are — a step we take to
          make sure we never release or erase someone&rsquo;s data at a stranger&rsquo;s request. If you are not
          satisfied with how we handle your data, you may complain to the Office of the Data Protection Commissioner
          in Kenya. We will never treat you differently for exercising your rights.
        </p>
      </Section>
      <Section heading="10. Do-Not-Track signals" id="privacy-dnt">
        <p>
          Some browsers offer a Do-Not-Track (&ldquo;DNT&rdquo;) signal. Because the services contain no tracking
          technologies to begin with — no analytics, no advertising, no cross-site tracking — there is nothing for
          DNT to switch off. If a tracking standard we would have to honour is ever adopted, we will say so in an
          updated version of this notice.
        </p>
      </Section>
      <Section heading="11. Updates to this notice" id="privacy-updates">
        <p>
          We may update this privacy notice from time to time, for example when the services change or the law
          requires it. The updated version takes effect as soon as it is posted, and the &ldquo;last updated&rdquo;
          date at the top of this page tells you when it was last revised. Material changes may also be announced
          in the app or by message. We encourage you to review this notice whenever you use the services.
        </p>
      </Section>
      <Section heading="12. Contacting us about this notice" id="privacy-contact">
        <p>
          If you have questions or comments about this notice or our handling of your personal information, contact
          the operator:
        </p>
        <OperatorContact privacyEmail={privacyEmail} />
        <p>We usually reply the same day.</p>
      </Section>
      <Section heading="13. Reviewing, updating or deleting your data" id="privacy-review">
        <p>
          You may request a copy of the personal data we hold about you, ask us to correct it, or ask us to delete
          what we are not legally required to keep, by writing to us using the contacts in section 12. A copy of
          your data is provided as a machine-readable (JSON) file. As a tenant, you can also see — and correct the
          essentials of — your own information any time in the portal: your balance, payment history, water
          readings, receipts and statements.
        </p>
        <p>
          Where financial records must be retained for accounting and tax purposes, an erasure request removes your
          personal identifiers while those records are preserved without them. We may retain limited information
          where needed to prevent fraud, resolve disputes, enforce our terms, or comply with the law.
        </p>
      </Section>
    </LegalShell>
  );
}

// --------------------------------------------------------------------- Terms
// Full terms-of-use structure — the same arc a standard terms page follows
// (agreement, eligibility, IP, prohibited activities, contributions and
// licences, site management, privacy, termination, availability, law and
// dispute resolution, corrections, disclaimers, liability, indemnity, user
// data, electronic communications, miscellaneous, contact) — written for
// what this system actually is: an internal property-management ledger with
// a self-service tenant portal and M-Pesa payments. Operator identity comes
// from the live business_branding record; sibling policies are linked, not
// duplicated.
const TERMS_TOC: { id: string; title: string }[] = [
  { id: 'terms-agreement', title: 'Agreement to these terms' },
  { id: 'terms-accounts', title: 'Accounts and eligibility' },
  { id: 'terms-ip', title: 'Intellectual property' },
  { id: 'terms-prohibited', title: 'Prohibited activities' },
  { id: 'terms-records', title: 'Records and content you enter' },
  { id: 'terms-licence', title: 'Licence to your records and feedback' },
  { id: 'terms-management', title: 'How we manage the system' },
  { id: 'terms-payments', title: 'Payments' },
  { id: 'terms-privacy', title: 'Privacy and data protection' },
  { id: 'terms-termination', title: 'Term and termination' },
  { id: 'terms-availability', title: 'Modifications and interruptions' },
  { id: 'terms-law', title: 'Governing law' },
  { id: 'terms-disputes', title: 'Resolving disputes' },
  { id: 'terms-corrections', title: 'Corrections' },
  { id: 'terms-disclaimers', title: 'Disclaimer' },
  { id: 'terms-liability', title: 'Limitations of liability' },
  { id: 'terms-indemnity', title: 'Indemnification' },
  { id: 'terms-backups', title: 'Backups and your data' },
  { id: 'terms-electronic', title: 'Electronic communications and signatures' },
  { id: 'terms-misc', title: 'Miscellaneous' },
  { id: 'terms-contact', title: 'Contact us' },
];

export function Terms() {
  const { identity } = useBranding();
  const law = identity?.jurisdiction ?? 'Kenya';
  return (
    <LegalShell title="Terms & Conditions">
      <nav aria-label="Table of contents" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contents</p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm sm:columns-2 sm:gap-6">
          {TERMS_TOC.map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline">
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <Section heading="1. Agreement to these terms" id="terms-agreement">
        <p>
          These Terms &amp; Conditions form a legally binding agreement between you — whether personally or for a
          business — and <strong>{identity?.legalName ?? branding.appNameLong}</strong>
          {identity?.registrationNumber && (<> (registration no. <strong>{identity.registrationNumber}</strong>)</>) }
          {identity?.address && (<> , of <strong>{identity.address}</strong></>) }
          , the operator of {branding.appName} ({branding.appNameFull}): this website, the staff management app and
          the tenant portal, together with any related pages or communications (collectively, the
          &ldquo;system&rdquo;).
        </p>
        <p>
          By visiting the site, signing in as staff, or using the tenant portal, you confirm that you have read,
          understood and accepted these terms. <strong>If you do not agree with all of them, you are not allowed
          to use the system and must stop immediately.</strong> The <Link to="/privacy">Privacy Policy</Link>,{' '}
          <Link to="/cookies">Cookie &amp; Storage Policy</Link> and <Link to="/refunds">Refund Policy</Link> are
          posted on the site and form part of these terms. Any additional rules posted from time to time also apply.
          Where a tenancy agreement governs rent, deposits or refunds for your unit, that agreement governs the
          money side.
        </p>
        <p>
          We may change these terms at any time, for any reason, by posting a revised version with a new
          &ldquo;last updated&rdquo; date — you will not receive a separate notice of each change, and you agree
          that checking the terms whenever you use the system is on you. Continuing to use the system after revised
          terms are posted means you have accepted them. The system is not offered where doing so would break local
          law, and it is not tailored to regulated industries&rsquo; compliance regimes — it is a property-ledger
          tool, not financial, legal or tax advice.
        </p>
        <p>The system is intended for people aged 18 or over. Persons under 18 may not use or register for it.</p>
      </Section>
      <Section heading="2. Accounts and eligibility" id="terms-accounts">
        <p>
          By using the system you confirm that: you are at least 18 and legally able to agree to these terms; the
          information you give is true, accurate, current and complete; you will not sign in through automated or
          non-human means such as bots or scripts; and your use will not break any applicable law or regulation.
        </p>
        <p>
          Staff accounts are requested publicly but created and activated by an administrator; tenant portal access
          is issued from the tenancy recorded on file, using the email the operator holds. You are responsible for
          your credentials and for everything done through your account. Keep your password confidential, never use
          another person&rsquo;s account, and tell us promptly if you suspect unauthorised use.
        </p>
        <p>
          If information you provide turns out to be untrue, inaccurate, not current or incomplete, we may suspend
          or terminate your account and refuse any current or future use of the system.
        </p>
      </Section>
      <Section heading="3. Intellectual property" id="terms-ip">
        <p>
          Unless stated otherwise, the system is the operator&rsquo;s proprietary property: all source code,
          databases, functionality, software, designs, text, graphics and the {branding.appName} name and marks are
          owned or controlled by the operator or licensed to it, and are protected by copyright, trademark and other
          intellectual property laws.
        </p>
        <p>
          Provided you are eligible, you are granted a limited, revocable, non-exclusive licence to access and use
          the system for its intended purpose: managing the property as staff, or viewing and paying your own
          account as a tenant. Except as that licence or applicable law allows, no part of the system may be
          copied, reproduced, aggregated, republished, uploaded, posted, publicly displayed, encoded, translated,
          transmitted, distributed, sold, licensed or otherwise exploited for any commercial purpose without our
          express prior written permission. We reserve all rights not expressly granted to you.
        </p>
      </Section>
      <Section heading="4. Prohibited activities" id="terms-prohibited">
        <p>You may not use the system for any purpose other than the one we provide it for. In particular, you agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>systematically retrieve data or content to build a collection, compilation, database or directory without written permission;</li>
          <li>trick, defraud or mislead us or other users, especially to learn sensitive account information such as passwords;</li>
          <li>circumvent, disable or interfere with security-related features, or try to bypass any measure designed to prevent or restrict access;</li>
          <li>use, or let anyone else use, an account that is not yours, or sign in under a false identity;</li>
          <li>access records that are not yours — another tenant&rsquo;s data, other users&rsquo; details, or staff-only information — or enter or alter data you are not authorised to store;</li>
          <li>interfere with payment flows: manipulating, faking or replaying M-Pesa confirmations, or posting payments outside the recorded channels;</li>
          <li>disparage or harm the operator, its staff, or other users of the system;</li>
          <li>harass, abuse or harm any person using information obtained from the system;</li>
          <li>upload or transmit viruses, Trojan horses or similar harmful material, or anything that disrupts, overloads or impairs the system or the services connected to it;</li>
          <li>engage in automated use — scripts, data mining, robots, scrapers or similar extraction tools — beyond ordinary browser use;</li>
          <li>copy or adapt the system&rsquo;s software, or except as permitted by law, decipher, decompile, disassemble or reverse engineer any of it;</li>
          <li>delete or obscure any proprietary rights notice from the content;</li>
          <li>make unauthorised use of the system, including collecting other users&rsquo; emails or contact details for unsolicited messages;</li>
          <li>use the system to compete with the operator, or as part of any revenue-generating enterprise without written approval; or</li>
          <li>use the system in any manner that violates the Kenya Data Protection Act, 2019 or any other applicable law or regulation.</li>
        </ul>
        <p>Breaking these rules is a breach of these terms and may result in suspension or termination of your access, and any further action the law allows.</p>
      </Section>
      <Section heading="5. Records and content you enter" id="terms-records">
        <p>
          The system is a working ledger, not a public forum. You are responsible for the accuracy of the rent
          payments, meter readings, expenses, tenant details and any other records you enter or confirm. Every
          change to a financial record is written to an audit trail, and deleting a rent payment deliberately
          preserves the original receipt for history.
        </p>
        <p>When you enter records, submit details or make anything available through the system, you confirm that:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>the records do not infringe any third party&rsquo;s rights, including copyright, trademark or privacy;</li>
          <li>you have any consent, licence or permission needed to submit them;</li>
          <li>they are not false, inaccurate or misleading;</li>
          <li>they are not unlawful, harassing, defamatory or otherwise objectionable; and</li>
          <li>they do not violate these terms or any applicable law.</li>
        </ul>
      </Section>
      <Section heading="6. Licence to your records and feedback" id="terms-licence">
        <p>
          You keep ownership of the records and documents you enter. You grant the operator permission to access,
          store, process and use them — and any personal data they contain, under the Privacy Policy — as needed
          to run the property and operate the system. You remain solely responsible for what you enter, and agree
          to hold the operator harmless from claims about records you provided.
        </p>
        <p>
          If you send questions, comments, suggestions or feedback about the system, that feedback is
          non-confidential: we may use and share it for any purpose, without acknowledgment or compensation to you.
        </p>
      </Section>
      <Section heading="7. How we manage the system" id="terms-management">
        <p>We reserve the right, but not the obligation, to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>monitor the system for breaches of these terms;</li>
          <li>take appropriate action against anyone who breaks the law or these terms, including reporting to law enforcement;</li>
          <li>suspend, restrict or end any account or access that misuses the system;</li>
          <li>correct, remove or disable records or content that is erroneous, unauthorised or burdensome to the system; and</li>
          <li>otherwise manage the system to protect our rights and property and keep it working properly.</li>
        </ul>
      </Section>
      <Section heading="8. Payments" id="terms-payments">
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
      <Section heading="9. Privacy and data protection" id="terms-privacy">
        <p>
          We care about data privacy and security. Personal data is handled under the{' '}
          <Link to="/privacy">Privacy Policy</Link>, which is incorporated into these terms: it sets out what we
          collect, why, how long we keep it, and how to ask for a copy, a correction or deletion. The system sends
          no data to advertising or tracking services; messages go through the operator&rsquo;s own SMS and email
          providers, and M-Pesa payments are processed by Safaricom to the operator&rsquo;s account. The site is
          prepared with the Kenya Data Protection Act, 2019 in mind; where another data protection law applies to
          you, equivalent rights are honoured.
        </p>
      </Section>
      <Section heading="10. Term and termination" id="terms-termination">
        <p>
          These terms remain in force while you use the system. <strong>We reserve the right, in our sole
          discretion and without notice or liability, to deny access to the system — including blocking certain IP
          addresses — to any person for any reason or no reason, including breach of these terms or of any
          applicable law.</strong> An administrator may suspend or deactivate any account at any time: for breach,
          misuse, or housekeeping such as closing a portal account when a tenancy ends.
        </p>
        <p>
          If your access is terminated or suspended, you may not register or create a new account under the same or
          another identity without our permission, and we reserve the right to take appropriate legal action. The
          sections covering intellectual property, prohibited activities, liability and governing law survive the
          end of your access.
        </p>
      </Section>
      <Section heading="11. Modifications and interruptions" id="terms-availability">
        <p>
          We may change, modify, remove, suspend or discontinue any part of the system — or its features or
          pricing — at any time, for any reason, without notice, and we have no obligation to update any
          information in it. We will not be liable to you or any third party for any modification, suspension or
          discontinuance.
        </p>
        <p>
          We cannot guarantee the system will be available at all times: maintenance, hardware or software
          problems, and third-party services (hosting, M-Pesa, SMS and email providers) can cause interruptions,
          delays or errors. You agree that we have no liability for any loss, damage or inconvenience caused by
          your inability to access or use the system during downtime. Nothing in these terms obliges us to maintain
          and support the system or to supply corrections, updates or releases.
        </p>
        <p>
          Figures, summaries and reports produced by the system are management aids, not audited accounts. Verify
          anything you rely on against source receipts and statements before using it formally.
        </p>
      </Section>
      <Section heading="12. Governing law" id="terms-law">
        <p>
          These terms are governed by and defined following the laws of <strong>{law}</strong>. The operator and
          you irrevocably consent that the courts of <strong>{law}</strong> have exclusive jurisdiction to resolve
          any dispute which may arise in connection with these terms, subject to section 13.
        </p>
      </Section>
      <Section heading="13. Resolving disputes" id="terms-disputes">
        <p>
          <strong>Talk to us first.</strong> If a dispute arises out of these terms, tell us through the contacts
          in section 21 — most problems are solved by looking at the ledger together, and we will try to resolve
          any disagreement informally and in good faith.
        </p>
        <p>
          <strong>Arbitration.</strong> Where informal resolution does not work, any dispute arising out of or in
          connection with these terms — including any question regarding their existence, validity or termination —
          may be referred to and finally resolved by arbitration in <strong>{law}</strong>, seated in Nairobi,
          conducted in English, under the applicable arbitration rules and the Arbitration Act of Kenya. Each party
          bears its own costs unless the arbitrator decides otherwise.
        </p>
        <p>
          <strong>Limitations.</strong> Any dispute is limited to the dispute between you and the operator
          individually: to the fullest extent the law allows, disputes may not be joined with any other proceeding,
          brought on a class basis, or brought in a representative capacity on behalf of the public. Nothing here
          stops either party from seeking urgent injunctive relief from a court, and where a provision of this
          section is found unenforceable, that part falls away and the rest — including the courts&rsquo;
          jurisdiction under section 12 — applies.
        </p>
      </Section>
      <Section heading="14. Corrections" id="terms-corrections">
        <p>
          Figures, readings, tariffs and other information in the system may contain typographical errors,
          inaccuracies or omissions, and we may correct any of them, and change or update information, at any time
          without prior notice. A recorded error — a mistyped reading, a duplicated payment, a wrong amount — is
          fixed on the ledger, with the correction visible in the records. Report anything that looks wrong
          through the contacts in section 21.
        </p>
      </Section>
      <Section heading="15. Disclaimer" id="terms-disclaimers">
        <p>
          THE SYSTEM IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;. TO THE FULLEST EXTENT THE LAW
          ALLOWS, THE OPERATOR DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED — INCLUDING MERCHANTABILITY, FITNESS
          FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT — AND DOES NOT WARRANT THAT THE SYSTEM WILL BE
          UNINTERRUPTED, ERROR-FREE OR COMPLETELY SECURE.
        </p>
      </Section>
      <Section heading="16. Limitations of liability" id="terms-liability">
        <p>
          IN NO EVENT WILL WE OR OUR OWNERS, DIRECTORS, EMPLOYEES OR AGENTS BE LIABLE TO YOU OR ANY THIRD PARTY FOR
          ANY DIRECT, INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL OR PUNITIVE DAMAGES — INCLUDING LOST
          PROFIT, LOST REVENUE, LOST RENT OR LOSS OF DATA — ARISING FROM YOUR USE OF THE SYSTEM, EVEN IF WE HAVE
          BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          NOTWITHSTANDING ANYTHING TO THE CONTRARY, OUR TOTAL LIABILITY TO YOU FOR ANY CAUSE WHATSOEVER, AND
          REGARDLESS OF THE FORM OF THE ACTION, WILL AT ALL TIMES BE LIMITED TO THE AMOUNTS YOU PAID US FOR USE OF
          THE SYSTEM DURING THE THREE (3) MONTHS BEFORE THE CAUSE OF ACTION AROSE — OR, IF YOU PAID NOTHING FOR THE
          SYSTEM ITSELF, KSH 10,000. NOTHING IN THESE TERMS LIMITS LIABILITY THAT CANNOT LAWFULLY BE LIMITED.
        </p>
      </Section>
      <Section heading="17. Indemnification" id="terms-indemnity">
        <p>
          You agree to compensate the operator, its owners and staff for any loss, claim or expense (including
          reasonable legal fees) they suffer because of your use of the system, your breach of these terms, or your
          breach of another person&rsquo;s rights.
        </p>
      </Section>
      <Section heading="18. Backups and your data" id="terms-backups">
        <p>
          We maintain the records you transmit to the system for the purpose of running the property, along with
          data relating to your use of it. The database is backed up routinely, but you remain responsible for any
          data you enter or activities you carry out through the system — keep your own copies of anything you
          cannot afford to lose (for example, payment confirmations you receive outside the system).
        </p>
        <p>
          We are not liable to you for loss or corruption of data you transmit, and you waive any claim against us
          arising from such loss or corruption, except where the law does not allow that limitation.
        </p>
      </Section>
      <Section heading="19. Electronic communications and signatures" id="terms-electronic">
        <p>
          Visiting the site, signing in, and the emails, SMS and portal notices the system sends are electronic
          communications, and you accept them as satisfying any legal requirement to be in writing. Electronic
          signatures and records — including M-Pesa confirmations and the numbered receipts the system issues — are
          as valid as paper originals.
        </p>
      </Section>
      <Section heading="20. Miscellaneous" id="terms-misc">
        <p>
          These terms, the Privacy Policy and the tenancy agreements and policies they reference make up the whole
          agreement between you and the operator about the system. If a court finds any provision unenforceable, the
          rest stands. Failing to enforce a provision is not a waiver of it. We may assign our rights and
          obligations to a successor operating the property. Neither these terms nor your use of the system creates
          a partnership, employment or agency relationship between us, and neither party is liable for delays
          caused by events beyond its reasonable control.
        </p>
      </Section>
      <Section heading="21. Contact us" id="terms-contact">
        <p>
          To resolve a complaint about the system, or to receive further information about these terms, contact the
          operator:
        </p>
        <OperatorContact />
        <p>We usually reply the same day.</p>
      </Section>
    </LegalShell>
  );
}

// -------------------------------------------------------- Cookies & storage
// The same numbered, contents-first structure as the other legal pages,
// applied to the narrowest policy of the four: what sits in your browser,
// why, for how long, and how to clear it.
const COOKIES_TOC: { id: string; title: string }[] = [
  { id: 'cookies-scope', title: 'What this policy covers' },
  { id: 'cookies-tracking', title: 'No tracking' },
  { id: 'cookies-session', title: 'Sign-in session cookies' },
  { id: 'cookies-csrf', title: 'Request-protection cookies' },
  { id: 'cookies-local', title: 'Preferences in local storage' },
  { id: 'cookies-sessionstorage', title: 'Update flags in session storage' },
  { id: 'cookies-never', title: 'What is never stored' },
  { id: 'cookies-lifetimes', title: 'How long each item lasts' },
  { id: 'cookies-clearing', title: 'Clearing stored data' },
  { id: 'cookies-contact', title: 'Updates and contact' },
];

export function Cookies() {
  return (
    <LegalShell title="Cookie & Storage Policy">
      <p>
        {branding.appName} stores a small amount of data in your browser so that sign-in works and your choices are
        remembered. This policy lists exactly what is stored, why, and for how long. For what we collect on the
        server and how it is used, see the <Link to="/privacy">Privacy Policy</Link>.
      </p>
      <nav aria-label="Table of contents" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contents</p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm sm:columns-2 sm:gap-6">
          {COOKIES_TOC.map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline">
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <Section heading="1. What this policy covers" id="cookies-scope">
        <p>
          This policy covers every cookie and browser-storage item the system writes on this device — for staff
          sign-in, the tenant portal, and the public pages. All of it is functional, not behavioural: it exists only
          to make sign-in and payments work and remember your choices on this device.
        </p>
      </Section>
      <Section heading="2. No tracking" id="cookies-tracking">
        <p>
          {branding.appName} does <strong>not</strong> use advertising cookies, analytics services, social-media
          pixels, or any third-party tracking. Nothing you do here is shared with advertisers or data brokers, and
          no other website can read what is stored here.
        </p>
      </Section>
      <Section heading="3. Sign-in session cookies" id="cookies-session">
        <p>
          After you sign in — as staff or as a tenant — a secure HttpOnly cookie keeps that session signed in. It
          cannot be read by scripts in the page, and signing out removes it. The staff app and the tenant portal
          each keep their own separate session, so being signed in to one does not sign you in to the other.
        </p>
      </Section>
      <Section heading="4. Request-protection cookies" id="cookies-csrf">
        <p>
          A matching token cookie is set for each session and read by the app itself to validate that changes you
          make genuinely come from the app (cross-site request forgery protection). It holds no personal data.
        </p>
      </Section>
      <Section heading="5. Preferences in local storage" id="cookies-local">
        <p>
          Your light/dark theme choice, and whether you have dismissed the storage notice and identity banners, are
          kept in your browser&rsquo;s local storage so the app looks the way you left it on your next visit.
        </p>
      </Section>
      <Section heading="6. Update flags in session storage" id="cookies-sessionstorage">
        <p>
          Transient markers the app uses once after a new deployment, so a stale page can refresh itself cleanly.
          They are cleared when you close the tab.
        </p>
      </Section>
      <Section heading="7. What is never stored" id="cookies-never">
        <p>
          No advertising or analytics identifiers, no tracking beacons or pixels, no social widgets, no device
          fingerprinting, and no data about your activity on other sites. M-Pesa details are never stored in your
          browser — payments are processed by Safaricom to the operator&rsquo;s account.
        </p>
      </Section>
      <Section heading="8. How long each item lasts" id="cookies-lifetimes">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-gray-900">
                <th className="py-2 pr-3 font-semibold">Item</th>
                <th className="py-2 pr-3 font-semibold">Purpose</th>
                <th className="py-2 pr-3 font-semibold">Personal data?</th>
                <th className="py-2 font-semibold">Lifetime</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-3">Sign-in session cookie (HttpOnly)</td>
                <td className="py-2 pr-3">Keeps you signed in after sign-in</td>
                <td className="py-2 pr-3">A signed session reference only</td>
                <td className="py-2">Until you sign out, or the session expires</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-3">Request-protection cookie</td>
                <td className="py-2 pr-3">Confirms changes come from the app (CSRF protection)</td>
                <td className="py-2 pr-3">No</td>
                <td className="py-2">Same as the session it protects</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 pr-3">Local storage: preferences</td>
                <td className="py-2 pr-3">Remembers your theme and dismissed banners</td>
                <td className="py-2 pr-3">No</td>
                <td className="py-2">Until you clear site data</td>
              </tr>
              <tr>
                <td className="py-2 pr-3">Session storage: update flags</td>
                <td className="py-2 pr-3">Lets a stale page refresh cleanly after a deployment</td>
                <td className="py-2 pr-3">No</td>
                <td className="py-2">Until you close the tab</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
      <Section heading="9. Clearing stored data" id="cookies-clearing">
        <p>
          Signing out removes your session and request-protection cookies. You can also clear site data at any time
          through your browser&rsquo;s settings (&ldquo;Clear browsing data&rdquo; &rarr; &ldquo;Cookies and other
          site data&rdquo;). The next visit will simply ask you to sign in again and reset your theme preference.
        </p>
      </Section>
      <Section heading="10. Updates and contact" id="cookies-contact">
        <p>
          This policy may be updated when what the system stores changes; the &ldquo;last updated&rdquo; date at
          the top of this page shows the latest revision. Questions about anything stored on your device can go to
          the operator:
        </p>
        <OperatorContact />
        <p>We usually reply the same day.</p>
      </Section>
    </LegalShell>
  );
}

// -------------------------------------------------------------------- Refund
// Numbered like the other legal pages: what is covered, the principles every
// refund follows, each refundable case, what is not covered, and how to
// request one. Windows, channels and property scope come from the live
// business_branding record.
const REFUND_TOC: { id: string; title: string }[] = [
  { id: 'refund-scope', title: 'What this policy covers' },
  { id: 'refund-principles', title: 'How refunds work' },
  { id: 'refund-overpayments', title: 'Rent overpayments' },
  { id: 'refund-water', title: 'Water billing corrections' },
  { id: 'refund-deposits', title: 'Security deposits' },
  { id: 'refund-errors', title: 'Duplicate or erroneous payments' },
  { id: 'refund-mpesa', title: 'Failed or incomplete M-Pesa requests' },
  { id: 'refund-notcovered', title: 'What this policy does not cover' },
  { id: 'refund-request', title: 'How to request a refund' },
  { id: 'refund-contact', title: 'Questions and contact' },
];

export function Refund() {
  const { identity } = useBranding();
  return (
    <LegalShell title="Refund Policy">
      <p>
        This policy explains when and how money recorded in {branding.appName} is returned or corrected — covering
        rent payments, water billings, and deposits
        {identity?.propertyScope && (<> for <strong>{identity.propertyScope}</strong></>)}, paid via{' '}
        <strong>{identity?.paymentChannels ?? 'the payment channels stated on your receipts'}</strong>, including
        M-Pesa payments initiated from the tenant portal. It works alongside the{' '}
        <Link to="/terms">Terms &amp; Conditions</Link> and your tenancy agreement.
      </p>
      <nav aria-label="Table of contents" className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contents</p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm sm:columns-2 sm:gap-6">
          {REFUND_TOC.map(({ id, title }) => (
            <li key={id}>
              <a href={`#${id}`} className="text-brand-600 transition-colors duration-150 hover:text-brand-700 hover:underline">
                {title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <Section heading="1. What this policy covers" id="refund-scope">
        <p>
          Refunds and corrections for rent payments, water billings, and deposits recorded in the system
          {identity?.propertyScope && (<> for <strong>{identity.propertyScope}</strong></>)} — whether paid over the
          counter, through the tenant portal, or by M-Pesa. It applies to current and former tenants, and to anyone
          who made a payment on a tenant&rsquo;s behalf.
        </p>
      </Section>
      <Section heading="2. How refunds work" id="refund-principles">
        <p>Every refund or correction follows the same principles:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Verified first.</strong> We check the ledger, receipts and M-Pesa records before anything is returned.</li>
          <li><strong>Credit before cash.</strong> Where an amount can stand against future rent, it is credited to your ledger first; a cash refund is available on request.</li>
          <li><strong>Original method.</strong> Where possible, money goes back the way it came — an M-Pesa payment is refunded to the number that paid.</li>
          <li><strong>No fees.</strong> We do not charge for processing a refund or correction.</li>
          <li><strong>Visible in the records.</strong> Corrections land on the ledger, and a corrected or reversed receipt is issued.</li>
        </ul>
      </Section>
      <Section heading="3. Rent overpayments" id="refund-overpayments">
        <p>
          If a tenant pays more than the amount due, the surplus is first credited against future months on the
          tenant&rsquo;s ledger. A cash refund of the surplus can be requested and is made through the original payment
          method within <strong>{identity?.refundWindowDays ?? '7–14'} days</strong> of the request being verified.
        </p>
      </Section>
      <Section heading="4. Water billing corrections" id="refund-water">
        <p>
          Water is billed from metered readings. If a reading or tariff is recorded in error, the correction is
          applied to the next monthly statement, or refunded if the tenancy has ended. Meter readings can be
          re-verified on request.
        </p>
      </Section>
      <Section heading="5. Security deposits" id="refund-deposits">
        <p>
          Deposits are held and returned in line with the tenancy agreement and applicable law. Any deductions are
          itemised in writing at the end of the tenancy. This policy does not change what your tenancy agreement
          says about deposits — it only records that the return of a deposit, like every other payment, is tracked
          in the system.
        </p>
      </Section>
      <Section heading="6. Duplicate or erroneous payments" id="refund-errors">
        <p>
          If a payment is recorded twice or in the wrong amount, the verified error is reversed promptly and a
          corrected receipt issued. Where possible the refund is made to the original payment method — for an
          M-Pesa payment, to the number that paid. See section 9 for how to raise it.
        </p>
      </Section>
      <Section heading="7. Failed or incomplete M-Pesa requests" id="refund-mpesa">
        <p>
          A payment request sent to your phone that you do not complete, cancel, or that expires is never charged.
          If money left your M-Pesa account but no receipt appears in your portal, contact us with the M-Pesa
          confirmation code and the payment will be traced and either posted to your ledger or returned.
        </p>
      </Section>
      <Section heading="8. What this policy does not cover" id="refund-notcovered">
        <p>
          Rent properly due under your tenancy agreement is not a refund matter — a refund corrects an error or
          returns an overpayment; it is not a way to withhold charges that are correct. If you disagree with a
          charge, start with the contacts in section 10: we would rather check the ledger together than argue.
          Deposit deductions, rent disputes, and anything else governed by the tenancy agreement follow that
          agreement and applicable law.
        </p>
      </Section>
      <Section heading="9. How to request a refund" id="refund-request">
        <p>Contact the operator (section 10) with as many of these as you have:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>the unit number and tenant name;</li>
          <li>the receipt number, if one was issued;</li>
          <li>the amount, payment date, and method;</li>
          <li>the M-Pesa confirmation code, for M-Pesa payments.</li>
        </ul>
        <p>
          We verify the request against the ledger and the payment records, then confirm what will happen: a
          ledger credit, a refund to the original method, or a corrected receipt. If a request is refused, we
          explain why, with the records we relied on.
        </p>
      </Section>
      <Section heading="10. Questions and contact" id="refund-contact">
        <p>To raise a refund, correct a record, or ask about this policy, reach the operator:</p>
        <OperatorContact />
        <p>We usually reply the same day.</p>
      </Section>
    </LegalShell>
  );
}
