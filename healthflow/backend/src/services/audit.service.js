const { query } = require('../config/db');
const { toPositiveInt } = require('../utils/validate');

async function record(client, entry) {
  await client.query(
    `
      INSERT INTO audit_logs (actor_id, action, entity, entity_id, before_data, after_data, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      entry.actorId ?? null,
      entry.action,
      entry.entity,
      entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      entry.before ?? null,
      entry.after ?? null,
      entry.ip ?? null,
    ]
  );
}

async function list({ entity, actor_id, action, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (entity) {
    params.push(entity);
    where.push(`a.entity = $${params.length}`);
  }
  if (actor_id) {
    params.push(actor_id);
    where.push(`a.actor_id = $${params.length}`);
  }
  if (action) {
    params.push(action);
    where.push(`a.action = $${params.length}`);
  }
  params.push(toPositiveInt(limit, 100), toPositiveInt(offset, 0));
  const { rows } = await query(
    `
      SELECT a.*, u.full_name AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return rows;
}

module.exports = { record, list };
