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
  escapeHtml,
} from '../../src/utils/emailTemplates';

const identity = { name: 'Test Estates', regNo: 'REG-001' };

describe('emailTemplates', () => {
  describe('escapeHtml', () => {
    it('escapes markup-significant characters', () => {
      expect(escapeHtml(`<b>&"'</b>`)).toBe('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
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
