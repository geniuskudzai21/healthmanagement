const router = require('express').Router();
const c = require('../controllers/users.controller');

router.get('/', c.list);
router.get('/:id', c.getById);
router.post('/', c.create);
router.patch('/:id', c.update);
router.delete('/:id', c.deactivate);

module.exports = router;
