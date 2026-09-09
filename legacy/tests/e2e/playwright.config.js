// Playwright E2E config — targets the local dev stack (see README.md).
// The backend must be running on :4000 and the static client on :5173.
module.exports = {
  testDir: '.',
  timeout: 45000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  reporter: 'line',
};