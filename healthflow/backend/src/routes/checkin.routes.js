const router = require('express').Router();
const c = require('../controllers/checkin.controller');
const { requireRole } = require('../middleware/auth');

router.post('/', requireRole('reception', 'nurse', 'admin'), c.checkIn);

module.exports = router;
