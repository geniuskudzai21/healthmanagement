const router = require('express').Router();
const c = require('../controllers/visits.controller');
const { requireRole } = require('../middleware/auth');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', requireRole('reception', 'nurse', 'admin'), c.register);
router.patch('/:id/status', requireRole('nurse', 'clinician', 'admin'), c.updateStatus);
router.patch('/:id/assign', requireRole('nurse', 'clinician', 'admin'), c.assign);
router.delete('/:id', requireRole('admin'), c.remove);

module.exports = router;
