// Mock RPMS server for testing scripts/verify-live.mjs against a local
// endpoint without touching a real deployment. Mimics app.ts routes closely:
// health, SPA index + fallback, PWA assets, API 404 shape, login + authed reads.
// NOT deployed anywhere — test scaffolding only (plain Node http, no deps).
import http from 'http';

const INDEX_HTML = '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>';
const SW_JS = "const VERSION = 'v3';\nself.addEventListener('fetch', () => {});";
const MANIFEST = JSON.stringify({
  name: 'RPMS — Mock', short_name: 'RPMS', start_url: '/', scope: '/', display: 'standalone',
  icons: [{ src: '/pwa-192.png', sizes: '192x192' }, { src: '/pwa-512.png', sizes: '512x512' }],
});
// Minimal valid 1x1 PNG (hex).
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
  '0000000a49444154789c6360000002000148afa4710000000049454e44ae426082',
  'hex'
);

const TOKEN = 'mock-jwt-token';
const PORT = Number(process.env.MOCK_PORT || 4599);

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const auth = req.headers.authorization ?? '';

  if (p === '/api/health') {
    return json(200, { status: 'ok', nodeEnv: 'production', db: 'checking', smsProvider: 'mock', emailProvider: 'mock',
      config: { jwtSecretSet: true, corsOriginSet: false, businessNameSet: false, frontendDistPresent: true } });
  }
  if (p === '/api/auth/login') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { email, password } = JSON.parse(body || '{}');
      if (email === 'admin@rpms.local' && password === 'Admin@2026!') {
        return json(200, { data: { token: TOKEN, user: { id: 1, name: 'System Administrator', email, role: 'ADMIN' } } });
      }
      return json(401, { error: 'UNAUTHORIZED', message: 'Invalid email or password.', details: {} });
    });
    return;
  }
  if (p === '/api/auth/me') {
    if (auth === `Bearer ${TOKEN}`) return json(200, { data: { id: 1, name: 'System Administrator', email: 'admin@rpms.local', role: 'ADMIN' } });
    return json(401, { error: 'UNAUTHORIZED', message: 'Missing or invalid token.', details: {} });
  }
  if (p.startsWith('/api/')) {
    if (auth === `Bearer ${TOKEN}` && ['/api/units', '/api/tenants', '/api/settings'].some((r) => p.startsWith(r))) {
      return json(200, { data: [] });
    }
    return json(404, { error: 'NOT_FOUND', message: 'API route not found.', details: {} });
  }

  // Static-ish responses
  if (p === '/manifest.webmanifest') { res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); return res.end(MANIFEST); }
  if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' }); return res.end(SW_JS); }
  if (p === '/pwa-192.png' || p === '/pwa-512.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (p === '/favicon.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end('<svg/>'); }
  // SPA index + deep-link fallback
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
  res.end(INDEX_HTML);
});

server.listen(PORT, () => console.log(`mock RPMS listening on http://localhost:${PORT}`));
