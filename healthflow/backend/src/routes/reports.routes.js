const router = require('express').Router();
const c = require('../controllers/reports.controller');

router.get('/daily', c.daily);
router.get('/monthly', c.monthly);

module.exports = router;
