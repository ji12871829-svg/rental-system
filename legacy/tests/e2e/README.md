# E2E tests (Playwright)

The full 5 flows from the build prompt §13 are specified here. They run against
a live app (server on :4000 + static client served on :5173) with the seeded
database — see `src/lease-flow.spec.js` for the exact flows.

## Setup

```bash
# 1. Backend + DB (from server/)
npm run migrate && npm run seed && npm run dev

# 2. Static client (from project root; any static server works)
npx serve client/public -l 5173

# 3. From the e2e directory
npm i
npx playwright install chromium
npx playwright test
```

## Flows covered

1. **Login → dashboard** — logs in as the seed admin, verifies the occupancy
   card renders with real numbers.
2. **Unit → tenant → lease** — creates all three through the UI and verifies
   the unit flips to "occupied".
3. **Payment → history + balance** — records a payment, verifies it appears in
   the history table and the balance updates.
4. **Overlapping lease conflict** — attempts a second overlapping active lease
   on the same unit and asserts the clear `409`-driven error is shown.
5. **Maintenance lifecycle** — submits a request and drives open →
   in_progress → resolved, verifying the resolved state renders.