import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Injects the last-edit time of src/lib/branding.ts at build/dev-server
// time, so the legal pages' "Last updated" line always reflects the file
// that actually holds the policy details. Re-read on every dev transform
// and on each production build — no manual date maintenance needed.
function lastUpdatedVirtual(): Plugin {
  const brandingPath = resolve(fileURLToPath(import.meta.url), '../src/lib/branding.ts');
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
      const src = readFileSync(resolve(fileURLToPath(import.meta.url), '../public/sw.js'), 'utf8');
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

// Emits robots.txt (and sitemap.xml) into dist at build time.
//
// The sitemap protocol requires ABSOLUTE URLs, but this project has no
// configured production domain — a hardcoded one would be invented data.
// So: when VITE_SITE_URL is set, the public routes are listed with absolute
// URLs plus a matching `Sitemap:` directive in robots.txt; when it is not
// set, the sitemap is skipped honestly (relative URLs in a sitemap are
// invalid) and a build warning names the missing variable. robots.txt is
// always emitted — the same content ships in public/ for dev, but dist needs
// its own copy because Vite only copies files from public/.
function seoFiles(): Plugin {
  let siteUrl = '';
  let outDir = 'dist';
  return {
    name: 'seo-files',
    config(_config, env) {
      siteUrl = (env.mode === 'production' ? process.env.VITE_SITE_URL : process.env.VITE_SITE_URL ?? '')?.trim() ?? '';
    },
    configResolved(resolved: ResolvedConfig) {
      outDir = resolved.build.outDir;
    },
    closeBundle() {
      const out = resolve(fileURLToPath(import.meta.url), '..', outDir);
      mkdirSync(out, { recursive: true });

      const base = siteUrl.replace(/\/+$/, '');
      if (base) {
        // Public routes only — the app shell, auth and portal screens are
        // behind sign-in or search-excluded by nature (empty public value).
        const routes: { path: string; priority: string }[] = [
          { path: '/landing', priority: '1.0' },
          { path: '/login', priority: '0.5' },
          { path: '/register', priority: '0.5' },
          { path: '/portal/login', priority: '0.3' },
          { path: '/privacy', priority: '0.3' },
          { path: '/terms', priority: '0.3' },
          { path: '/cookies', priority: '0.3' },
          { path: '/refunds', priority: '0.3' },
        ];
        const today = new Date().toISOString().slice(0, 10);
        const xml =
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          routes
            .map(
              (r) =>
                `  <url><loc>${base}${r.path}</loc><lastmod>${today}</lastmod><priority>${r.priority}</priority></url>`,
            )
            .join('\n') +
          '\n</urlset>\n';
        writeFileSync(resolve(out, 'sitemap.xml'), xml);
      } else {
        console.warn(
          '\n[seo-files] VITE_SITE_URL is not set — sitemap.xml was skipped ' +
            '(sitemap URLs must be absolute). Set VITE_SITE_URL to your public ' +
            'origin to emit one; robots.txt is still written.\n',
        );
      }

      writeFileSync(
        resolve(out, 'robots.txt'),
        ['User-agent: *', 'Allow: /', ...(base ? ['Sitemap: ' + base + '/sitemap.xml'] : []), ''].join('\n'),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), lastUpdatedVirtual(), swVersionVirtual(), seoFiles()],
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
