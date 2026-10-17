const router = require('express').Router();
const c = require('../controllers/patients.controller');
const { requireRole } = require('../middleware/auth');

router.get('/', c.list);
router.get('/stats', c.stats);
router.get('/:id', c.getById);
router.post('/', requireRole('reception', 'admin'), c.create);
router.patch('/:id', requireRole('reception', 'admin'), c.update);
router.delete('/:id', requireRole('admin'), c.remove);

module.exports = router;
