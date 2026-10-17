const bcrypt = require('bcrypt');

const ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

function hashPassword(plain) {
  return bcrypt.hash(String(plain), ROUNDS);
}

function verifyPassword(plain, stored) {
  if (!stored) return Promise.resolve(false);
  return bcrypt.compare(String(plain), stored);
}

module.exports = { hashPassword, verifyPassword };
