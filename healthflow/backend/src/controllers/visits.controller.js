const visitsService = require('../services/visits.service');
const { validateBody, validateQuery } = require('../middleware/validate');

const VISIT_TYPES = ['walk-in', 'appointment', 'follow-up'];

const registerSchema = {
  patient_id: { type: 'integer', required: true },
  clinician_id: { type: 'integer' },
  room_id: { type: 'integer' },
  appointment_id: { type: 'integer' },
  visit_type: { type: 'string', enum: VISIT_TYPES, default: 'walk-in' },
  chief_complaint: { type: 'string', maxLength: 1000 },
  triage_level: { type: 'integer', min: 1, max: 5 },
  enqueue: { type: 'boolean', default: true },
  queue_area: { type: 'string', enum: ['general', 'vitals', 'consult'], default: 'general' },
};

const listSchema = {
  status: { type: 'string', enum: visitsService.STATUSES },
  patient_id: { type: 'integer' },
  clinician_id: { type: 'integer' },
  limit: { type: 'integer', min: 1, max: 200, default: 100 },
  offset: { type: 'integer', min: 0, default: 0 },
};

exports.list = [
  validateQuery(listSchema),
  async (req, res, next) => {
    try {
      res.json(await visitsService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.getById = async (req, res, next) => {
  try {
    res.json(await visitsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.register = [
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await visitsService.register(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.updateStatus = [
  validateBody({ status: { type: 'string', required: true, enum: visitsService.STATUSES } }),
  async (req, res, next) => {
    try {
      res.json(await visitsService.updateStatus(req.params.id, req.valid.status, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.assign = [
  validateBody({
    clinician_id: { type: 'integer' },
    room_id: { type: 'integer' },
  }),
  async (req, res, next) => {
    try {
      if (req.valid.clinician_id === undefined && req.valid.room_id === undefined) {
        return res.status(400).json({
          error: { message: 'Provide clinician_id and/or room_id.' },
        });
      }
      res.json(await visitsService.assign(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.remove = async (req, res, next) => {
  try {
    res.json(await visitsService.remove(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};
