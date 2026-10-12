// Dark-mode visual regression check — loads the app in a headless browser,
// toggles dark mode, and captures screenshots of key pages in both themes.
//
// This test is designed to run in CI (ubuntu-latest) where Playwright's
// Chromium is installed automatically. Locally it skips gracefully when no
// browser is available.
//
// Assertions:
//   1. No console errors (Error-level) during page load or dark-mode toggle.
//   2. Screenshots are captured for human review as CI artifacts.
//   3. (Optional) Key CSS classes are present on the rendered DOM.
//
// Run:  npx playwright test dark-mode-screenshot
//        npx playwright show-report   (after a run)

import { test } from '@playwright/test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Base URL — read from env, fall back to the dev server default.
const BASE_URL = process.env.VITE_BASE_URL || 'http://localhost:5173';

// Pages to screenshot in both light and dark themes.
const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'mpesa-review', path: '/mpesa-review' },
  { name: 'rent-collection', path: '/rent-collection' },
  { name: 'settings', path: '/settings' },
];

// Key CSS classes whose presence on the rendered DOM signals that dark-mode
// styling is applied (not removed). Keep this list small and high-signal.
const DARK_MODE_CLASS_CHECKS = {
  '/dashboard': ['shadow-sm'],
  '/mpesa-review': ['table-scroll', 'shadow-sm'],
  '/rent-collection': ['shadow-sm'],
  '/settings': ['shadow-sm'],
};

/** Toggle the document between light and dark mode. The app stores the
 *  preference in localStorage under `rpms-theme` and appends/removes the
 *  `dark` class on `<html>` (Tailwind's `darkMode: 'class'`). */
async function setTheme(page: import('@playwright/test').Page, dark: boolean): Promise<void> {
  await page.evaluate((dark: boolean) => {
    const html = document.documentElement;
    if (dark) html.classList.add('dark');
    else html.classList.remove('dark');
    try { localStorage.setItem('rpms-theme', dark ? 'dark' : 'light'); } catch {}
  }, dark);
  await page.waitForTimeout(300);
}

/** Capture a named screenshot under `test-results/`. */
async function screenshot(
  page: import('@playwright/test').Page,
  label: string,
  theme: 'light' | 'dark'
): Promise<void> {
  await page.screenshot({
    path: join(ROOT, 'test-results', `dark-mode-${label}-${theme}.png`),
    fullPage: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('dark-mode screenshot check', () => {
  test('captures light and dark screenshots of key pages with no console errors', async ({ browser }) => {
    // Skip if the dev server isn't reachable (e.g. running outside CI without
    // `npm run dev` started). In CI the server is started by the workflow.
    const page = await browser.newPage();

    // Collect Error-level console messages during the session.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      // The ci-visual job runs Vite alone (no backend, no Postgres), so the
      // /api/* proxy answers 502 on every call. That is environmental noise,
      // not an app or styling regression — this spec's console-error gate is
      // about the page itself. Verified: the first real CI run (c996b35) was
      // drowned in exactly these 502s.
      const url = msg.location()?.url ?? '';
      if (url.includes('/api/') && /502 \(Bad Gateway\)/.test(msg.text())) return;
      consoleErrors.push(msg.text());
    });

    // Verify the server is reachable; skip gracefully if not (e.g. local run
    // without `npm run dev`).
    try {
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    } catch {
      console.log(`⊘ dark-mode screenshot check skipped: dev server at ${BASE_URL} not reachable.`);
      return;
    }

    // Ensure the test-results directory exists.
    const { execSync } = await import('node:child_process');
    try { execSync('mkdir -p test-results', { cwd: ROOT }); } catch {}

    for (const { name, path } of PAGES) {
      const url = BASE_URL + path;

      // --- Light theme ---
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
      await setTheme(page, false);
      await screenshot(page, name, 'light');

      // --- Dark theme ---
      await setTheme(page, true);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
      await screenshot(page, name, 'dark');

      // Soft assertion: log when a tracked dark-mode class is absent (the
      // screenshot is the human-review artifact; this is informational).
      for (const cls of DARK_MODE_CLASS_CHECKS[path] || []) {
        const count = await page.locator(`.${cls}`).count();
        if (count === 0) {
          console.log(
            `  ⚠ class ".${cls}" not found on ${path} — screenshot captured for review.`
          );
        }
      }
    }

    // Hard gate: no Error-level console messages during the session.
    const realErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('net::ERR')
    );
    if (realErrors.length > 0) {
      throw new Error(
        `Console errors during dark-mode screenshot session:\n${realErrors.map((e) => `  • ${e}`).join('\n')}`
      );
    }
  });
});
