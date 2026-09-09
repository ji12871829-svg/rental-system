import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Injects the last-edit time of src/lib/branding.ts at build/dev-server
// time, so the legal pages' "Last updated" line always reflects the file
// that actually holds the policy details. Re-read on every dev transform
// and on each production build — no manual date maintenance needed.
function lastUpdatedVirtual(): Plugin {
  const brandingPath = resolve(fileURLToPath(import.meta.url), '../../src/lib/branding.ts');
  const readMtime = () => {
    try {
      return new Date(statSync(brandingPath).mtimeMs).toISOString();
    } catch {
      return new Date().toISOString();
    }
  };
  const moduleId = 'virtual:last-updated';
  return {
    name: 'virtual-last-updated',
    resolveId(id) {
      if (id === moduleId) return '\0' + moduleId;
    },
    load(id) {
      if (id === '\0' + moduleId) {
        return `export const lastUpdated = ${JSON.stringify(readMtime())};`;
      }
    },
  };
}

// Injects the service worker's VERSION string at build time, so the app can
// detect "a newer deploy exists" and refresh itself (see src/lib/pwa.ts).
function swVersionVirtual(): Plugin {
  const moduleId = 'virtual:sw-version';
  const readVersion = () => {
    try {
      const src = readFileSync(resolve(fileURLToPath(import.meta.url), '../../public/sw.js'), 'utf8');
      return /const VERSION = '([^']+)'/.exec(src)?.[1] ?? 'dev';
    } catch {
      return 'dev';
    }
  };
  return {
    name: 'sw-version-virtual',
    resolveId(id) {
      if (id === moduleId) return '\0' + moduleId;
    },
    load(id) {
      if (id === '\0' + moduleId) {
        return `export const buildTimeSwVersion = ${JSON.stringify(readVersion())};`;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), lastUpdatedVirtual(), swVersionVirtual()],
  server: {
    port: 5173,
    proxy: {
      // Dev convenience: same-origin /api calls are forwarded to the backend,
      // so no CORS work is needed locally. Production sets VITE_API_URL.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    // `vite preview` serves the production build; same /api proxy as dev so
    // the PWA (service worker, offline mode) can be tested against a real
    // backend without CORS setup.
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
