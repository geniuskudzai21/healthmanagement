const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');
const rooms = require('./rooms.service');
const { toPositiveInt } = require('../utils/validate');

const STATUSES = ['registered', 'waiting', 'in_vitals', 'in_consult', 'completed', 'cancelled', 'no_show'];

const BASE_SELECT = `
  SELECT v.*,
         p.mrn, p.first_name AS patient_first_name, p.last_name AS patient_last_name, p.date_of_birth,
         cu.full_name AS clinician_name,
         r.code AS room_code, r.name AS room_name,
         au.full_name AS registered_by_name
  FROM visits v
  JOIN patients p ON p.id = v.patient_id
  LEFT JOIN users cu  ON cu.id  = v.clinician_id
  LEFT JOIN rooms r   ON r.id   = v.room_id
  LEFT JOIN users au  ON au.id  = v.registered_by
`;

async function list({ status, patient_id, clinician_id, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (status) {
    params.push(status);
    where.push(`v.status = $${params.length}`);
  }
  if (patient_id) {
    params.push(patient_id);
    where.push(`v.patient_id = $${params.length}`);
  }
  if (clinician_id) {
    params.push(clinician_id);
    where.push(`v.clinician_id = $${params.length}`);
  }
  params.push(toPositiveInt(limit, 100), toPositiveInt(offset, 0));
  const { rows } = await query(
    `${BASE_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY v.arrived_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await query(`${BASE_SELECT} WHERE v.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Visit ${id} not found`);
  const queue = await query('SELECT * FROM queue_entries WHERE visit_id = $1', [id]);
  return { ...rows[0], queue_entry: queue.rows[0] || null };
}

async function register(data, ctx = {}) {
  const {
    patient_id,
    clinician_id = null,
    room_id = null,
    appointment_id = null,
    visit_type = 'walk-in',
    chief_complaint = null,
    triage_level = null,
    enqueue = true,
    queue_area = 'general',
  } = data;

  return withTransaction(async (client) => {
    const patient = await client.query('SELECT id FROM patients WHERE id = $1', [patient_id]);
    if (!patient.rows.length) throw ApiError.notFound(`Patient ${patient_id} not found`);

    const visit = await client.query(
      `
        INSERT INTO visits
          (patient_id, clinician_id, room_id, registered_by, appointment_id,
           visit_type, status, chief_complaint, triage_level)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [patient_id, clinician_id, room_id, ctx.actorId, appointment_id,
       visit_type, enqueue ? 'waiting' : 'registered', chief_complaint, triage_level]
    );
    const created = visit.rows[0];

    let queueEntry = null;
    if (enqueue) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`queue:${queue_area}`]);
      const next = await client.query(
        'SELECT COALESCE(MAX(ticket_no), 0) + 1 AS next FROM queue_entries WHERE area = $1',
        [queue_area]
      );
      const q = await client.query(
        `
          INSERT INTO queue_entries (visit_id, area, ticket_no, priority)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
        [created.id, queue_area, next.rows[0].next, triage_level || 3]
      );
      queueEntry = q.rows[0];
    }

    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'visits',
      entityId: created.id,
      after: created,
      ip: ctx.ip,
    });

    return { ...created, queue_entry: queueEntry };
  });
}

async function updateStatus(id, status, ctx = {}) {
  if (!STATUSES.includes(status)) throw ApiError.badRequest(`Invalid visit status "${status}"`);
  const existing = await getById(id);

  const timestamps = [];
  if (['in_vitals', 'in_consult'].includes(status)) timestamps.push(`started_at = COALESCE(started_at, now())`);
  if (['completed', 'cancelled', 'no_show'].includes(status)) {
    timestamps.push(`completed_at = COALESCE(completed_at, now())`);
  }

  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE visits SET status = $2 ${timestamps.length ? `, ${timestamps.join(', ')}` : ''}
       WHERE id = $1 RETURNING *`,
      [id, status]
    );
    if (['cancelled', 'no_show'].includes(status)) {
      await client.query(
        `UPDATE queue_entries
         SET status = 'cancelled', finished_at = COALESCE(finished_at, now())
         WHERE visit_id = $1 AND status IN ('waiting', 'called', 'in_room')`,
        [id]
      );
    }
    if (['completed', 'cancelled', 'no_show'].includes(status) && existing.room_id) {
      await rooms.releaseRoom(client, existing.room_id);
    }
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'status_change',
      entity: 'visits',
      entityId: id,
      before: existing,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

async function assign(id, { clinician_id, room_id }, ctx = {}) {
  const existing = await getById(id);
  const nextClinician = clinician_id !== undefined ? clinician_id : existing.clinician_id;
  const nextRoom = room_id !== undefined ? room_id : existing.room_id;

  const { rows } = await withTransaction(async (client) => {
    if (existing.room_id && existing.room_id !== nextRoom) {
      await rooms.releaseRoom(client, existing.room_id);
    }
    if (nextRoom && nextRoom !== existing.room_id) {
      const room = await client.query('SELECT id, status FROM rooms WHERE id = $1 FOR UPDATE', [nextRoom]);
      if (!room.rows.length) throw ApiError.notFound(`Room ${nextRoom} not found`);
      if (room.rows[0].status === 'maintenance') {
        throw ApiError.conflict(`Room ${nextRoom} is under maintenance.`);
      }
      await client.query(`UPDATE rooms SET status = 'occupied' WHERE id = $1`, [nextRoom]);
    }
    const result = await client.query(
      `UPDATE visits SET clinician_id = $2, room_id = $3 WHERE id = $1 RETURNING *`,
      [id, nextClinician, nextRoom]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'visits',
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
    await client.query('DELETE FROM visits WHERE id = $1', [id]);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'visits',
      entityId: id,
      before: existing,
      ip: ctx.ip,
    });
  });
  return { id: Number(id), deleted: true };
}

module.exports = { list, getById, register, updateStatus, assign, remove, STATUSES };
