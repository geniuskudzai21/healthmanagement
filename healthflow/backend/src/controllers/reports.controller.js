const reportsService = require('../services/reports.service');
const { validateQuery } = require('../middleware/validate');

exports.daily = [
  validateQuery({ date: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: 'must be YYYY-MM-DD' } }),
  async (req, res, next) => {
    try {
      res.json(await reportsService.daily(req.validQuery.date));
    } catch (err) {
      next(err);
    }
  },
];

exports.monthly = [
  validateQuery({ month: { type: 'string', pattern: /^\d{4}-\d{2}$/, patternMessage: 'must be YYYY-MM' } }),
  async (req, res, next) => {
    try {
      res.json(await reportsService.monthly(req.validQuery.month));
    } catch (err) {
      next(err);
    }
  },
];
