// routes/tenants.js — wiring only; business logic lives in controllers/.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/tenants');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { tenantCreateSchema, tenantUpdateSchema } = require('../utils/validationSchemas');

router.get('/', requireAuth, controller.list);
router.get('/:id', requireAuth, controller.getById);
router.post('/', requireAuth, csrfProtection, validate(tenantCreateSchema), controller.create);
router.patch('/:id', requireAuth, csrfProtection, validate(tenantUpdateSchema), controller.update);
router.patch('/:id/archive', requireAuth, csrfProtection, controller.archive); // archive is non-destructive
router.delete('/:id', requireAuth, requireRole('admin'), csrfProtection, controller.remove);

module.exports = router;
