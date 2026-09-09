// routes/users.js — admin-only user management (build prompt §7: admins have
// "full access, including user management"). Managers get 403 here.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/users');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { userCreateSchema, userUpdateSchema } = require('../utils/validationSchemas');

router.get('/', requireAuth, requireRole('admin'), controller.list);
router.get('/:id', requireAuth, requireRole('admin'), controller.getById);
router.post('/', requireAuth, requireRole('admin'), csrfProtection, validate(userCreateSchema), controller.create);
router.patch('/:id', requireAuth, requireRole('admin'), csrfProtection, validate(userUpdateSchema), controller.update);

module.exports = router;