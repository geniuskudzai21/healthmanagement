const express = require('express');
const { buildContext } = require('../utils/context');
const { requireAuth, requireRole } = require('../middleware/auth');
const authRoutes = require('./auth.routes');
const users = require('./users.routes');
const clinicians = require('./clinicians.routes');
const patients = require('./patients.routes');
const rooms = require('./rooms.routes');
const visits = require('./visits.routes');
const checkin = require('./checkin.routes');
const queue = require('./queue.routes');
const appointments = require('./appointments.routes');
const reports = require('./reports.routes');
const billing = require('./billing.routes');
const audit = require('./audit.routes');

const router = express.Router();

const attachContext = (req, res, next) => {
  res.locals.ctx = buildContext(req);
  next();
};

// Public: login / logout (context attached so the login audit row has an IP).
router.use(attachContext);
router.use('/auth', authRoutes);

// Everything below requires a valid session.
router.use(requireAuth);
router.use(attachContext); // re-run now that req.user exists, so audit rows have an actor

router.use('/users', requireRole('admin'), users);
router.use('/clinicians', clinicians);
router.use('/audit', requireRole('admin'), audit);
router.use('/reports', requireRole('admin', 'clinician'), reports);

router.use('/patients', patients);
router.use('/rooms', rooms);
router.use('/visits', visits);
router.use('/check-in', checkin);
router.use('/queue', queue);
router.use('/appointments', appointments);
router.use('/billing', billing);

module.exports = router;
