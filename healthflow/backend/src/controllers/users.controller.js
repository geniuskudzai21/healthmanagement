const usersService = require('../services/users.service');
const { validateBody, validateQuery, EMAIL_PATTERN } = require('../middleware/validate');
const { USER_ROLES } = require('../utils/validate');

const createSchema = {
  role: { type: 'string', required: true, enum: USER_ROLES },
  full_name: { type: 'string', required: true, maxLength: 120 },
  email: { type: 'string', required: true, pattern: EMAIL_PATTERN, patternMessage: 'must be a valid email' },
  password: { type: 'string', required: true, minLength: 8, maxLength: 200 },
  phone: { type: 'string', maxLength: 40 },
};

const updateSchema = {
  role: { type: 'string', enum: USER_ROLES },
  full_name: { type: 'string', maxLength: 120 },
  email: { type: 'string', pattern: EMAIL_PATTERN, patternMessage: 'must be a valid email' },
  password: { type: 'string', minLength: 8, maxLength: 200 },
  phone: { type: 'string', maxLength: 40 },
  is_active: { type: 'boolean' },
};

exports.list = [
  validateQuery({
    role: { type: 'string', enum: USER_ROLES },
    active: { type: 'boolean' },
  }),
  async (req, res, next) => {
    try {
      res.json(await usersService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.listClinicians = async (req, res, next) => {
  try {
    res.json(await usersService.listClinicians());
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    res.json(await usersService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.create = [
  validateBody(createSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await usersService.create(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.update = [
  validateBody(updateSchema),
  async (req, res, next) => {
    try {
      res.json(await usersService.update(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.remove = async (req, res, next) => {
  try {
    res.json(await usersService.remove(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};
