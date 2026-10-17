const router = require('express').Router();
const c = require('../controllers/appointments.controller');
const { requireRole } = require('../middleware/auth');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', requireRole('reception', 'admin'), c.create);
router.patch('/:id', requireRole('reception', 'admin'), c.update);
router.patch('/:id/status', requireRole('reception', 'nurse', 'clinician', 'admin'), c.setStatus);
router.delete('/:id', requireRole('admin'), c.remove);

module.exports = router;
