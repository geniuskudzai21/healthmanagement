const patientsService = require('../services/patients.service');
const { validateBody, validateQuery, EMAIL_PATTERN } = require('../middleware/validate');

const SEX = ['female', 'male'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const createSchema = {
  mrn: { type: 'string', required: true, maxLength: 40 },
  first_name: { type: 'string', required: true, maxLength: 100 },
  last_name: { type: 'string', required: true, maxLength: 100 },
  date_of_birth: { type: 'date', required: true },
  sex: { type: 'string', enum: SEX, required: true },
  phone: { type: 'string', maxLength: 40 },
  email: { type: 'string', pattern: EMAIL_PATTERN, patternMessage: 'must be a valid email' },
  address: { type: 'string', maxLength: 500 },
  blood_type: { type: 'string', enum: BLOOD },
  allergies: { type: 'string', maxLength: 1000 },
  notes: { type: 'string', maxLength: 2000 },
};

const updateSchema = Object.fromEntries(
  Object.entries(createSchema).map(([key, rule]) => [key, { ...rule, required: false }])
);
updateSchema.is_active = { type: 'boolean' };

const listSchema = {
  q: { type: 'string', maxLength: 100 },
  active: { type: 'boolean' },
  limit: { type: 'integer', min: 1, max: 200, default: 50 },
  offset: { type: 'integer', min: 0, default: 0 },
};

exports.list = [
  validateQuery(listSchema),
  async (req, res, next) => {
    try {
      res.json(await patientsService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.getById = async (req, res, next) => {
  try {
    res.json(await patientsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.stats = async (req, res, next) => {
  try {
    res.json(await patientsService.stats());
  } catch (err) {
    next(err);
  }
};

exports.create = [
  validateBody(createSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await patientsService.create(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.update = [
  validateBody(updateSchema),
  async (req, res, next) => {
    try {
      res.json(await patientsService.update(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.remove = async (req, res, next) => {
  try {
    res.json(await patientsService.remove(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};
