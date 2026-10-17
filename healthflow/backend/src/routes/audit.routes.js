const router = require('express').Router();
const c = require('../controllers/audit.controller');

router.get('/', c.list);

module.exports = router;
