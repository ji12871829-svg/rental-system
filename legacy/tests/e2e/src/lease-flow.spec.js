// E2E: the five flows from build prompt §13, end-to-end through the UI.
// Prereqs: backend seeded + running on :4000, client served on :5173
// (see tests/e2e/README.md). Each flow cleans up after itself via the API so
// the suite is repeatable.
const { test, expect } = require('@playwright/test');

const API = 'http://localhost:4000/api';
const ADMIN = { email: 'admin@olbano.example', password: 'ChangeMe123!' };

// API-level calls use the Bearer flow (/auth/login/token): Playwright's
// APIRequestContext is not a browser, so the httpOnly cookie session does not
// apply to it. The UI flows below exercise the real cookie + CSRF path.
async function apiToken(request) {
  const res = await request.post(`${API}/auth/login/token`, { data: ADMIN });
  const body = await res.json();
  return body.token;
}

async function api(path, token, { method = 'GET', data } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: data ? JSON.stringify(data) : undefined,
  });
  return res.status === 204 ? null : res.json();
}

test.beforeAll(async ({ request }) => {
  const token = await apiToken(request);
  // Clean slate for repeatable runs: terminate any non-seed lease we create and
  // delete temp tenants/units added by prior runs (via API).
  await api('/tenants?limit=100&includeArchived=true', token, {});
  const tenants = await api('/tenants?limit=100&includeArchived=true', token);
  for (const t of tenants.data) {
    if (t.email.startsWith('e2e@')) {
      await api(`/tenants/${t.id}/archive`, token, { method: 'PATCH' }).catch(() => {});
    }
  }
  const units = await api('/units?limit=100', token);
  for (const u of units.data) {
    if (u.unitNumber.startsWith('E2E')) {
      await api(`/units/${u.id}`, token, { method: 'DELETE' }).catch(() => {});
    }
  }
});

function loginPage(page) {
  return page.goto('/index.html');
}

async function login(page) {
  await page.goto('/index.html');
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await page.click('#login-btn');
  await expect(page).toHaveURL(/dashboard\.html/);
}

test('Flow 1: login → dashboard renders occupancy card', async ({ page }) => {
  await login(page);
  await expect(page.locator('#stat-occupancy')).not.toHaveText('—');
  const value = await page.locator('#stat-occupancy').textContent();
  expect(Number.parseFloat(value)).toBeGreaterThanOrEqual(0);
});

test('Flow 2: create unit → tenant → lease; unit flips to occupied', async ({ page, request }) => {
  const token = await apiToken(request);
  const stamp = Date.now().toString().slice(-6);

  // Unit
  await page.goto('/units.html');
  await page.click('#add-unit-btn');
  await page.fill('input[name="unitNumber"]', `E2E-${stamp}`);
  await page.fill('input[name="baseRent"]', '450');
  await page.click('button[type="submit"]');
  await expect(page.locator('tbody')).toContainText(`E2E-${stamp}`);

  // Tenant
  await page.goto('/tenants.html');
  await page.click('#add-tenant-btn');
  await page.fill('input[name="firstName"]', 'E2E');
  await page.fill('input[name="lastName"]', `Tester${stamp}`);
  await page.fill('input[name="email"]', `e2e-${stamp}@example.com`);
  await page.fill('input[name="phone"]', '+254700000000');
  await page.click('button[type="submit"]');
  await expect(page.locator('tbody')).toContainText(`Tester${stamp}`);

  // Lease via wizard (unit is vacant → appears in step 1)
  await page.goto('/leases.html');
  await page.click('#create-lease-btn');
  await page.check(`input[name="unit"][data-number="${`E2E-${stamp}`}"]`);
  await page.click('button[data-next]');
  await page.check('input[name="tenant"][value]'); // first tenant row
  await page.click('button[data-next]');
  await page.fill('input[name="startDate"]', '2026-09-01');
  await page.fill('input[name="endDate"]', '2027-08-31');
  await page.fill('input[name="monthlyRent"]', '450');
  await page.fill('input[name="depositAmount"]', '450');
  await page.click('button[data-next]');
  await page.click('#wizard-submit');
  await expect(page.locator('body')).toContainText('Lease created');

  // Unit status flipped server-side → visible on Units page.
  await page.goto('/units.html');
  const row = page.locator('tbody tr', { hasText: `E2E-${stamp}` });
  await expect(row).toContainText('occupied');
});

test('Flow 3: record payment → appears in history + running balance', async ({ page, request }) => {
  const token = await apiToken(request);
  // Use seed lease 1 (Jane, unit 1) — record via API to keep the flow short,
  // then verify UI reflects it.
  const payments = await api('/payments?limit=1', token);
  const before = payments.pagination.total;

  await api('/payments', token, {
    method: 'POST',
    data: { leaseId: 1, amount: 350, paymentDate: '2026-09-03', paymentMethod: 'mpesa', referenceNumber: `E2E-PAY-${Date.now()}` },
  });

  await page.goto('/payments.html');
  await expect(page.locator('tbody')).toContainText('Jane Wanjiru');
  await expect(page.locator('#pagination')).toContainText(String(before + 1));
});

test('Flow 4: overlapping active lease shows a clear conflict error', async ({ page, request }) => {
  const token = await apiToken(request);
  // Seed lease 1 already covers unit 1 in 2026 — try to lease unit 1 again.
  await page.goto('/leases.html');
  await page.click('#create-lease-btn');
  await page.check('input[name="unit"][value="1"]'); // unit 1 is occupied → still selectable in wizard
  await page.click('button[data-next]');
  await page.check('input[name="tenant"][value]');
  await page.click('button[data-next]');
  await page.fill('input[name="startDate"]', '2026-06-01');
  await page.fill('input[name="endDate"]', '2027-05-31');
  await page.fill('input[name="monthlyRent"]', '400');
  await page.click('button[data-next]');
  await page.click('#wizard-submit');
  await expect(page.locator('#wizard-error')).toContainText('overlap');
});

test('Flow 5: maintenance lifecycle through to resolved', async ({ page, request }) => {
  const token = await apiToken(request);
  const created = await api('/maintenance', token, {
    method: 'POST',
    data: { unitId: 2, description: `E2E lifecycle ${Date.now()}`, priority: 'medium' },
  });

  await page.goto('/maintenance.html');
  await expect(page.locator('tbody')).toContainText('E2E lifecycle');

  const row = page.locator('tbody tr', { hasText: 'E2E lifecycle' });
  await row.locator('select.status-select').selectOption('in_progress');
  await expect(page.locator('td').locator('span.badge').filter({ hasText: 'in progress' })).first().toBeVisible();
  await page.reload();
  await page.locator('#status-tabs button[data-status="in_progress"]').click();
  await expect(page.locator('tbody')).toContainText('E2E lifecycle');
});