import fs from 'fs';
import path from 'path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env, isProd } from './config/env';
import { pool } from './config/db';
import { errorHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimiter';
import { csrfProtection } from './middleware/csrf';
import auditRoutes from './routes/audit';
import authRoutes from './routes/auth';
import brandingRoutes from './routes/branding';
import emailRoutes from './routes/emails';
import privacyRequestRoutes from './routes/privacyRequests';
import expenseRoutes from './routes/expenses';
import receiptRoutes from './routes/receipts';
import rentRoutes from './routes/rent';
import mpesaRoutes from './routes/mpesa';
import mpesaReviewRoutes from './routes/mpesaReview';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import smsRoutes from './routes/sms';
import tenantRoutes from './routes/tenants';
import tenantPortalRoutes from './routes/tenantPortal';
import unitRoutes from './routes/units';
import userRoutes from './routes/users';
import waterRoutes from './routes/water';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Render terminates TLS and forwards requests — rate limiting must see the real client IP
  app.use(helmet());
  app.use(cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  }));
  app.use(express.json({ limit: '1mb' }));
  // Provider callbacks (Africa's Talking delivery reports) POST
  // form-urlencoded bodies — parse them alongside JSON.
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(csrfProtection);
  app.use(globalLimiter);

  // HSTS — browsers must refuse plain HTTP for this origin, ever. Response
  // headers only; no effect on the API contract, so it applies to every
  // route (API and static frontend alike).
  if (isProd) {
    app.use((_req, res, next) => {
      // 1 year, applying to subdomains too; `preload` is deliberately omitted
      // (the onrender.com subdomain can't pass the HSTS preload program).
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      next();
    });
  }

  // Liveness + configuration diagnosis. Never exposes secret values — only
  // which env knobs are unset, so a failed deploy can be debugged from the
  // outside (Render health checks and the browser).
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      nodeEnv: env.nodeEnv,
      db: 'checking',
      smsProvider: env.smsProvider,
      emailProvider: env.emailProvider,
      config: {
        jwtSecretSet: env.jwtSecret !== 'dev-only-secret-change-me',
        corsOriginSet: Boolean(process.env.CORS_ORIGIN),
        businessNameSet: Boolean(env.businessName),
        frontendDistPresent: isProd ? fs.existsSync(FRONTEND_DIST) : null,
      },
    });
    // Don't block the health response on the DB round-trip; report it after.
    pool
      .query('SELECT 1')
      .then(() => console.log('[health] db reachable'))
      .catch((err: Error) => console.error('[health] db unreachable:', err.message));
  });
  app.use('/api/branding', brandingRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api/tenants', tenantRoutes);
  // Tenant self-service portal — separate cookie + JWT audience from staff
  // auth (see middleware/portalAuth.ts). Mounted before the /api 404 guard.
  app.use('/api/portal', tenantPortalRoutes);
  app.use('/api/rent', rentRoutes);
  app.use('/api/mpesa', mpesaRoutes);
  app.use('/api/mpesa/review', mpesaReviewRoutes);
  app.use('/api/water', waterRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/receipts', receiptRoutes);
  app.use('/api/sms', smsRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/privacy-requests', privacyRequestRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/audit', auditRoutes);

  // Unknown API routes → 404 in the standard error shape.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.', details: {} });
  });

  serveFrontend(app);

  app.use(errorHandler);
  return app;
}

// In production, serve the built React app from the same origin (Render Web
// Service / any Node host): frontend/dist static files first, then an SPA
// fallback so deep links like /tenants/5 render the app on refresh instead of
// 404ing. Disabled when the directory is absent (API-only dev/test deploys).
// Under Vite's hashed filenames (e.g. Dashboard-a1b2c3.js), stale HTML from an
// old deploy references 404'd assets — after a fresh login the app self-heals
// by reloading once when a lazy route chunk fails to load.
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

function serveFrontend(app: express.Express): void {
  if (!fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) return;

  app.use(
    express.static(FRONTEND_DIST, {
      maxAge: '1h',
      setHeaders(res, filePath) {
        // Hashed assets are immutable; HTML and the service worker must not
        // be cached aggressively or updates (and SW bumps) won't propagate.
        if (/\.[0-9a-f]{8}\./.test(filePath) || filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('sw.js') || filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}