const router = require('express').Router();
const c = require('../controllers/users.controller');

// Directory of active clinicians, readable by any authenticated user so that
// reception can build appointment/visit forms (full /users stays admin-only).
router.get('/', c.listClinicians);

module.exports = router;
