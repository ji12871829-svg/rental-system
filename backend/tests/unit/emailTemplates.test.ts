// Unit tests for the pure email compositions (utils/emailTemplates.ts).
// These run with no DB — the whole point of extracting composition from the
// Outbound Email module's lifecycle. Fixed identity keeps assertions stable.
import {
  composeCampaignEmail,
  composeDataLetterEmail,
  composeMonthlyReportEmail,
  composePortalCredentialsEmail,
  composeStatementEmail,
  composeTestEmail,
  composeUnmatchedPaymentEmail,
  composeStaleUnmatchedPaymentEmail,
  escapeHtml,
} from '../../src/utils/emailTemplates';

const identity = { name: 'Test Estates', regNo: 'REG-001' };

describe('emailTemplates', () => {
  describe('escapeHtml', () => {
    it('escapes markup-significant characters', () => {
      expect(escapeHtml(`<b>&"'</b>`)).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
    });
  });

  describe('composeUnmatchedPaymentEmail', () => {
    const base = {
      transactionId: 'SMK12345',
      amount: 3500,
      accountReference: 'NO-SUCH-UNIT',
      senderPhone: '0706719042' as string | null,
      payDate: '2026-09-23',
      payMonthLabel: 'September 2026',
      currency: 'KSh',
      reason: 'No active tenant matched unit reference NO-SUCH-UNIT.',
      identity,
    };

    it('renders UNMATCHED wording with the held-money framing', () => {
      const c = composeUnmatchedPaymentEmail({ ...base, status: 'UNMATCHED' });
      expect(c.subject).toContain('Unmatched M-Pesa payment');
      expect(c.subject).toContain('KSh 3,500');
      expect(c.text).toContain('Transaction: SMK12345');
      expect(c.text).toContain('KSh 3,500 (September 2026)');
      expect(c.text).toContain('Account reference: NO-SUCH-UNIT');
      expect(c.text).toContain('Sender phone: 0706719042');
      expect(c.text).toMatch(/held/i);
      expect(c.text).toContain('M-Pesa Review');
      expect(c.text).toContain('Test Estates · Reg. No. REG-001');
      expect(c.html).toContain('Unmatched M-Pesa payment');
    });

    it('renders AMBIGUOUS wording for multi-tenant matches', () => {
      const c = composeUnmatchedPaymentEmail({ ...base, status: 'AMBIGUOUS' });
      expect(c.subject).toContain('Ambiguous M-Pesa payment');
      expect(c.text).toMatch(/matched more than one tenant/i);
    });

    it('renders em-dashes for missing phone and omits the reason row when null', () => {
      const c = composeUnmatchedPaymentEmail({ ...base, senderPhone: null, reason: null, status: 'UNMATCHED' });
      expect(c.text).toContain('Sender phone: (not provided)');
      expect(c.text).not.toContain('Reason:');
    });
  });

  describe('composeStaleUnmatchedPaymentEmail', () => {
    const base = {
      status: 'UNMATCHED' as const,
      transactionId: 'SMK99999',
      amount: 7500,
      accountReference: 'WRONG-REF',
      senderPhone: '0700000000' as string | null,
      arrivedAtLabel: '14:05, 23 September 2026',
      ageMinutes: 75,
      currency: 'KSh',
      reason: 'No active tenant matched unit reference WRONG-REF.',
      identity,
    };

    it('shows the queue age in subject and body with still-held framing', () => {
      const c = composeStaleUnmatchedPaymentEmail(base);
      expect(c.subject).toContain('STILL UNRESOLVED');
      expect(c.subject).toContain('KSh 7,500');
      expect(c.subject).toContain('1 h 15 min');
      expect(c.text).toContain('waiting in the M-Pesa Review queue for 1 h 15 min');
      expect(c.text).toContain('Waiting since: 14:05, 23 September 2026 (1 h 15 min)');
      expect(c.text).toContain("still held");
      expect(c.text).toContain('Test Estates · Reg. No. REG-001');
    });

    it('renders minutes-only age under one hour', () => {
      const c = composeStaleUnmatchedPaymentEmail({ ...base, ageMinutes: 45 });
      expect(c.subject).toContain('45 min in queue');
    });

    it('renders AMBIGUOUS escalation wording', () => {
      const c = composeStaleUnmatchedPaymentEmail({ ...base, status: 'AMBIGUOUS' });
      expect(c.subject).toContain('ambiguous');
      expect(c.text).toMatch(/matched more than one tenant/i);
    });
  });

  describe('composePortalCredentialsEmail', () => {
    it('includes credentials, portal url and identity sign-off', () => {
      const c = composePortalCredentialsEmail({
        tenantName: 'Jane Doe',
        loginEmail: 'jane@example.com',
        password: 'secret-pw',
        portalUrl: 'https://app.example.com/portal/login',
        identity,
      });
      expect(c.subject).toContain('portal access');
      expect(c.text).toContain('jane@example.com');
      expect(c.text).toContain('secret-pw');
      expect(c.text).toContain('https://app.example.com/portal/login');
      expect(c.text).toContain('Test Estates · Reg. No. REG-001');
      // html escapes tenant-supplied values and links the portal
      expect(c.html).toContain('Sign in here');
      expect(c.html).toContain('secret-pw');
    });

    it('escapes tenant input in html', () => {
      const c = composePortalCredentialsEmail({
        tenantName: 'Jane <script>alert(1)</script>',
        loginEmail: 'jane@example.com',
        password: 'p',
        portalUrl: 'https://x.test',
        identity,
      });
      expect(c.html).not.toContain('<script>alert(1)</script>');
      expect(c.html).toContain('&lt;script&gt;');
    });

    it('falls back to a generic name when identity is empty', () => {
      const c = composePortalCredentialsEmail({
        tenantName: 'J',
        loginEmail: 'j@x.test',
        password: 'p',
        portalUrl: 'u',
        identity: { name: null },
      });
      expect(c.subject).toContain('Property Management');
    });
  });

  describe('composeMonthlyReportEmail', () => {
    it('names the report year and addresses the operator', () => {
      const c = composeMonthlyReportEmail({ year: 2026, identity });
      expect(c.subject).toBe('Monthly Financial Report 2026');
      expect(c.text).toContain('Dear Test Estates,');
    });

    it('falls back to the operator phrasing when identity is unset', () => {
      const c = composeMonthlyReportEmail({ year: 2026, identity: { name: null } });
      expect(c.text).toContain('Dear your property manager,');
    });
  });

  describe('composeStatementEmail', () => {
    it('titles the statement with the tenant name', () => {
      const c = composeStatementEmail({ tenantName: 'Jane Doe', year: 2026, identity });
      expect(c.subject).toBe('Tenant Statement 2026 — Jane Doe');
      expect(c.html).toContain('Reg. No. REG-001');
    });
  });

  describe('composeDataLetterEmail', () => {
    it('carries the register reference and defaults the deadline', () => {
      const c = composeDataLetterEmail({
        tenantName: 'Jane',
        registerRef: 'REF-9',
        responseDays: null,
        letterHtml: '<p>letter</p>',
      });
      expect(c.subject).toContain('REF-9');
      expect(c.text).toContain('Response deadline: 30 days');
      expect(c.html).toBe('<p>letter</p>'); // server-rendered letter passes through
    });
  });

  describe('composeCampaignEmail', () => {
    it('substitutes name and unit placeholders', () => {
      const c = composeCampaignEmail({
        tenantName: 'Jane Doe',
        unitNumber: 'A-1',
        subject: 'Hello {{name}}',
        message: 'Dear {{name}}, your unit {{unit}} is due.',
      });
      expect(c.personalSubject).toBe('Hello Jane Doe');
      expect(c.text).toBe('Dear Jane Doe, your unit A-1 is due.');
      expect(c.html).toContain('Dear Jane Doe');
    });

    it('falls back to "unassigned" without a unit', () => {
      const c = composeCampaignEmail({ tenantName: 'J', unitNumber: null, subject: 's', message: 'unit {{unit}}' });
      expect(c.text).toBe('unit unassigned');
    });
  });

  describe('composeTestEmail', () => {
    it('labels live and simulated modes distinctly', () => {
      const live = composeTestEmail({ provider: 'brevo', live: true, identity });
      const mock = composeTestEmail({ provider: 'mock', live: false, identity });
      expect(live.text).toContain('brevo, live');
      expect(mock.text).toContain('mock, simulated');
    });
  });
});

