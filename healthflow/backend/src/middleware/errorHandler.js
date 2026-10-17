const ApiError = require('../utils/ApiError');

const PG_ERRORS = {
  '23505': [409, 'A record with these values already exists (unique constraint).'],
  '23503': [409, 'Referenced record does not exist or is still in use (foreign key).'],
  '23001': [409, 'Record is still referenced by other data and cannot be removed (FK RESTRICT).'],
  '23514': [400, 'Value violates a check constraint.'],
  '22P02': [400, 'Invalid input syntax (type mismatch).'],
  '22007': [400, 'Invalid date/time format.'],
  '22008': [400, 'Invalid date/time format.'],
};

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  const pg = PG_ERRORS[err.code];
  if (pg) {
    return res.status(pg[0]).json({ error: { message: pg[1], code: err.code } });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Malformed JSON body.' } });
  }

  console.error('[unhandled error]', err);
  return res.status(500).json({ error: { message: 'Internal server error.' } });
};
