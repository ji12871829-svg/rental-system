import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Only run the dark-mode screenshot test by default. Other test files
  // in this directory (if any are added later) can be selected explicitly.
  testMatch: /dark-mode-screenshot\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 0 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'off', // we capture our own named screenshots
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
