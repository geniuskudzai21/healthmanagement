const { query, withTransaction } = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('./audit.service');
const { toPositiveInt } = require('../utils/validate');

const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid', 'void'];
const PAYABLE_STATUSES = ['issued', 'partially_paid'];
const PAYMENT_METHODS = ['cash', 'card', 'insurance', 'bank_transfer', 'mobile_money', 'other'];
const CATEGORIES = ['consultation', 'procedure', 'diagnostics', 'medication', 'room', 'other'];

/* ------------------------------------------------------------- catalog ---- */

async function listServiceItems({ q, category, active, limit = 200, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  if (active !== undefined && active !== '') {
    params.push(active === 'true' || active === true);
    where.push(`is_active = $${params.length}`);
  }
  params.push(toPositiveInt(limit, 200), toPositiveInt(offset, 0));
  const { rows } = await query(
    `
      SELECT * FROM service_items
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY category, name
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return rows;
}

async function getServiceItem(id) {
  const { rows } = await query('SELECT * FROM service_items WHERE id = $1', [id]);
  if (!rows.length) throw ApiError.notFound(`Service item ${id} not found`);
  return rows[0];
}

async function createServiceItem(data, ctx = {}) {
  const { code, name, category = 'consultation', description = null, unit_price = 0, is_active = true } = data;
  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `
        INSERT INTO service_items (code, name, category, description, unit_price, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [code, name, category, description, unit_price, is_active]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'service_items',
      entityId: result.rows[0].id,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

const ITEM_UPDATABLE = ['code', 'name', 'category', 'description', 'unit_price', 'is_active'];

async function updateServiceItem(id, data, ctx = {}) {
  const existing = await getServiceItem(id);
  const sets = [];
  const params = [];
  for (const key of ITEM_UPDATABLE) {
    if (data[key] === undefined) continue;
    params.push(data[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('No updatable fields supplied.');
  params.push(id);

  const { rows } = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE service_items SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'service_items',
      entityId: id,
      before: existing,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result;
  });
  return rows[0];
}

/* ------------------------------------------------------------- invoices ---- */

const INVOICE_SELECT = `
  SELECT i.*,
         p.mrn, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
         v.visit_type,
         cu.full_name AS created_by_name,
         COALESCE(pay.paid_total, 0)::numeric AS paid_total,
         ROUND(GREATEST(i.total - COALESCE(pay.paid_total, 0), 0), 2)::numeric AS balance_due,
         (SELECT count(*)::int FROM invoice_lines l WHERE l.invoice_id = i.id) AS line_count
  FROM invoices i
  JOIN patients p ON p.id = i.patient_id
  LEFT JOIN visits v ON v.id = i.visit_id
  LEFT JOIN users cu ON cu.id = i.created_by
  LEFT JOIN (
    SELECT invoice_id, SUM(amount)::numeric AS paid_total
    FROM payments WHERE NOT is_void GROUP BY invoice_id
  ) pay ON pay.invoice_id = i.id
`;

async function listInvoices({ q, status, patient_id, from, to, limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      i.invoice_no::text ILIKE $${params.length}
      OR p.mrn ILIKE $${params.length}
      OR p.first_name ILIKE $${params.length}
      OR p.last_name ILIKE $${params.length}
    )`);
  }
  if (status) {
    params.push(status);
    where.push(`i.status = $${params.length}`);
  }
  if (patient_id) {
    params.push(patient_id);
    where.push(`i.patient_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`i.created_at::date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`i.created_at::date <= $${params.length}`);
  }
  params.push(toPositiveInt(limit, 50), toPositiveInt(offset, 0));
  const { rows } = await query(
    `${INVOICE_SELECT}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getInvoiceRow(id) {
  const { rows } = await query(`${INVOICE_SELECT} WHERE i.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Invoice ${id} not found`);
  return rows[0];
}

async function getById(id) {
  const invoice = await getInvoiceRow(id);
  const [lines, payments] = await Promise.all([
    query(
      `SELECT l.*, s.code AS service_code
       FROM invoice_lines l
       LEFT JOIN service_items s ON s.id = l.service_item_id
       WHERE l.invoice_id = $1
       ORDER BY l.id`,
      [id]
    ),
    query(
      `SELECT pay.*, u.full_name AS received_by_name, v.full_name AS voided_by_name
       FROM payments pay
       LEFT JOIN users u ON u.id = pay.received_by
       LEFT JOIN users v ON v.id = pay.voided_by
       WHERE pay.invoice_id = $1
       ORDER BY pay.paid_at DESC, pay.id DESC`,
      [id]
    ),
  ]);
  return { ...invoice, lines: lines.rows, payments: payments.rows };
}

/** Recompute subtotal/total from line items, optionally applying new discount/tax. */
async function recalcTotals(client, id, { discount_amount, tax_rate } = {}) {
  const { rows } = await client.query(
    'SELECT COALESCE(SUM(line_total), 0)::numeric AS subtotal FROM invoice_lines WHERE invoice_id = $1',
    [id]
  );
  const result = await client.query(
    `
      UPDATE invoices SET
        subtotal        = $2,
        discount_amount = COALESCE($3, discount_amount),
        tax_rate        = COALESCE($4, tax_rate),
        total           = ROUND(
                            GREATEST($2::numeric - COALESCE($3, discount_amount), 0)
                            * (1 + COALESCE($4, tax_rate) / 100), 2
                          )
      WHERE id = $1
      RETURNING *
    `,
    [id, rows[0].subtotal, discount_amount ?? null, tax_rate ?? null]
  );
  return result.rows[0];
}

/** Flip issued/partially_paid <-> paid whenever the non-void paid sum moves. */
async function syncPaidStatus(client, invoiceId) {
  const { rows } = await client.query(
    `
      UPDATE invoices i SET status = CASE
          WHEN COALESCE(pay.paid, 0) <= 0                THEN 'issued'
          WHEN COALESCE(pay.paid, 0) >= i.total          THEN 'paid'
          ELSE 'partially_paid'
        END
      FROM (SELECT COALESCE(SUM(amount), 0)::numeric AS paid
            FROM payments WHERE invoice_id = $1 AND NOT is_void) pay
      WHERE i.id = $1 AND i.status IN ('issued', 'partially_paid', 'paid')
      RETURNING i.*
    `,
    [invoiceId]
  );
  return rows[0] || null;
}

async function createInvoice(data, ctx = {}) {
  const { patient_id, visit_id = null, notes = null, discount_amount = 0, tax_rate = 0 } = data;

  return withTransaction(async (client) => {
    const patient = await client.query('SELECT id FROM patients WHERE id = $1', [patient_id]);
    if (!patient.rows.length) throw ApiError.notFound(`Patient ${patient_id} not found`);
    if (visit_id) {
      const visit = await client.query('SELECT id FROM visits WHERE id = $1', [visit_id]);
      if (!visit.rows.length) throw ApiError.notFound(`Visit ${visit_id} not found`);
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['billing:invoice_no']);
    const next = await client.query('SELECT COALESCE(MAX(invoice_no), 0) + 1 AS next FROM invoices');

    const created = await client.query(
      `
        INSERT INTO invoices (invoice_no, patient_id, visit_id, notes, discount_amount, tax_rate, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [next.rows[0].next, patient_id, visit_id, notes, discount_amount, tax_rate, ctx.actorId]
    );
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'invoices',
      entityId: created.rows[0].id,
      after: created.rows[0],
      ip: ctx.ip,
    });
    return created.rows[0];
  });
}

const INVOICE_UPDATABLE = ['notes', 'discount_amount', 'tax_rate'];

async function updateInvoice(id, data, ctx = {}) {
  const existing = await getInvoiceRow(id);
  if (existing.status !== 'draft') {
    throw ApiError.conflict('Only draft invoices can be edited. Record a payment or void the invoice instead.');
  }
  const sets = [];
  const params = [];
  for (const key of INVOICE_UPDATABLE) {
    if (data[key] === undefined) continue;
    params.push(data[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('No updatable fields supplied.');
  params.push(id);

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    const updated = data.discount_amount !== undefined || data.tax_rate !== undefined
      ? await recalcTotals(client, id, {
          discount_amount: data.discount_amount,
          tax_rate: data.tax_rate,
        })
      : result.rows[0];
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'invoices',
      entityId: id,
      before: existing,
      after: updated,
      ip: ctx.ip,
    });
    return updated;
  });
}

async function removeInvoice(id, ctx = {}) {
  const existing = await getInvoiceRow(id);
  if (existing.status !== 'draft') {
    throw ApiError.conflict('Only draft invoices can be deleted. Void the invoice instead.');
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM invoices WHERE id = $1', [id]);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'invoices',
      entityId: id,
      before: existing,
      ip: ctx.ip,
    });
  });
  return { id: Number(id), deleted: true };
}

/* ---------------------------------------------------------------- lines ---- */

async function addLine(invoiceId, data, ctx = {}) {
  const invoice = await getInvoiceRow(invoiceId);
  if (invoice.status !== 'draft') throw ApiError.conflict('Lines can only be added to draft invoices.');

  const { service_item_id = null, quantity = 1 } = data;
  let description = data.description;
  let unit_price = data.unit_price;

  if (service_item_id) {
    const item = await getServiceItem(service_item_id);
    if (!item.is_active) throw ApiError.badRequest(`Service item "${item.code}" is inactive.`);
    if (!description) description = item.name;
    if (unit_price === undefined) unit_price = Number(item.unit_price);
  }
  if (!description) throw ApiError.badRequest('description is required for custom lines.');
  if (unit_price === undefined) unit_price = 0;

  return withTransaction(async (client) => {
    const line = await client.query(
      `
        INSERT INTO invoice_lines (invoice_id, service_item_id, description, quantity, unit_price, line_total)
        VALUES ($1, $2, $3, $4, $5, ROUND($4::numeric * $5::numeric, 2))
        RETURNING *
      `,
      [invoiceId, service_item_id, description, quantity, unit_price]
    );
    const updated = await recalcTotals(client, invoiceId);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'invoice_lines',
      entityId: line.rows[0].id,
      after: { ...line.rows[0], invoice_totals: { subtotal: updated.subtotal, total: updated.total } },
      ip: ctx.ip,
    });
    return line.rows[0];
  });
}

async function updateLine(invoiceId, lineId, data, ctx = {}) {
  const invoice = await getInvoiceRow(invoiceId);
  if (invoice.status !== 'draft') throw ApiError.conflict('Lines can only be edited on draft invoices.');

  const { rows: found } = await query('SELECT * FROM invoice_lines WHERE id = $1 AND invoice_id = $2', [lineId, invoiceId]);
  if (!found.length) throw ApiError.notFound(`Invoice line ${lineId} not found`);
  const existing = found[0];

  const sets = [];
  const params = [];
  for (const key of ['description', 'quantity', 'unit_price']) {
    if (data[key] === undefined) continue;
    params.push(data[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('No updatable fields supplied.');

  return withTransaction(async (client) => {
    params.push(lineId, invoiceId);
    const result = await client.query(
      `
        UPDATE invoice_lines SET ${sets.join(', ')},
          line_total = ROUND(quantity * unit_price, 2)
        WHERE id = $${params.length - 1} AND invoice_id = $${params.length}
        RETURNING *
      `,
      params
    );
    const updated = await recalcTotals(client, invoiceId);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'update',
      entity: 'invoice_lines',
      entityId: lineId,
      before: existing,
      after: { ...result.rows[0], invoice_totals: { subtotal: updated.subtotal, total: updated.total } },
      ip: ctx.ip,
    });
    return result.rows[0];
  });
}

async function removeLine(invoiceId, lineId, ctx = {}) {
  const invoice = await getInvoiceRow(invoiceId);
  if (invoice.status !== 'draft') throw ApiError.conflict('Lines can only be removed from draft invoices.');

  const { rows: found } = await query('SELECT * FROM invoice_lines WHERE id = $1 AND invoice_id = $2', [lineId, invoiceId]);
  if (!found.length) throw ApiError.notFound(`Invoice line ${lineId} not found`);

  return withTransaction(async (client) => {
    await client.query('DELETE FROM invoice_lines WHERE id = $1', [lineId]);
    const updated = await recalcTotals(client, invoiceId);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'delete',
      entity: 'invoice_lines',
      entityId: lineId,
      before: found[0],
      ip: ctx.ip,
    });
    return { ...updated, lines: undefined };
  });
}

/* ------------------------------------------------------- lifecycle ops ---- */

async function issue(id, ctx = {}) {
  const invoice = await getInvoiceRow(id);
  if (invoice.status !== 'draft') throw ApiError.conflict(`Invoice ${invoice.invoice_no} is already ${invoice.status.replace('_', ' ')}.`);
  if (!invoice.line_count) throw ApiError.badRequest('Add at least one line item before issuing the invoice.');
  if (Number(invoice.total) <= 0) throw ApiError.badRequest('Invoice total must be greater than zero to issue.');

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE invoices SET status = 'issued', issued_at = COALESCE(issued_at, now())
       WHERE id = $1 AND status = 'draft' RETURNING *`,
      [id]
    );
    if (!result.rows.length) throw ApiError.conflict('Invoice was changed concurrently. Refresh and try again.');
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'status_change',
      entity: 'invoices',
      entityId: id,
      before: invoice,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result.rows[0];
  });
}

async function voidInvoice(id, ctx = {}) {
  const invoice = await getInvoiceRow(id);
  if (['void', 'draft'].includes(invoice.status)) {
    throw ApiError.conflict(`Cannot void a ${invoice.status} invoice.`);
  }
  if (Number(invoice.paid_total) > 0) {
    throw ApiError.conflict('Void the outstanding payments first — this invoice has money recorded against it.');
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE invoices SET status = 'void', voided_at = now()
       WHERE id = $1 AND status IN ('issued', 'partially_paid', 'paid') RETURNING *`,
      [id]
    );
    if (!result.rows.length) throw ApiError.conflict('Invoice was changed concurrently. Refresh and try again.');
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'void',
      entity: 'invoices',
      entityId: id,
      before: invoice,
      after: result.rows[0],
      ip: ctx.ip,
    });
    return result.rows[0];
  });
}

/* ------------------------------------------------------------- payments ---- */

async function listPayments({ invoice_id, method, from, to, limit = 100, offset = 0 } = {}) {
  const params = [];
  const where = [];
  if (invoice_id) {
    params.push(invoice_id);
    where.push(`pay.invoice_id = $${params.length}`);
  }
  if (method) {
    params.push(method);
    where.push(`pay.method = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`pay.paid_at::date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`pay.paid_at::date <= $${params.length}`);
  }
  params.push(toPositiveInt(limit, 100), toPositiveInt(offset, 0));
  const { rows } = await query(
    `
      SELECT pay.*, i.invoice_no, i.status AS invoice_status,
             p.mrn, p.first_name AS patient_first_name, p.last_name AS patient_last_name,
             u.full_name AS received_by_name, v.full_name AS voided_by_name
      FROM payments pay
      JOIN invoices i ON i.id = pay.invoice_id
      JOIN patients p ON p.id = i.patient_id
      LEFT JOIN users u ON u.id = pay.received_by
      LEFT JOIN users v ON v.id = pay.voided_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY pay.paid_at DESC, pay.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return rows;
}

async function addPayment(invoiceId, data, ctx = {}) {
  const { amount, method = 'cash', reference = null, notes = null } = data;

  return withTransaction(async (client) => {
    const { rows: locked } = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    if (!locked.length) throw ApiError.notFound(`Invoice ${invoiceId} not found`);
    const invoice = locked[0];
    if (!PAYABLE_STATUSES.includes(invoice.status)) {
      throw ApiError.conflict(
        `Payments can only be recorded against issued invoices (this one is ${invoice.status.replace('_', ' ')}).`
      );
    }

    const { rows: paidRows } = await client.query(
      'SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payments WHERE invoice_id = $1 AND NOT is_void',
      [invoiceId]
    );
    const balance = Number(invoice.total) - Number(paidRows[0].paid);
    if (Number(amount) > balance + 0.001) {
      throw ApiError.badRequest(
        `Payment of ${Number(amount).toFixed(2)} exceeds the balance due of ${balance.toFixed(2)}.`,
        { balance_due: balance }
      );
    }

    const payment = await client.query(
      `
        INSERT INTO payments (invoice_id, amount, method, reference, notes, received_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [invoiceId, amount, method, reference, notes, ctx.actorId]
    );
    const updated = await syncPaidStatus(client, invoiceId);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'create',
      entity: 'payments',
      entityId: payment.rows[0].id,
      after: { ...payment.rows[0], invoice_status: updated ? updated.status : invoice.status },
      ip: ctx.ip,
    });
    return { ...payment.rows[0], invoice_status: updated ? updated.status : invoice.status };
  });
}

async function voidPayment(paymentId, ctx = {}) {
  return withTransaction(async (client) => {
    const { rows: found } = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    if (!found.length) throw ApiError.notFound(`Payment ${paymentId} not found`);
    const payment = found[0];
    if (payment.is_void) throw ApiError.conflict('Payment is already void.');

    const result = await client.query(
      `UPDATE payments SET is_void = TRUE, voided_by = $2, voided_at = now()
       WHERE id = $1 RETURNING *`,
      [paymentId, ctx.actorId]
    );
    const updated = await syncPaidStatus(client, payment.invoice_id);
    await audit.record(client, {
      actorId: ctx.actorId,
      action: 'void',
      entity: 'payments',
      entityId: paymentId,
      before: payment,
      after: { ...result.rows[0], invoice_status: updated ? updated.status : null },
      ip: ctx.ip,
    });
    return result.rows[0];
  });
}

/* -------------------------------------------------------------- summary ---- */

async function summary({ from, to } = {}) {
  const defaultFrom = new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const start = from || defaultFrom;
  const end = to || new Date().toISOString().slice(0, 10);

  const [invoiced, payments, open, outstanding] = await Promise.all([
    query(
      `SELECT count(*)::int AS count, COALESCE(SUM(total), 0)::numeric AS total
       FROM invoices
       WHERE status <> 'draft' AND created_at::date BETWEEN $1 AND $2`,
      [start, end]
    ),
    query(
      `SELECT count(*)::int AS count, COALESCE(SUM(amount), 0)::numeric AS total
       FROM payments
       WHERE NOT is_void AND paid_at::date BETWEEN $1 AND $2`,
      [start, end]
    ),
    query(
      `SELECT count(*)::int AS count FROM invoices WHERE status IN ('issued', 'partially_paid')`
    ),
    query(
      `SELECT COALESCE(SUM(GREATEST(total - paid, 0)), 0)::numeric AS total
       FROM (
         SELECT i.total, COALESCE(pay.paid, 0) AS paid
         FROM invoices i
         LEFT JOIN (
           SELECT invoice_id, SUM(amount) AS paid FROM payments WHERE NOT is_void GROUP BY invoice_id
         ) pay ON pay.invoice_id = i.id
         WHERE i.status IN ('issued', 'partially_paid', 'paid')
       ) open_invoices`
    ),
  ]);

  return {
    from: start,
    to: end,
    invoiced: invoiced.rows[0],
    payments: payments.rows[0],
    open_invoices: open.rows[0].count,
    outstanding_total: outstanding.rows[0].total,
  };
}

module.exports = {
  INVOICE_STATUSES,
  PAYABLE_STATUSES,
  PAYMENT_METHODS,
  CATEGORIES,
  listServiceItems,
  getServiceItem,
  createServiceItem,
  updateServiceItem,
  listInvoices,
  getInvoiceRow,
  getById,
  createInvoice,
  updateInvoice,
  removeInvoice,
  addLine,
  updateLine,
  removeLine,
  issue,
  voidInvoice,
  listPayments,
  addPayment,
  voidPayment,
  summary,
};