// --- Rent statement & invoice (per-month formal breakdown) --------------------
import { composeRentStatementEmail } from '../../src/utils/emailTemplates';

describe('composeRentStatementEmail', () => {
  const input = {
    tenantName: 'Jane Wanjiku',
    unitNumber: 'B4',
    monthName: 'September',
    year: 2026,
    previousBalance: 1500,
    currentRent: 9000,
    utilitiesAmount: 350,
    totalDue: 10850,
    currency: 'KSh',
    accountNumber: 'Unit B4',
    paymentMethod: 'M-Pesa PayBill 247252',
    identity: { name: 'Olbano Plaza', regNo: 'BN-2026' },
  };

  it('uses the formal subject with month and unit', () => {
    const email = composeRentStatementEmail(input);
    expect(email.subject).toBe('Rent Statement & Invoice for September 2026 - Unit B4');
  });

  it('renders the four-line breakdown in html and text', () => {
    const email = composeRentStatementEmail(input);
    expect(email.html).toContain('Previous Balance:');
    expect(email.html).toContain('Current Rent:');
    expect(email.html).toContain('Utilities/Other (water):');
    expect(email.html).toContain('Total Amount Due:');
    expect(email.html).toContain('KSh 10850');
    expect(email.text).toContain('Previous Balance: 1500');
    expect(email.text).toContain('Total Amount Due: 10850');
    expect(email.text).toContain('Dear Jane Wanjiku,');
    expect(email.text).toContain('Olbano Plaza · Reg. No. BN-2026');
  });

  it('escapes tenant-provided names in the html body', () => {
    const email = composeRentStatementEmail({ ...input, tenantName: 'Eve <script>alert(1)</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('includes the pay instruction and already-paid waiver', () => {
    const email = composeRentStatementEmail(input);
    expect(email.html).toContain('Account <strong>Unit B4</strong> via M-Pesa PayBill 247252');
    expect(email.text).toContain('If you have already paid, please disregard this statement.');
  });
});
