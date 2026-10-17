const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { hashPassword } = require('../utils/password');
const { USER_ROLES } = require('../utils/validate');
const audit = require('./audit.service');

const PUBLIC_COLUMNS = 'id, role, full_name, email, phone, is_active, last_login_at, created_at, updated_at';

async function list({ role, active } = {}) {
  const where = [];
  const params = [];
  if (role) {
    if (!USER_ROLES.includes(role)) throw ApiError.badRequest(`Invalid role "${role}"`);
    params.push(role);
    where.push(`role = $${params.length}`);
  }
  if (active !== undefined && active !== '') {
    params.push(active === 'true' || active === true);
    where.push(`is_active = $${params.length}`);
  }
  const sql = `
    SELECT ${PUBLIC_COLUMNS}
    FROM users
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY full_name
  `;
  const { rows } = await query(sql, params);
  return rows;
}

async function listClinicians() {
  const { rows } = await query(
    `SELECT id, full_name, email
     FROM users
     WHERE role = 'clinician' AND is_active
     ORDER BY full_name`
  );
  return rows;
}

async function getById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`User ${id} not found`);
  return rows[0];
}

async function create(data, ctx = {}) {
  const { role, full_name, email, password, phone = null } = data;
  if (!USER_ROLES.includes(role)) {
    throw ApiError.badRequest(`Invalid role "${role}". Expected one of: ${USER_ROLES.join(', ')}`);
  }
  if (!password || String(password).length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters.');
  }
  const passwordHash = await hashPassword(password);
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO users (role, full_name, email, password_hash, phone)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ${PUBLIC_COLUMNS}
      `,
      [role, full_name, email.trim().toLowerCase(), passwordHash, phone]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'users',
      entityId: result.rows[0].id,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

const UPDATABLE = ['role', 'full_name', 'email', 'phone', 'is_active', 'password'];

async function update(id, data, ctx = {}) {
  const existing = await getById(id);
  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (data[key] === undefined) continue;
    if (key === 'password') {
      if (!data[key]) continue;
      if (String(data[key]).length < 8) {
        throw ApiError.badRequest('Password must be at least 8 characters.');
      }
      params.push(await hashPassword(data[key]));
      sets.push(`password_hash = $${params.length}`);
      sets.push('password_changed_at = now()');
      continue;
    }
    if (key === 'role' && !USER_ROLES.includes(data[key])) {
      throw ApiError.badRequest(`Invalid role "${data[key]}"`);
    }
    params.push(key === 'email' ? String(data[key]).trim().toLowerCase() : data[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('No updatable fields supplied.');

  params.push(id);
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${PUBLIC_COLUMNS}`,
      params
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'users',
      entityId: id,
      before: existing,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

async function deactivate(id, ctx = {}) {
  const existing = await getById(id);
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [id]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'users',
      entityId: id,
      before: existing,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

module.exports = { list, listClinicians, getById, create, update, deactivate };
