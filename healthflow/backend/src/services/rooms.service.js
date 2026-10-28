const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');

async function list({ status, type } = {}) {
  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (type) {
    params.push(type);
    where.push(`room_type = $${params.length}`);
  }
  const { rows } = await query(
    `
      SELECT * FROM rooms
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY code
    `,
    params
  );
  return rows;
}

async function listAvailable({ type } = {}) {
  const params = [];
  let clause = `status = 'available'`;
  if (type) {
    params.push(type);
    clause += ` AND room_type = $${params.length}`;
  }
  const { rows } = await query(`SELECT * FROM rooms WHERE ${clause} ORDER BY code`, params);
  return rows;
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM rooms WHERE id = $1', [id]);
  if (!rows.length) throw ApiError.notFound(`Room ${id} not found`);
  return rows[0];
}

async function create(data, ctx = {}) {
  const { code, name, room_type = 'consult', status = 'available', floor = null, notes = null } = data;
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO rooms (code, name, room_type, status, floor, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [code, name, room_type, status, floor, notes]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'rooms',
      entityId: result.rows[0].id,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

const UPDATABLE = ['code', 'name', 'room_type', 'status', 'floor', 'notes'];

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
      `UPDATE rooms SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'rooms',
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
    await client.query('DELETE FROM rooms WHERE id = $1', [id]);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'rooms',
      entityId: id,
      before: existing,
      ip: ctx.ip,
    });
  });
  return { id: Number(id), deleted: true };
}

/** Free a room inside an existing transaction (used on visit/queue completion). */
async function releaseRoom(client, roomId) {
  if (!roomId) return;
  await client.query(
    `UPDATE rooms SET status = 'available' WHERE id = $1 AND status = 'occupied'`,
    [roomId]
  );
}

/**
 * Route a visit to a free room. Picks the next available room (matching the
 * requested type when supplied), marks it occupied and links it to the visit.
 */
async function routeVisit(visitId, { room_type = 'consult' } = {}, ctx = {}) {
  const roomType = 'consult';
  return withTransaction(async (client) => {
    const visitRes = await client.query(
      'SELECT id, room_id, status FROM visits WHERE id = $1 FOR UPDATE',
      [visitId]
    );
    if (!visitRes.rows.length) throw ApiError.notFound(`Visit ${visitId} not found`);
    const visit = visitRes.rows[0];
    if (['completed', 'cancelled', 'no_show'].includes(visit.status)) {
      throw ApiError.conflict(`Visit ${visitId} is ${visit.status} and cannot be routed.`);
    }

    const roomRes = await client.query(
      `
        SELECT id, code, name, room_type FROM rooms
        WHERE status = 'available' AND room_type = $1
        ORDER BY code
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [roomType]
    );
    if (!roomRes.rows.length) {
      throw ApiError.conflict(`No available ${roomType} room right now.`, { room_type: roomType });
    }
    const room = roomRes.rows[0];

    // Release any previously held room before reassigning.
    if (visit.room_id && visit.room_id !== room.id) {
      await releaseRoom(client, visit.room_id);
    }

    await client.query(`UPDATE rooms SET status = 'occupied' WHERE id = $1`, [room.id]);
    const updated = await client.query(
      'UPDATE visits SET room_id = $2 WHERE id = $1 RETURNING *',
      [visitId, room.id]
    );

    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'visits',
      entityId: visitId,
      before: { room_id: visit.room_id },
      after: { room_id: room.id, room_code: room.code },
      ip: ctx.ip,
    });

    return { visit: updated.rows[0], room };
  });
}

/** Manually mark a room available and detach it from any open visits. */
async function release(id, ctx = {}) {
  const existing = await getById(id);
  return withTransaction(async (client) => {
    const room = await client.query(
      `UPDATE rooms SET status = 'available' WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query(
      `UPDATE visits SET room_id = NULL
       WHERE room_id = $1 AND status NOT IN ('completed', 'cancelled', 'no_show')`,
      [id]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'status_change',
      entity: 'rooms',
      entityId: id,
      before: existing,
      after: room.rows[0],
      ip: ctx.ip,
    });
    return room.rows[0];
  });
}

module.exports = { list, listAvailable, getById, create, update, remove, routeVisit, releaseRoom, release };
