const roomsService = require('../services/rooms.service');
const { validateBody, validateQuery } = require('../middleware/validate');

const ROOM_TYPES = ['consult'];
const ROOM_STATUS = ['available', 'occupied', 'maintenance', 'reserved'];

const createSchema = {
  code: { type: 'string', required: true, maxLength: 30 },
  name: { type: 'string', required: true, maxLength: 100 },
  room_type: { type: 'string', enum: ROOM_TYPES, default: 'consult' },
  status: { type: 'string', enum: ROOM_STATUS, default: 'available' },
  floor: { type: 'string', maxLength: 30 },
  notes: { type: 'string', maxLength: 1000 },
};

const updateSchema = Object.fromEntries(
  Object.entries(createSchema).map(([key, rule]) => [key, { ...rule, required: false }])
);
delete updateSchema.code.default;
delete updateSchema.status.default;
delete updateSchema.room_type.default;

const listSchema = {
  status: { type: 'string', enum: ROOM_STATUS },
  type: { type: 'string', enum: ROOM_TYPES },
};

exports.list = [
  validateQuery(listSchema),
  async (req, res, next) => {
    try {
      res.json(await roomsService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.listAvailable = [
  validateQuery({ type: { type: 'string', enum: ROOM_TYPES } }),
  async (req, res, next) => {
    try {
      res.json(await roomsService.listAvailable({ type: req.validQuery.type }));
    } catch (err) {
      next(err);
    }
  },
];

exports.getById = async (req, res, next) => {
  try {
    res.json(await roomsService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.create = [
  validateBody(createSchema),
  async (req, res, next) => {
    try {
      res.status(201).json(await roomsService.create(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.update = [
  validateBody(updateSchema),
  async (req, res, next) => {
    try {
      res.json(await roomsService.update(req.params.id, req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.remove = async (req, res, next) => {
  try {
    res.json(await roomsService.remove(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};

exports.route = [
  validateBody({
    visit_id: { type: 'integer', required: true },
    room_type: { type: 'string', enum: ROOM_TYPES, default: 'consult' },
  }),
  async (req, res, next) => {
    try {
      res.json(await roomsService.routeVisit(req.valid.visit_id, { room_type: 'consult' }, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.release = async (req, res, next) => {
  try {
    res.json(await roomsService.release(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};
