const { withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');

const AREAS = ['general', 'vitals', 'consult'];

/**
 * One-step reception check-in: find-or-create the patient, open a walk-in
 * visit and place it in the queue - all in a single transaction.
 */
async function checkIn(data, ctx = {}) {
  const {
    patient_id = null,
    mrn = null,
    first_name = null,
    last_name = null,
    date_of_birth = null,
    sex = 'unknown',
    phone = null,
    chief_complaint = null,
    triage_level = null,
    clinician_id = null,
    area = 'general',
    visit_type = 'walk-in',
  } = data;

  if (!AREAS.includes(area)) throw ApiError.badRequest(`Invalid area "${area}"`);
  if (!patient_id && !(mrn && first_name && last_name && date_of_birth)) {
    throw ApiError.badRequest(
      'Provide patient_id, or mrn + first_name + last_name + date_of_birth to register a new patient.'
    );
  }

  return withTransaction(async (client) => {
    let patient;
    if (patient_id) {
      const found = await client.query('SELECT * FROM patients WHERE id = $1', [patient_id]);
      if (!found.rows.length) throw ApiError.notFound(`Patient ${patient_id} not found`);
      patient = found.rows[0];
    } else {
      const created = await client.query(
        `
          INSERT INTO patients (mrn, first_name, last_name, date_of_birth, sex, phone, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [mrn, first_name, last_name, date_of_birth, sex, phone, ctx.actorId]
      );
      patient = created.rows[0];
      await audit.record(client, {
        actorId: ctx.actorId,
        action: 'create',
        entity: 'patients',
        entityId: patient.id,
        after: patient,
        ip: ctx.ip,
      });
    }

    const visitRes = await client.query(
      `
        INSERT INTO visits
          (patient_id, clinician_id, registered_by, visit_type, status, chief_complaint, triage_level)
        VALUES ($1, $2, $3, $4, 'waiting', $5, $6)
        RETURNING *
      `,
      [patient.id, clinician_id, ctx.actorId, visit_type, chief_complaint, triage_level]
    );
    const visit = visitRes.rows[0];

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`queue:${area}`]);
    const next = await client.query(
      'SELECT COALESCE(MAX(ticket_no), 0) + 1 AS next FROM queue_entries WHERE area = $1',
      [area]
    );
    const queueRes = await client.query(
      `
        INSERT INTO queue_entries (visit_id, area, ticket_no, priority)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [visit.id, area, next.rows[0].next, triage_level || 3]
    );

    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'visits',
      entityId: visit.id,
      after: { visit, queue_entry: queueRes.rows[0] },
      ip: ctx.ip,
    });

    return { patient, visit, queue_entry: queueRes.rows[0] };
  });
}

module.exports = { checkIn };
