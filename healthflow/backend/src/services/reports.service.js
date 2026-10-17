const { query } = require('../config/db');
const ApiError = require('../utils/ApiError');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const VISIT_TOTALS = `
  count(*)::int                                                     AS total,
  count(*) FILTER (WHERE status = 'completed')::int                 AS completed,
  count(*) FILTER (WHERE status = 'cancelled')::int                 AS cancelled,
  count(*) FILTER (WHERE status = 'no_show')::int                   AS no_show,
  count(*) FILTER (WHERE status IN ('registered','waiting','in_vitals','in_consult'))::int AS open,
  count(*) FILTER (WHERE visit_type = 'walk-in')::int               AS walk_ins,
  count(*) FILTER (WHERE visit_type = 'appointment')::int           AS from_appointments
`;

const APPOINTMENT_TOTALS = `
  count(*)::int                                        AS total,
  count(*) FILTER (WHERE status = 'completed')::int    AS completed,
  count(*) FILTER (WHERE status = 'checked_in')::int   AS checked_in,
  count(*) FILTER (WHERE status = 'cancelled')::int    AS cancelled,
  count(*) FILTER (WHERE status = 'no_show')::int      AS no_show
`;

const QUEUE_TOTALS = `
  count(*) FILTER (WHERE called_at IS NOT NULL)::int AS served,
  COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (called_at - created_at))))::int, 0) AS avg_wait_seconds,
  COALESCE(ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (called_at - created_at))))::int, 0) AS median_wait_seconds,
  COALESCE(MAX(EXTRACT(EPOCH FROM (called_at - created_at)))::int, 0) AS max_wait_seconds,
  COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - created_at))))::int, 0) AS avg_total_seconds
`;

async function daily(date) {
  const day = date || todayIso();
  if (!DATE_RE.test(day)) throw ApiError.badRequest('date must be in YYYY-MM-DD format.');

  const [visits, appointments, queue, hourly, byClinician, rooms, newPatients, billing] = await Promise.all([
    query(`SELECT ${VISIT_TOTALS} FROM visits WHERE arrived_at::date = $1`, [day]),
    query(`SELECT ${APPOINTMENT_TOTALS} FROM appointments WHERE scheduled_start::date = $1`, [day]),
    query(`SELECT ${QUEUE_TOTALS} FROM queue_entries WHERE created_at::date = $1`, [day]),
    query(
      `SELECT to_char(date_trunc('hour', arrived_at), 'HH24:00') AS hour, count(*)::int AS visits
       FROM visits WHERE arrived_at::date = $1
       GROUP BY 1 ORDER BY 1`,
      [day]
    ),
    query(
      `SELECT u.id, u.full_name, count(*)::int AS visits,
              count(*) FILTER (WHERE v.status = 'completed')::int AS completed
       FROM visits v JOIN users u ON u.id = v.clinician_id
       WHERE v.arrived_at::date = $1
       GROUP BY u.id, u.full_name ORDER BY visits DESC`,
      [day]
    ),
    query(
      `SELECT r.id, r.code, r.name, count(*)::int AS visits
       FROM visits v JOIN rooms r ON r.id = v.room_id
       WHERE v.arrived_at::date = $1
       GROUP BY r.id, r.code, r.name ORDER BY visits DESC`,
      [day]
    ),
    query(`SELECT count(*)::int AS total FROM patients WHERE created_at::date = $1`, [day]),
    query(
      `SELECT
         count(*) FILTER (WHERE status <> 'draft')::int AS issued,
         COALESCE(SUM(total) FILTER (WHERE status <> 'draft'), 0)::numeric AS invoiced_total,
         COALESCE(SUM(balance_due) FILTER (WHERE status IN ('issued', 'partially_paid')), 0)::numeric AS outstanding_total,
         (SELECT COALESCE(SUM(amount), 0)::numeric
          FROM payments
          WHERE NOT is_void AND paid_at::date = $1) AS paid_total
       FROM (
         SELECT i.status, i.total, i.id,
                COALESCE(pay.paid, 0) AS balance_due
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, SUM(amount) AS paid FROM payments WHERE NOT is_void GROUP BY invoice_id
         ) pay ON pay.invoice_id = i.id
         WHERE i.created_at::date = $1 OR i.issued_at::date = $1 OR EXISTS (
           SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.paid_at::date = $1 AND NOT p.is_void
         )
       ) sub`,
      [day]
    ),
  ]);

  return {
    date: day,
    generated_at: new Date().toISOString(),
    visits: visits.rows[0],
    appointments: appointments.rows[0],
    queue: queue.rows[0],
    new_patients: newPatients.rows[0].total,
    hourly: hourly.rows,
    by_clinician: byClinician.rows,
    room_utilisation: rooms.rows,
    billing: billing.rows[0] || { issued: 0, invoiced_total: 0, outstanding_total: 0, paid_total: 0 },
  };
}

