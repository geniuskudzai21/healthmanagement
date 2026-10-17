const ApiError = require('./ApiError');

const USER_ROLES = ['reception', 'nurse', 'clinician', 'admin'];

function requireFields(body, fields) {
  const missing = fields.filter((f) => {
    const v = body ? body[f] : undefined;
    return v === undefined || v === null || v === '';
  });
  if (missing.length) {
    throw ApiError.badRequest(`Missing required field(s): ${missing.join(', ')}`, { missing });
  }
}

function requireRole(role) {
  if (!USER_ROLES.includes(role)) {
    throw ApiError.badRequest(`Invalid role "${role}". Expected one of: ${USER_ROLES.join(', ')}`);
  }
}

function toPositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

module.exports = { requireFields, requireRole, toPositiveInt, USER_ROLES };
