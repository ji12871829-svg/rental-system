// routes/payments.js — wiring only; business logic lives in controllers/.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/payments');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { paymentCreateSchema } = require('../utils/validationSchemas');

// /export must be declared before /:id so "export" is not captured as an id.
router.get('/export', requireAuth, controller.exportCsv);
router.get('/', requireAuth, controller.list);
router.get('/:id', requireAuth, controller.getById);
router.post('/', requireAuth, csrfProtection, validate(paymentCreateSchema), controller.create);

module.exports = router;