async function monthly(month) {
  const period = month || currentMonth();
  if (!MONTH_RE.test(period)) throw ApiError.badRequest('month must be in YYYY-MM format.');

  const [visits, appointments, queue, byDay, byClinician, byType, newPatients, billing] = await Promise.all([
    query(`SELECT ${VISIT_TOTALS} FROM visits WHERE to_char(arrived_at, 'YYYY-MM') = $1`, [period]),
    query(`SELECT ${APPOINTMENT_TOTALS} FROM appointments WHERE to_char(scheduled_start, 'YYYY-MM') = $1`, [period]),
    query(`SELECT ${QUEUE_TOTALS} FROM queue_entries WHERE to_char(created_at, 'YYYY-MM') = $1`, [period]),
    query(
      `SELECT to_char(arrived_at::date, 'YYYY-MM-DD') AS date, ${VISIT_TOTALS}
       FROM visits WHERE to_char(arrived_at, 'YYYY-MM') = $1
       GROUP BY arrived_at::date ORDER BY arrived_at::date`,
      [period]
    ),
    query(
      `SELECT u.id, u.full_name, count(*)::int AS visits,
              count(*) FILTER (WHERE v.status = 'completed')::int AS completed
       FROM visits v JOIN users u ON u.id = v.clinician_id
       WHERE to_char(v.arrived_at, 'YYYY-MM') = $1
       GROUP BY u.id, u.full_name ORDER BY visits DESC`,
      [period]
    ),
    query(
      `SELECT visit_type, count(*)::int AS visits
       FROM visits WHERE to_char(arrived_at, 'YYYY-MM') = $1
       GROUP BY visit_type ORDER BY visits DESC`,
      [period]
    ),
    query(`SELECT count(*)::int AS total FROM patients WHERE to_char(created_at, 'YYYY-MM') = $1`, [period]),
    query(
      `SELECT
         count(*) FILTER (WHERE status <> 'draft')::int AS issued,
         COALESCE(SUM(total) FILTER (WHERE status <> 'draft'), 0)::numeric AS invoiced_total,
         COALESCE(SUM(balance_due) FILTER (WHERE status IN ('issued', 'partially_paid')), 0)::numeric AS outstanding_total,
         (SELECT COALESCE(SUM(amount), 0)::numeric
          FROM payments
          WHERE NOT is_void AND to_char(paid_at, 'YYYY-MM') = $1) AS paid_total
       FROM (
         SELECT i.status, i.total,
                COALESCE(pay.paid, 0) AS balance_due
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, SUM(amount) AS paid FROM payments WHERE NOT is_void GROUP BY invoice_id
         ) pay ON pay.invoice_id = i.id
         WHERE to_char(i.created_at, 'YYYY-MM') = $1 OR to_char(i.issued_at, 'YYYY-MM') = $1
      ) sub`,
      [period]
    ),
  ]);

  return {
    month: period,
    generated_at: new Date().toISOString(),
    visits: visits.rows[0],
    appointments: appointments.rows[0],
    queue: queue.rows[0],
    new_patients: newPatients.rows[0].total,
    by_day: byDay.rows,
    by_clinician: byClinician.rows,
    by_type: byType.rows,
    billing: billing.rows[0] || { issued: 0, invoiced_total: 0, outstanding_total: 0, paid_total: 0 },
  };
}

module.exports = { daily, monthly };
