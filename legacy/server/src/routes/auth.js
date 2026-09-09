// routes/auth.js — POST /login, POST /logout, GET /me.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/auth');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
const { loginSchema } = require('../utils/validationSchemas');

// Stricter limiter only here — brute-force surface (TRD §2).
router.post('/login', loginLimiter, validate(loginSchema), controller.login);
// API-client (Bearer) login — same limiter, no cookies involved.
router.post('/login/token', loginLimiter, validate(loginSchema), controller.loginToken);
router.post('/logout', controller.logout); // no auth required — see controller
router.get('/me', requireAuth, controller.me);

module.exports = router;