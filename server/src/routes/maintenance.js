// routes/maintenance.js — wiring only; business logic lives in controllers/.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/maintenance');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { maintenanceCreateSchema, maintenanceUpdateSchema } = require('../utils/validationSchemas');

router.get('/', requireAuth, controller.list);
router.get('/:id', requireAuth, controller.getById);
router.post('/', requireAuth, csrfProtection, validate(maintenanceCreateSchema), controller.create);
router.patch('/:id', requireAuth, csrfProtection, validate(maintenanceUpdateSchema), controller.update);

module.exports = router;
