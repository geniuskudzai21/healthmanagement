const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');

const STATUSES = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];

const BASE_SELECT = `
  SELECT a.*,
         p.mrn, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
         u.full_name AS clinician_name,
         r.code AS room_code, r.name AS room_name
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN users u    ON u.id = a.clinician_id
  LEFT JOIN rooms r ON r.id = a.room_id
`;

async function findConflicts(client, { id = null, clinician_id, room_id, scheduled_start, scheduled_end }) {
  const params = [scheduled_start, scheduled_end];
  let sql = `
    SELECT id, clinician_id, room_id, scheduled_start, scheduled_end, status
    FROM appointments
    WHERE status <> 'cancelled'
      AND scheduled_start < $2 AND scheduled_end > $1
  `;
  if (id) {
    params.push(id);
    sql += ` AND id <> $${params.length}`;
  }
  if (clinician_id) {
    params.push(clinician_id);
    sql += ` AND clinician_id = $${params.length}`;
  }
  if (room_id) {
    params.push(room_id);
    sql += ` AND room_id = $${params.length}`;
  }
  const { rows } = await client.query(sql, params);
  return rows;
}

async function list({ from, to, clinician_id, patient_id, status } = {}) {
  const params = [];
  const where = [];
  if (from) {
    params.push(from);
    where.push(`a.scheduled_start >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`a.scheduled_start < $${params.length}`);
  }
  if (clinician_id) {
    params.push(clinician_id);
    where.push(`a.clinician_id = $${params.length}`);
  }
  if (patient_id) {
    params.push(patient_id);
    where.push(`a.patient_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  const { rows } = await query(
    `${BASE_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.scheduled_start`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await query(`${BASE_SELECT} WHERE a.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Appointment ${id} not found`);
  return rows[0];
}

async function assertWindow(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    throw ApiError.badRequest('scheduled_start and scheduled_end must be valid timestamps.');
  }
  if (e <= s) {
    throw ApiError.badRequest('scheduled_end must be after scheduled_start.');
  }
}

function conflictError(conflicts) {
  return ApiError.conflict(
    'Slot is already booked (double-booking prevented). Choose another time, clinician or room.',
    { conflicts }
  );
}

async function create(data, ctx = {}) {
  const {
    patient_id,
    clinician_id,
    room_id = null,
    scheduled_start,
    scheduled_end,
    reason = null,
    notes = null,
    status = 'scheduled',
  } = data;

  await assertWindow(scheduled_start, scheduled_end);

  try {
    return await withTransaction(async (client) => {
      const patient = await client.query('SELECT id FROM patients WHERE id = $1', [patient_id]);
      if (!patient.rows.length) throw ApiError.notFound(`Patient ${patient_id} not found`);
      const clinician = await client.query(
        `SELECT id FROM users WHERE id = $1 AND role = 'clinician' AND is_active`,
        [clinician_id]
      );
      if (!clinician.rows.length) throw ApiError.badRequest(`Clinician ${clinician_id} not found or inactive`);

      const conflicts = await findConflicts(client, {
        clinician_id,
        room_id,
        scheduled_start,
        scheduled_end,
      });
      if (conflicts.length) throw conflictError(conflicts);

      const result = await client.query(
        `
          INSERT INTO appointments
            (patient_id, clinician_id, room_id, scheduled_start, scheduled_end,
             reason, notes, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `,
        [patient_id, clinician_id, room_id, scheduled_start, scheduled_end,
         reason, notes, ctx.actorId]
      );
      await audit.record(client, {
        actorId: ctx.actorId,
        action: 'create',
        entity: 'appointments',
        entityId: result.rows[0].id,
        after: result.rows[0],
        ip: ctx.ip,
      });
      return result.rows[0];
    });
  } catch (err) {
    if (err.code === '23505') throw conflictError([{ reason: err.detail }]);
    throw err;
  }
}

const UPDATABLE = ['patient_id', 'clinician_id', 'room_id', 'scheduled_start', 'scheduled_end', 'reason', 'notes', 'status'];

async function update(id, data, ctx = {}) {
  const existing = await getById(id);
  if (data.status && !STATUSES.includes(data.status)) {
    throw ApiError.badRequest(`Invalid status "${data.status}"`);
  }

  const scheduled_start = data.scheduled_start || existing.scheduled_start;
  const scheduled_end = data.scheduled_end || existing.scheduled_end;
  await assertWindow(scheduled_start, scheduled_end);

  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (data[key] === undefined) continue;
    params.push(data[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('No updatable fields supplied.');

  try {
    const { rows } = await withTransaction(async (client) => {
      const conflicts = await findConflicts(client, {
        id,
        clinician_id: data.clinician_id || existing.clinician_id,
        room_id: data.room_id !== undefined ? data.room_id : existing.room_id,
        scheduled_start,
        scheduled_end,
      });
      if (conflicts.length) throw conflictError(conflicts);

      params.push(id);
      const result = await client.query(
        `UPDATE appointments SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      await audit.record(client, {
        actorId: ctx.actorId,
        action: 'update',
        entity: 'appointments',
        entityId: id,
        before: existing,
        after: result.rows[0],
        ip: ctx.ip,
      });
      return result;
    });
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw conflictError([{ reason: err.detail }]);
    throw err;
  }
}

async function setStatus(id, status, ctx = {}) {
  if (!STATUSES.includes(status)) throw ApiError.badRequest(`Invalid status "${status}"`);
  const existing = await getById(id);
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      'UPDATE appointments SET status = $2 WHERE id = $1 RETURNING *',
      [id, status]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'status_change',
      entity: 'appointments',
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
    await client.query('DELETE FROM appointments WHERE id = $1', [id]);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'appointments',
      entityId: id,
      before: existing,
      ip: ctx.ip,
    });
  });
  return { id: Number(id), deleted: true };
}

module.exports = { list, getById, create, update, setStatus, remove, STATUSES };
