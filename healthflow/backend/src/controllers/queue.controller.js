const queueService = require('../services/queue.service');
const { validateBody, validateQuery } = require('../middleware/validate');

const QUEUE_STATUSES = ['waiting', 'called', 'in_room', 'done', 'skipped', 'cancelled'];

exports.list = [
  validateQuery({
    area: { type: 'string', enum: queueService.AREAS },
    status: { type: 'string', enum: QUEUE_STATUSES },
    limit: { type: 'integer', min: 1, max: 500, default: 100 },
  }),
  async (req, res, next) => {
    try {
      res.json(await queueService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];

exports.summary = async (req, res, next) => {
  try {
    res.json(await queueService.summary());
  } catch (err) {
    next(err);
  }
};

exports.getById = async (req, res, next) => {
  try {
    res.json(await queueService.getById(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.enqueue = [
  validateBody({
    visit_id: { type: 'integer', required: true },
    area: { type: 'string', enum: queueService.AREAS, default: 'general' },
    priority: { type: 'integer', min: 1, max: 5, default: 3 },
  }),
  async (req, res, next) => {
    try {
      res.status(201).json(await queueService.enqueue(req.valid, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.callNext = [
  validateBody({ area: { type: 'string', enum: queueService.AREAS, default: 'general' } }),
  async (req, res, next) => {
    try {
      const called = await queueService.callNext({ area: req.valid.area }, res.locals.ctx);
      if (!called) return res.status(204).send();
      res.json(called);
    } catch (err) {
      next(err);
    }
  },
];

exports.setStatus = [
  validateBody({ status: { type: 'string', required: true, enum: QUEUE_STATUSES } }),
  async (req, res, next) => {
    try {
      res.json(await queueService.setStatus(req.params.id, req.valid.status, res.locals.ctx));
    } catch (err) {
      next(err);
    }
  },
];

exports.remove = async (req, res, next) => {
  try {
    res.json(await queueService.remove(req.params.id, res.locals.ctx));
  } catch (err) {
    next(err);
  }
};
