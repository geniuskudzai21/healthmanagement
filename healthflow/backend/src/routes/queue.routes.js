const router = require('express').Router();
const c = require('../controllers/queue.controller');
const { requireRole } = require('../middleware/auth');

router.get('/', c.list);
router.get('/summary', c.summary);
router.get('/:id', c.getById);
router.post('/enqueue', requireRole('reception', 'nurse', 'admin'), c.enqueue);
router.post('/call-next', requireRole('nurse', 'clinician', 'admin'), c.callNext);
router.patch('/:id/status', requireRole('nurse', 'clinician', 'admin'), c.setStatus);
router.delete('/:id', requireRole('admin'), c.remove);

module.exports = router;
