const ApiError = require('../utils/ApiError');

const COERCERS = {
  string: (v) => String(v),
  text: (v) => String(v),
  integer: (v) => {
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
  },
  number: (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  },
  boolean: (v) => {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1' || v === 1) return true;
    if (v === 'false' || v === '0' || v === 0) return false;
    return NaN;
  },
  date: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v)) ? String(v) : NaN),
  timestamp: (v) => {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? NaN : d.toISOString();
  },
  array: (v) => (Array.isArray(v) ? v : NaN),
};

function buildValidator(schema, source, target) {
  return (req, res, next) => {
    const input = req[source] || {};
    const errors = {};
    const out = {};

    for (const [field, rule] of Object.entries(schema)) {
      let value = input[field];

      if (value === undefined || value === null || value === '') {
        if (rule.required) errors[field] = 'is required';
        else if (rule.default !== undefined) out[field] = rule.default;
        continue;
      }

      const coerce = COERCERS[rule.type || 'string'];
      value = coerce(value);

      if (typeof value === 'number' && Number.isNaN(value)) {
        errors[field] = `must be a valid ${rule.type || 'string'}`;
        continue;
      }

      if (rule.enum && !rule.enum.includes(value)) {
        errors[field] = `must be one of: ${rule.enum.join(', ')}`;
        continue;
      }
      if (rule.type === 'integer' || rule.type === 'number') {
        if (rule.min !== undefined && value < rule.min) errors[field] = `must be >= ${rule.min}`;
        if (rule.max !== undefined && value > rule.max) errors[field] = `must be <= ${rule.max}`;
      }
      if (typeof value === 'string') {
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          errors[field] = `must be at least ${rule.minLength} characters`;
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          errors[field] = `must be at most ${rule.maxLength} characters`;
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          errors[field] = rule.patternMessage || 'has an invalid format';
        }
      }
      if (Array.isArray(value) && rule.maxItems && value.length > rule.maxItems) {
        errors[field] = `must have at most ${rule.maxItems} items`;
      }

      if (!errors[field]) out[field] = value;
    }

    if (Object.keys(errors).length) {
      return next(ApiError.badRequest('Validation failed', { fields: errors }));
    }

    req[target] = out;
    return next();
  };
}

const validateBody = (schema) => buildValidator(schema, 'body', 'valid');
const validateQuery = (schema) => buildValidator(schema, 'query', 'validQuery');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = { validateBody, validateQuery, EMAIL_PATTERN, ISO_DATE };
