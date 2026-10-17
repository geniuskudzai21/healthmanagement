const router = require('express').Router();
const c = require('../controllers/rooms.controller');
const { requireRole } = require('../middleware/auth');

router.get('/', c.list);
router.get('/available', c.listAvailable);
router.post('/route', requireRole('reception', 'nurse', 'clinician', 'admin'), c.route);
router.get('/:id', c.getById);
router.post('/', requireRole('admin'), c.create);
router.patch('/:id', requireRole('nurse', 'clinician', 'admin'), c.update);
router.post('/:id/release', requireRole('nurse', 'clinician', 'admin'), c.release);
router.delete('/:id', requireRole('admin'), c.remove);

module.exports = router;
