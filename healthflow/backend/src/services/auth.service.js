const jwt = require('jsonwebtoken');
const { query } = require('../config/db');
const jwtConfig = require('../config/jwt');
const ApiError = require('../utils/ApiError');
const { hashPassword, verifyPassword } = require('../utils/password');
const audit = require('./audit.service');
const { withTransaction } = require('../config/db');

const USER_COLUMNS = 'id, role, full_name, email, phone, is_active, last_login_at, password_changed_at, created_at';

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    jwtConfig.secret,
    { expiresIn: jwtConfig.expiresIn }
  );
}

async function authenticate(email, password) {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [String(email).trim().toLowerCase()]
  );
  const user = rows[0];
  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiError(401, 'Invalid email or password.');
  }
  return user;
}

async function login(email, password, ctx = {}) {
  const user = await authenticate(email, password);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  await withTransaction(async (client) => {
    await audit.record(client, {
      actorId: user.id,
      action: 'login',
      entity: 'users',
      entityId: user.id,
      ip: ctx.ip,
    });
  });
  const { password_hash, ...safe } = user;
  return { token: signToken(user), user: safe };
}

async function me(userId) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);
  if (!rows.length) throw ApiError.notFound('User not found');
  return rows[0];
}

async function changePassword(userId, currentPassword, newPassword, ctx = {}) {
  if (String(newPassword).length < 8) {
    throw ApiError.badRequest('New password must be at least 8 characters.');
  }
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE id = $1`,
    [userId]
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    throw ApiError.badRequest('Current password is incorrect.');
  }
  const newHash = await hashPassword(newPassword);
  const updated = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users
       SET password_hash = $2, password_changed_at = now()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [userId, newHash]
    );
    await audit.record(client, {
      actorId: userId,
      action: 'update',
      entity: 'users',
      entityId: userId,
      after: { password_changed: true },
      ip: ctx.ip,
    });
    return result.rows[0];
  });
  return { token: signToken(updated), user: updated };
}

module.exports = { login, me, changePassword, signToken };
