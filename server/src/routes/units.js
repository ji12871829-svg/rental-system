// routes/units.js — wiring only; business logic lives in controllers/.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/units');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { unitCreateSchema, unitUpdateSchema } = require('../utils/validationSchemas');

router.get('/', requireAuth, controller.list);
router.get('/:id', requireAuth, controller.getById);
router.post('/', requireAuth, csrfProtection, validate(unitCreateSchema), controller.create);
router.patch('/:id', requireAuth, csrfProtection, validate(unitUpdateSchema), controller.update);
// Admin only: deletes are destructive and irreversible (§7).
router.delete('/:id', requireAuth, requireRole('admin'), csrfProtection, controller.remove);

module.exports = router;
