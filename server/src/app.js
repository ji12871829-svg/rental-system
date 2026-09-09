// app.js — Express app setup. Middleware order matters: rate limiting →
// body parsing → routes → central error handler LAST (ARCHITECTURE.md §6).
const express = require('express');
const cors = require('cors');

const app = express();

// CORS: the web client now authenticates with httpOnly cookies, so requests
// include credentials and the server must allow them AND echo the exact
// origin (CORS_ORIGIN — no wildcards in production). The browser also needs
// the X-CSRF-Token header to pass the preflight for mutating requests.
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
  exposedHeaders: ['X-Export-Truncated'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));
app.use(express.json());

const { globalLimiter } = require('./middleware/rateLimiter');
app.use(globalLimiter);

// Same-origin static client: when the repo's client/ sits next to the server,
// serve it at / so the whole app runs from ONE process and ONE origin —
// cookies become same-site trivially (no CORS involved) and local demos/
// previews need a single server. /api/* routes below still take precedence;
// anything unmatched falls through to the SPA-ish static files.
const path = require('path');
const clientRoot = path.join(__dirname, '../../client');
// HTML lives in client/public and references ../css and ../js. Serving the
// client root first makes /css and /js resolve; public is mounted at / so
// / and /dashboard.html still work from a single origin (port 4000).
app.use(express.static(clientRoot));
app.use(express.static(path.join(clientRoot, 'public'), { index: 'index.html' }));

// Health check — keep this, it's the Phase 0 exit criterion.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Resource routers, one per resource (AGENTS.md §2).
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/units', require('./routes/units'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/leases', require('./routes/leases'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/reports', require('./routes/reports'));

// Unknown API routes → 404 in the standard error shape (not Express's HTML).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.', details: {} });
});

// Central error handler must be registered LAST.
app.use(require('./middleware/errorHandler'));

module.exports = app;
