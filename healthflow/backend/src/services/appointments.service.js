const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');
const rooms = require('./rooms.service');

const STATUSES = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];

// Appointments feed the walk-in queue: checking in opens a visit and issues a ticket.
const QUEUE_AREA = 'general';

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
    let visit = null;
    let queued = false;

    if (status === 'checked_in') {
      // Reuse an open visit for this appointment, otherwise create one and
      // enqueue a ticket so the patient shows up in the live queue.
      const found = await client.query(
        `SELECT * FROM visits
         WHERE appointment_id = $1 AND status NOT IN ('completed', 'cancelled', 'no_show')
         ORDER BY id DESC LIMIT 1`,
        [id]
      );
      visit = found.rows[0] || null;

      if (!visit) {
        const created = await client.query(
          `INSERT INTO visits
             (patient_id, clinician_id, room_id, registered_by, appointment_id,
              visit_type, status, chief_complaint)
           VALUES ($1, $2, $3, $4, $5, 'appointment', 'waiting', $6)
           RETURNING *`,
          [existing.patient_id, existing.clinician_id, existing.room_id, ctx.actorId, id, existing.reason]
        );
        visit = created.rows[0];

        if (visit.room_id) {
          await client.query(
            `UPDATE rooms SET status = 'occupied' WHERE id = $1 AND status = 'available'`,
            [visit.room_id]
          );
        }

        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`queue:${QUEUE_AREA}`]);
        const next = await client.query(
          'SELECT COALESCE(MAX(ticket_no), 0) + 1 AS next FROM queue_entries WHERE area = $1',
          [QUEUE_AREA]
        );
        await client.query(
          `INSERT INTO queue_entries (visit_id, area, ticket_no, priority)
           VALUES ($1, $2, $3, $4)`,
          [visit.id, QUEUE_AREA, next.rows[0].next, 3]
        );
        queued = true;

        await audit.record(client, {
          actorId: ctx.actorId,
          action: 'create',
          entity: 'visits',
          entityId: visit.id,
          after: visit,
          ip: ctx.ip,
        });
      }
    } else if (['completed', 'cancelled', 'no_show'].includes(status)) {
      // Keep the linked visit and queue ticket in step with the appointment.
      const visitStatus = status;
      const closed = await client.query(
        `UPDATE visits
         SET status = $2, completed_at = COALESCE(completed_at, now())
         WHERE appointment_id = $1 AND status NOT IN ('completed', 'cancelled', 'no_show')
         RETURNING id, room_id`,
        [id, visitStatus]
      );
      for (const row of closed.rows) {
        await client.query(
          `UPDATE queue_entries
           SET status = $2, finished_at = COALESCE(finished_at, now())
           WHERE visit_id = $1 AND status IN ('waiting', 'called', 'in_room')`,
          [row.id, status === 'completed' ? 'done' : 'cancelled']
        );
        if (row.room_id) await rooms.releaseRoom(client, row.room_id);
      }
    }

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
    return { rows: [{ ...result.rows[0], visit_id: visit ? visit.id : null, queued }] };
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
