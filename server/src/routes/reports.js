// routes/reports.js — read-only analytics, all requireAuth.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/reports');
const { requireAuth } = require('../middleware/auth');

router.get('/occupancy', requireAuth, controller.occupancy);
router.get('/rent-collection', requireAuth, controller.rentCollection);
router.get('/upcoming-lease-expirations', requireAuth, controller.upcomingExpirations);
router.get('/outstanding-balances', requireAuth, controller.outstandingBalances);

module.exports = router;
