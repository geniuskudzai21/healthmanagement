const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');
const rooms = require('./rooms.service');

const AREAS = ['general', 'vitals', 'consult'];
const QUEUE_STATUSES = ['waiting', 'called', 'in_room', 'done', 'skipped', 'cancelled'];

const VISIT_STATUS_FOR_QUEUE = {
  in_room: { general: 'waiting', vitals: 'in_vitals', consult: 'in_consult' },
};

async function list({ area, status, limit = 100 } = {}) {
  const params = [];
  const where = [];
  if (area) {
    params.push(area);
    where.push(`q.area = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`q.status = $${params.length}`);
  }
  params.push(Math.min(parseInt(limit, 10) || 100, 500));
  const { rows } = await query(
    `
      SELECT q.*,
             EXTRACT(EPOCH FROM (COALESCE(q.called_at, q.finished_at, now()) - q.created_at))::int AS wait_seconds,
             EXTRACT(EPOCH FROM (COALESCE(q.finished_at, now()) - q.created_at))::int AS in_queue_seconds,
             CASE WHEN q.called_at IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (COALESCE(q.finished_at, now()) - q.called_at))::int
                  ELSE NULL END AS service_seconds,
             v.status  AS visit_status,
             v.chief_complaint,
             v.triage_level,
             p.mrn, p.first_name, p.last_name, p.date_of_birth,
             u.full_name AS clinician_name
      FROM queue_entries q
      JOIN visits v    ON v.id = q.visit_id
      JOIN patients p  ON p.id = v.patient_id
      LEFT JOIN users u ON u.id = v.clinician_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE q.status WHEN 'waiting' THEN 0 WHEN 'called' THEN 1 WHEN 'in_room' THEN 2 ELSE 3 END,
        q.priority ASC, q.ticket_no ASC
      LIMIT $${params.length}
    `,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await query('SELECT * FROM queue_entries WHERE id = $1', [id]);
  if (!rows.length) throw ApiError.notFound(`Queue entry ${id} not found`);
  return rows[0];
}

async function summary() {
  const totals = await query(
    `
      SELECT
        count(*) FILTER (WHERE status = 'waiting')::int  AS waiting,
        count(*) FILTER (WHERE status = 'called')::int   AS called,
        count(*) FILTER (WHERE status = 'in_room')::int  AS in_room,
        count(*) FILTER (WHERE status = 'done')::int     AS done,
        count(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS arrived_today,
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(called_at, finished_at, now()) - created_at))))::int, 0) AS avg_wait_seconds,
        COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (COALESCE(called_at, finished_at, now()) - created_at))))::int, 0) AS median_wait_seconds,
        COALESCE(MAX(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (
          WHERE status IN ('waiting', 'called')), 0)::int AS longest_wait_seconds
      FROM queue_entries
      WHERE created_at::date = CURRENT_DATE OR status IN ('waiting', 'called', 'in_room')
    `
  );

  const byArea = await query(
    `
      SELECT area,
        count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
        count(*) FILTER (WHERE status = 'called')::int  AS called,
        count(*) FILTER (WHERE status = 'in_room')::int AS in_room,
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(called_at, finished_at, now()) - created_at))))::int, 0) AS avg_wait_seconds
      FROM queue_entries
      WHERE created_at::date = CURRENT_DATE OR status IN ('waiting', 'called', 'in_room')
      GROUP BY area
      ORDER BY area
    `
  );

  return { ...totals.rows[0], by_area: byArea.rows, generated_at: new Date().toISOString() };
}

async function enqueue({ visit_id, area = 'general', priority = 3 }, ctx = {}) {
  if (!AREAS.includes(area)) throw ApiError.badRequest(`Invalid area "${area}"`);
  return withTransaction(async (client) => {
    const visit = await client.query('SELECT id, status FROM visits WHERE id = $1', [visit_id]);
    if (!visit.rows.length) throw ApiError.notFound(`Visit ${visit_id} not found`);

    // Serialize ticket allocation per area.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`queue:${area}`]);

    const next = await client.query(
      'SELECT COALESCE(MAX(ticket_no), 0) + 1 AS next FROM queue_entries WHERE area = $1',
      [area]
    );
    const ticketNo = next.rows[0].next;

    const result = await client.query(
      `
        INSERT INTO queue_entries (visit_id, area, ticket_no, priority)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [visit_id, area, ticketNo, priority]
    );

    if (visit.rows[0].status === 'registered') {
      await client.query(`UPDATE visits SET status = 'waiting' WHERE id = $1`, [visit_id]);
    }

    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'enqueue',
      entity: 'queue_entries',
      entityId: result.rows[0].id,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result.rows[0];
  });
}

async function callNext({ area = 'general' }, ctx = {}) {
  if (!AREAS.includes(area)) throw ApiError.badRequest(`Invalid area "${area}"`);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `
        UPDATE queue_entries
        SET status = 'called', called_at = COALESCE(called_at, now())
        WHERE id = (
          SELECT id
          FROM queue_entries
          WHERE area = $1 AND status = 'waiting'
          ORDER BY priority ASC, ticket_no ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `,
      [area]
    );
    if (!rows.length) return null;

    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'call',
      entity: 'queue_entries',
      entityId: rows[0].id,
      after: rows[0],
      ip: ctx.ip,
    });
    return rows[0];
  });
}

async function setStatus(id, status, ctx = {}) {
  if (!QUEUE_STATUSES.includes(status)) {
    throw ApiError.badRequest(`Invalid queue status "${status}"`);
  }
  const existing = await getById(id);

  return withTransaction(async (client) => {
    const timestamps =
      status === 'in_room'
        ? ', seated_at = COALESCE(seated_at, now())'
        : status === 'done' || status === 'skipped' || status === 'cancelled'
          ? ', finished_at = COALESCE(finished_at, now())'
          : '';

    const { rows } = await client.query(
      `UPDATE queue_entries SET status = $2 ${timestamps} WHERE id = $1 RETURNING *`,
      [id, status]
    );

    const visitStatus = VISIT_STATUS_FOR_QUEUE[status] && VISIT_STATUS_FOR_QUEUE[status][existing.area];
    if (visitStatus) {
      await client.query(
        `UPDATE visits
         SET status = $2,
             started_at = CASE WHEN $2 = 'in_consult' THEN COALESCE(started_at, now()) ELSE started_at END
         WHERE id = $1 AND status NOT IN ('completed', 'cancelled')`,
        [existing.visit_id, visitStatus]
      );
    } else if (status === 'done') {
      const visit = await client.query(
        `UPDATE visits
         SET status = 'completed', completed_at = COALESCE(completed_at, now())
         WHERE id = $1 AND status NOT IN ('completed', 'cancelled')
         RETURNING room_id`,
        [existing.visit_id]
      );
      if (visit.rows[0] && visit.rows[0].room_id) {
        await rooms.releaseRoom(client, visit.rows[0].room_id);
      }
    }

    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'status_change',
      entity: 'queue_entries',
      entityId: id,
      before: existing,
      after: rows[0],
      ip: ctx.ip,
    });
    return rows[0];
  });
}

async function remove(id, ctx = {}) {
  const existing = await getById(id);
  await withTransaction(async (client) => {
    await client.query('DELETE FROM queue_entries WHERE id = $1', [id]);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'queue_entries',
      entityId: id,
      before: existing,
      ip: ctx.ip,
    });
  });
  return { id: Number(id), deleted: true };
}

module.exports = { list, getById, summary, enqueue, callNext, setStatus, remove, AREAS };
