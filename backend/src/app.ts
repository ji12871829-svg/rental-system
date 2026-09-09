import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimiter';
import auditRoutes from './routes/audit';
import authRoutes from './routes/auth';
import brandingRoutes from './routes/branding';
import emailRoutes from './routes/emails';
import privacyRequestRoutes from './routes/privacyRequests';
import expenseRoutes from './routes/expenses';
import receiptRoutes from './routes/receipts';
import rentRoutes from './routes/rent';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import smsRoutes from './routes/sms';
import tenantRoutes from './routes/tenants';
import unitRoutes from './routes/units';
import userRoutes from './routes/users';
import waterRoutes from './routes/water';

export function createApp() {
  const app = express();

  app.use(cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json({ limit: '1mb' }));
  // Provider callbacks (Africa's Talking delivery reports) POST
  // form-urlencoded bodies — parse them alongside JSON.
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(globalLimiter);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/branding', brandingRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api/tenants', tenantRoutes);
  app.use('/api/rent', rentRoutes);
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

  app.use(errorHandler);
  return app;
}