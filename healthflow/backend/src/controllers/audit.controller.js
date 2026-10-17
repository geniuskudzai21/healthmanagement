const auditService = require('../services/audit.service');
const { validateQuery } = require('../middleware/validate');

exports.list = [
  validateQuery({
    entity: { type: 'string', maxLength: 50 },
    actor_id: { type: 'integer' },
    action: { type: 'string', maxLength: 30 },
    limit: { type: 'integer', min: 1, max: 500, default: 100 },
    offset: { type: 'integer', min: 0, default: 0 },
  }),
  async (req, res, next) => {
    try {
      res.json(await auditService.list(req.validQuery));
    } catch (err) {
      next(err);
    }
  },
];
