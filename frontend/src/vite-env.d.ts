/// <reference types="vite/client" />

// Deployment-provided keys (see docs/RUNBOOK-clerk-setup.md). Unset = Clerk
// sign-in UI stays dormant and the password form is the only door.
interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  // Canonical site origin (no trailing slash) used for absolute og:url / OG
  // image / JSON-LD URLs. Unset = the current browser origin is used.
  readonly VITE_SITE_URL?: string;
}

// Virtual module injected by the lastUpdatedVirtual() plugin in vite.config.ts
// (mtime of src/lib/branding.ts at build/dev-server time).
declare module 'virtual:last-updated' {
  export const lastUpdated: string;
}

// Virtual module injected by the swVersionVirtual() plugin in vite.config.ts
// (VERSION constant from public/sw.js, for deploy-freshness detection).
declare module 'virtual:sw-version' {
  export const buildTimeSwVersion: string;
}
