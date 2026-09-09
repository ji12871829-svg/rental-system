/// <reference types="vite/client" />

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
