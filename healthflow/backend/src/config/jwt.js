const crypto = require('crypto');

const PRODUCTION = process.env.NODE_ENV === 'production';

let secret = process.env.JWT_SECRET;
if (!secret) {
  if (PRODUCTION) {
    throw new Error('JWT_SECRET must be set in production.');
  }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET not set - using an ephemeral dev secret (sessions die on restart).');
}

const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function parseExpiry(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value).trim());
  if (!match) return 8 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return n * unit;
}

const maxAgeMs = parseExpiry(EXPIRES_IN);
const secure = String(process.env.COOKIE_SECURE || (PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';

module.exports = {
  secret,
  expiresIn: EXPIRES_IN,
  maxAgeMs,
  cookieName: 'hf_token',
  cookieOptions: {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  },
};
