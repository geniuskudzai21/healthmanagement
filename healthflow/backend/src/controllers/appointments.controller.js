const appointmentsService = require('../services/appointments.service');
const { validateBody, validateQuery } = require('../middleware/validate');

const STATUSES = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];

const createSchema = {
  patient_id: { type: 'integer', required: true },
  clinician_id: { type: 'integer', required: true },
  room_id: { type: 'integer' },
  scheduled_start: { type: 'timestamp', required: true },
  scheduled_end: { type: 'timestamp', required: true },
  reason: { type: 'string', maxLength: 1000 },
  notes: { type: 'string', maxLength: 2000 },
  status: { type: 'string', enum: STATUSES, default: 'scheduled' },
};

const updateSchema = Object.fromEntries(
  Object.entries(createSchema).map(([key, rule]) => [key, { ...rule, required: false }])
);
delete updateSchema.status.default;

const listSchema = {
  from: { type: 'timestamp' },
  to: { type: 'timestamp' },
  clinician_id: { type: 'integer' },
  patient_id: { type: 'integer' },
  status: { type: 'string', enum: STATUSES },
};

exports.list = [
  validateQuery(listSchema),
  async (req, res, next) => {
    try {
      res.json(await appointmentsService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.getById = async (req, res, next) => {
  try {
    res.json(await appointmentsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.create = [
  validateBody(createSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await appointmentsService.create(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.update = [
  validateBody(updateSchema),
  async (req, res, next) => {
    try {
      res.json(await appointmentsService.update(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.setStatus = [
  validateBody({ status: { type: 'string', required: true, enum: STATUSES } }),
  async (req, res, next) => {
    try {
      res.json(await appointmentsService.setStatus(req.params.id, req.valid.status, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.remove = async (req, res, next) => {
  try {
    res.json(await appointmentsService.remove(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};
