const jwt = require('jsonwebtoken');
const jwtConfig = require('../config/jwt');
const ApiError = require('../utils/ApiError');
const { query } = require('../config/db');

function extractToken(req) {
  if (req.cookies && req.cookies[jwtConfig.cookieName]) {
    return { token: req.cookies[jwtConfig.cookieName], via: 'cookie' };
  }
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) {
    return { token: header.slice(7), via: 'bearer' };
  }
  return { token: null, via: null };
}

async function requireAuth(req, res, next) {
  try {
    const { token } = extractToken(req);
    if (!token) throw new ApiError(401, 'Authentication required.');

    let payload;
    try {
      payload = jwt.verify(token, jwtConfig.secret);
    } catch (err) {
      throw new ApiError(401, 'Invalid or expired session. Please log in again.');
    }

    const { rows } = await query(
      `SELECT id, role, email, full_name, is_active, password_changed_at
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      throw new ApiError(401, 'Account is unknown or deactivated.');
    }
    // Reject tokens issued before the most recent password change.
    if (user.password_changed_at && payload.iat * 1000 < new Date(user.password_changed_at).getTime()) {
      throw new ApiError(401, 'Password was changed. Please log in again.');
    }

    req.user = { id: user.id, role: user.role, email: user.email, name: user.full_name };
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, `Forbidden: requires role ${roles.join(' or ')}.`));
    }
    return next();
  };
}

const ALL_ROLES = ['reception', 'nurse', 'clinician', 'admin'];

module.exports = { requireAuth, requireRole, ALL_ROLES };
