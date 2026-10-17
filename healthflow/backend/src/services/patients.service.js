const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');
const { toPositiveInt } = require('../utils/validate');

async function list({ q, active, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      p.first_name ILIKE $${params.length}
      OR p.last_name ILIKE $${params.length}
      OR p.mrn ILIKE $${params.length}
      OR coalesce(p.phone, '') ILIKE $${params.length}
    )`);
  }
  if (active !== undefined && active !== '') {
    params.push(active === 'true' || active === true);
    where.push(`p.is_active = $${params.length}`);
  }
  params.push(toPositiveInt(limit, 50), toPositiveInt(offset, 0));
  const { rows } = await query(
    `
      SELECT p.*, u.full_name AS created_by_name
      FROM patients p
      LEFT JOIN users u ON u.id = p.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.last_name, p.first_name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await query(
    `
      SELECT p.*, u.full_name AS created_by_name
      FROM patients p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.id = $1
    `,
    [id]
  );
  if (!rows.length) throw ApiError.notFound(`Patient ${id} not found`);
  return rows[0];
}

async function stats() {
  const { rows } = await query(
    `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE is_active)::int AS active,
        count(*) FILTER (WHERE NOT is_active)::int AS inactive
      FROM patients
    `
  );
  return rows[0];
}

async function create(data, ctx = {}) {
  const {
    mrn,
    first_name,
    last_name,
    date_of_birth,
    sex = 'unknown',
    phone = null,
    email = null,
    address = null,
    blood_type = null,
    allergies = '',
    notes = null,
  } = data;

  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO patients
          (mrn, first_name, last_name, date_of_birth, sex, phone, email, address,
           blood_type, allergies, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
      `,
      [mrn, first_name, last_name, date_of_birth, sex, phone, email, address,
       blood_type, allergies, notes, ctx.actorId]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'patients',
      entityId: result.rows[0].id,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

const UPDATABLE = [
  'mrn', 'first_name', 'last_name', 'date_of_birth', 'sex', 'phone',
  'email', 'address', 'blood_type', 'allergies', 'notes', 'is_active',
];

async function update(id, data, ctx = {}) {
  const existing = await getById(id);
  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (data[key] === undefined) continue;
    params.push(data[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('No updatable fields supplied.');
  params.push(id);

  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE patients SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'patients',
      entityId: id,
      before: existing,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

async function remove(id, ctx = {}) {
  const existing = await getById(id);
  await withTransaction(async (client) => {
    await client.query('DELETE FROM patients WHERE id = $1', [id]);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'patients',
      entityId: id,
      before: existing,
      ip: ctx.ip,
    });
  });
  return { id: Number(id), deleted: true };
}

module.exports = { list, getById, stats, create, update, remove };
