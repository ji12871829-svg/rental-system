// routes/leases.js — wiring only; business logic lives in controllers/.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/leases');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { leaseCreateSchema, leaseUpdateSchema } = require('../utils/validationSchemas');

router.get('/', requireAuth, controller.list);
router.get('/:id', requireAuth, controller.getById);
router.post('/', requireAuth, csrfProtection, validate(leaseCreateSchema), controller.create);
router.patch('/:id', requireAuth, csrfProtection, validate(leaseUpdateSchema), controller.update);
// DELETE /api/leases/:id is deliberately not implemented: leases are financial
// history. Use PATCH { status: 'terminated' } instead (§9).
router.delete('/:id', requireAuth, csrfProtection, function (req, res, next) {
  res.status(405).json({
    error: 'METHOD_NOT_ALLOWED',
    message: 'Leases cannot be deleted. Use PATCH with status "terminated" instead.',
    details: {},
  });
});

module.exports = router;
