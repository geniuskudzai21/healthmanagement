import { api } from '../api.js';
import { hasRole } from '../auth.js';
import {
  html,
  mount,
  setPage,
  spinner,
  errorState,
  emptyState,
  toast,
  announce,
  delegate,
  setBusy,
  formValues,
  openDialog,
  confirmDialog,
  showFieldErrors,
  clearFieldErrors,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadge,
} from '../ui.js';
import { patientPicker } from '../components.js';

const METHOD_LABELS = {
  cash: 'Cash',
  card: 'Card',
  insurance: 'Insurance',
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  other: 'Other',
};

const CATEGORIES = ['consultation', 'procedure', 'diagnostics', 'medication', 'room', 'other'];

function isAdmin() {
  return hasRole('admin');
}
function canBill() {
  return hasRole('reception', 'admin');
}
function canRead() {
  return hasRole('reception', 'clinician', 'admin');
}

function netBase(inv) {
  return Math.max(Number(inv.subtotal) - Number(inv.discount_amount), 0);
}
function taxAmount(inv) {
  return Number(inv.total) - netBase(inv);
}

/* ------------------------------------------------------- new invoice ---- */

async function openNewInvoice(onCreated) {
  const dialog = openDialog({
    title: 'New invoice',
    size: 'lg',
    content: html`<form id="invoice-form" novalidate>
      <div class="form-grid">
        <div class="field field--full">
          <label for="inv-patient">Patient</label>
          <div id="inv-patient-picker"></div>
        </div>
        <div class="field">
          <label for="discount_amount">Discount</label>
          <input id="discount_amount" name="discount_amount" type="number" min="0" step="0.01" value="0" />
        </div>
        <div class="field">
          <label for="tax_rate">Tax rate (%)</label>
          <input id="tax_rate" name="tax_rate" type="number" min="0" max="100" step="0.01" value="0" />
        </div>
        <div class="field field--full">
          <label for="notes">Notes</label>
          <textarea id="notes" name="notes" rows="2"></textarea>
        </div>
      </div>
      <p id="invoice-error" class="form-error" role="alert" hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary" id="invoice-submit">Create invoice</button>
      </div>
    </form>`,
  });

  const form = dialog.querySelector('#invoice-form');
  const errorBox = dialog.querySelector('#invoice-error');
  const submit = dialog.querySelector('#invoice-submit');
  const picker = patientPicker(dialog.querySelector('#inv-patient-picker'), {});

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);

    const patient = picker.getSelected();
    if (!patient) {
      errorBox.textContent = 'Choose a patient for this invoice.';
      errorBox.hidden = false;
      return;
    }
    const values = formValues(form);
    const payload = {
      patient_id: patient.id,
      discount_amount: Number(values.discount_amount) || 0,
      tax_rate: Number(values.tax_rate) || 0,
    };
    if (values.notes) payload.notes = values.notes;

    setBusy(submit, true, 'Creating…');
    try {
      const invoice = await api.post('/api/billing/invoices', payload);
      toast(`Invoice #${invoice.invoice_no} created. Add line items to build the bill.`, 'success');
      dialog.close();
      await onCreated(invoice.id);
    } catch (err) {
      if (err.details && err.details.fields) {
        showFieldErrors(form, err.details.fields);
        errorBox.textContent = 'Please correct the highlighted fields.';
      } else {
        errorBox.textContent = err.message;
      }
      errorBox.hidden = false;
    } finally {
      setBusy(submit, false);
    }
  });
}

/* -------------------------------------------------------- service item ---- */

async function openServiceDialog(item, onSaved) {
  const editing = Boolean(item);
  const dialog = openDialog({
    title: editing ? `Edit ${item.code}` : 'New service',
    size: 'sm',
    content: html`<form id="service-form" novalidate>
      <div class="field">
        <label for="svc-code">Code</label>
        <input id="svc-code" name="code" maxlength="40" value="${editing ? item.code : ''}" required />
      </div>
      <div class="field">
        <label for="svc-name">Name</label>
        <input id="svc-name" name="name" maxlength="120" value="${editing ? item.name : ''}" required />
      </div>
      <div class="field">
        <label for="svc-category">Category</label>
        <select id="svc-category" name="category">
          ${CATEGORIES.map((c) => html`<option value="${c}"${editing && item.category === c ? ' selected' : ''}>${c}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="svc-price">Price</label>
        <input id="svc-price" name="unit_price" type="number" min="0" step="0.01" value="${editing ? item.unit_price : 0}" />
      </div>
      <div class="field">
        <label for="svc-description">Description</label>
        <input id="svc-description" name="description" maxlength="500" value="${editing ? item.description || '' : ''}" />
      </div>
      <label class="switch">
        <input type="checkbox" id="svc-active" name="is_active" ${!editing || item.is_active ? 'checked' : ''} />
        <span>Active</span>
      </label>
      <p id="service-error" class="form-error" role="alert" hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary" id="service-submit">${editing ? 'Save' : 'Create'}</button>
      </div>
    </form>`,
  });

  const form = dialog.querySelector('#service-form');
  const errorBox = dialog.querySelector('#service-error');
  const submit = dialog.querySelector('#service-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);
    const values = formValues(form);
    const payload = {
      code: values.code,
      name: values.name,
      category: values.category,
      unit_price: Number(values.unit_price) || 0,
      is_active: values.is_active,
    };
    if (values.description) payload.description = values.description;

    setBusy(submit, true, 'Saving…');
    try {
      if (editing) await api.patch(`/api/billing/service-items/${item.id}`, payload);
      else await api.post('/api/billing/service-items', payload);
      toast(editing ? 'Service updated.' : 'Service created.', 'success');
      dialog.close();
      await onSaved();
    } catch (err) {
      if (err.details && err.details.fields) {
        showFieldErrors(form, err.details.fields);
        errorBox.textContent = 'Please correct the highlighted fields.';
      } else {
        errorBox.textContent = err.message;
      }
      errorBox.hidden = false;
    } finally {
      setBusy(submit, false);
    }
  });
}

/* ------------------------------------------------------------- payment ---- */

async function openPaymentDialog(invoice, onSaved) {
  const balance = Number(invoice.balance_due);
  const dialog = openDialog({
    title: `Record payment — invoice #${invoice.invoice_no}`,
    size: 'sm',
    content: html`<form id="pay-form" novalidate>
      <p class="muted">Balance due: <strong>${formatMoney(balance)}</strong></p>
      <div class="field">
        <label for="pay-amount">Amount</label>
        <input id="pay-amount" name="amount" type="number" min="0.01" step="0.01" value="${balance.toFixed(2)}" required />
      </div>
      <div class="field">
        <label for="pay-method">Method</label>
        <select id="pay-method" name="method">
          ${Object.entries(METHOD_LABELS).map(([value, label]) => html`<option value="${value}">${label}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="pay-reference">Reference</label>
        <input id="pay-reference" name="reference" maxlength="120" />
      </div>
      <div class="field">
        <label for="pay-notes">Notes</label>
        <textarea id="pay-notes" name="notes" rows="2" maxlength="500"></textarea>
      </div>
      <p id="pay-error" class="form-error" role="alert" hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary" id="pay-submit">Record payment</button>
      </div>
    </form>`,
  });

  const form = dialog.querySelector('#pay-form');
  const errorBox = dialog.querySelector('#pay-error');
  const submit = dialog.querySelector('#pay-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);
    const values = formValues(form);
    const payload = { amount: Number(values.amount), method: values.method };
    if (values.reference) payload.reference = values.reference;
    if (values.notes) payload.notes = values.notes;

    setBusy(submit, true, 'Recording…');
    try {
      const result = await api.post(`/api/billing/invoices/${invoice.id}/payments`, payload);
      toast(`Payment recorded — invoice is now ${String(result.invoice_status).replace('_', ' ')}.`, 'success');
      dialog.close();
      await onSaved();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    } finally {
      setBusy(submit, false);
    }
  });
}

/* ---------------------------------------------------------- edit line ---- */

function openEditLine(invoiceId, line, onSaved) {
  const dialog = openDialog({
    title: 'Edit line',
    size: 'sm',
    content: html`<form id="edit-line-form" novalidate>
      <div class="field">
        <label for="el-desc">Description</label>
        <input id="el-desc" name="description" maxlength="500" value="${line.description}" />
      </div>
      <div class="field">
        <label for="el-qty">Quantity</label>
        <input id="el-qty" name="quantity" type="number" min="0.01" step="0.01" value="${line.quantity}" />
      </div>
      <div class="field">
        <label for="el-price">Unit price</label>
        <input id="el-price" name="unit_price" type="number" min="0" step="0.01" value="${line.unit_price}" />
      </div>
      <p id="el-error" class="form-error" role="alert" hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary">Save</button>
      </div>
    </form>`,
  });

  const form = dialog.querySelector('#edit-line-form');
  const errorBox = dialog.querySelector('#el-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    const values = formValues(form);
    try {
      await api.patch(`/api/billing/invoices/${invoiceId}/lines/${line.id}`, {
        description: values.description,
        quantity: Number(values.quantity),
        unit_price: Number(values.unit_price),
      });
      toast('Line updated.', 'success');
      dialog.close();
      await onSaved();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.hidden = false;
    }
  });
}

/* -------------------------------------------------------- invoice detail ---- */

function detailMarkup(inv, services) {
  const draft = inv.status === 'draft';
  const payable = inv.status === 'issued' || inv.status === 'partially_paid';
  const editable = draft && canBill();

  return html`
    <div class="bill-detail">
      <div class="bill-detail__head">
        <div>
          <span class="muted">Invoice</span> <strong>#${inv.invoice_no}</strong>
          ${statusBadge(inv.status)}
        </div>
        <div>
          <strong>${inv.patient_first_name} ${inv.patient_last_name}</strong>
          <span class="muted block">${inv.mrn}</span>
        </div>
        <div class="muted">${formatDate(inv.created_at)}</div>
      </div>

      <div class="table-wrap">
        <table class="table table--compact">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" class="num">Qty</th>
              <th scope="col" class="num">Unit</th>
              <th scope="col" class="num">Line total</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${inv.lines.length
              ? inv.lines.map(
                  (l) => html`<tr>
                    <td>
                      <strong>${l.description}</strong>
                      ${l.service_code ? html`<span class="muted block">${l.service_code}</span>` : ''}
                    </td>
                    <td class="num">${l.quantity}</td>
                    <td class="num">${formatMoney(l.unit_price)}</td>
                    <td class="num">${formatMoney(l.line_total)}</td>
                    <td class="table__actions">
                      ${editable
                        ? html`<button type="button" class="btn btn--ghost btn--sm" data-act="edit-line" data-id="${l.id}">Edit</button>
                            <button type="button" class="btn btn--danger btn--sm" data-act="del-line" data-id="${l.id}">Remove</button>`
                        : ''}
                    </td>
                  </tr>`
                )
              : html`<tr><td colspan="5" class="muted">No line items yet.</td></tr>`}
          </tbody>
        </table>
      </div>

      ${editable
        ? html`<form id="line-form" class="line-form" novalidate>
            <div class="field field--grow">
              <label for="line-service">Service</label>
              <select id="line-service" name="service_item_id">
                <option value="">Custom…</option>
                ${services.map(
                  (s) => html`<option value="${s.id}" data-price="${s.unit_price}" data-name="${s.name}">
                    ${s.name} — ${formatMoney(s.unit_price)}
                  </option>`
                )}
              </select>
            </div>
            <div class="field field--grow">
              <label for="line-desc">Description</label>
              <input id="line-desc" name="description" maxlength="500" />
            </div>
            <div class="field field--num">
              <label for="line-qty">Qty</label>
              <input id="line-qty" name="quantity" type="number" min="0.01" step="0.01" value="1" />
            </div>
            <div class="field field--num">
              <label for="line-price">Unit price</label>
              <input id="line-price" name="unit_price" type="number" min="0" step="0.01" value="0" />
            </div>
            <button type="submit" class="btn btn--primary" id="line-submit">Add</button>
          </form>`
        : ''}

      <dl class="bill-totals">
        <div><dt>Subtotal</dt><dd>${formatMoney(inv.subtotal)}</dd></div>
        <div><dt>Discount</dt><dd>− ${formatMoney(inv.discount_amount)}</dd></div>
        <div><dt>Tax (${inv.tax_rate}%)</dt><dd>${formatMoney(taxAmount(inv))}</dd></div>
        <div class="bill-totals__total"><dt>Total</dt><dd>${formatMoney(inv.total)}</dd></div>
        <div><dt>Paid</dt><dd>${formatMoney(inv.paid_total)}</dd></div>
        <div class="bill-totals__balance"><dt>Balance due</dt><dd>${formatMoney(inv.balance_due)}</dd></div>
      </dl>

      ${inv.payments.length
        ? html`<h3 class="bill-subtitle">Payments</h3>
            <ul class="bill-payments">
              ${inv.payments.map(
                (p) => html`<li class="${p.is_void ? 'is-void' : ''}">
                  <span>${formatMoney(p.amount)} · ${METHOD_LABELS[p.method] || p.method}</span>
                  <span class="muted">
                    ${formatDateTime(p.paid_at)}${p.received_by_name ? ` · ${p.received_by_name}` : ''}${p.is_void ? ' · void' : ''}
                  </span>
                </li>`
              )}
            </ul>`
        : ''}

      <div class="dialog__actions">
        ${draft && isAdmin()
          ? html`<button type="button" class="btn btn--danger btn--sm" data-act="delete">Delete</button>`
          : ''}
        ${draft && canBill()
          ? html`<button type="button" class="btn btn--primary" data-act="issue">Issue invoice</button>`
          : ''}
        ${payable && canBill()
          ? html`<button type="button" class="btn btn--primary" data-act="pay">Record payment</button>`
          : ''}
        ${!draft && inv.status !== 'void' && isAdmin()
          ? html`<button type="button" class="btn btn--danger" data-act="void">Void</button>`
          : ''}
        <button type="button" class="btn btn--ghost" data-close>Close</button>
      </div>
    </div>`;
}

async function openInvoiceDetail(id, onChanged) {
  const dialog = openDialog({ title: 'Invoice', size: 'lg', content: spinner('Loading invoice…') });
  const content = dialog.querySelector('.dialog__content');
  let invoice = null;
  let services = [];

  async function refresh() {
    invoice = await api.get(`/api/billing/invoices/${id}`);
    content.innerHTML = String(detailMarkup(invoice, services));
  }

  content.addEventListener('change', (event) => {
    const select = event.target.closest('#line-service');
    if (!select) return;
    const option = select.selectedOptions[0];
    const desc = content.querySelector('#line-desc');
    const price = content.querySelector('#line-price');
    if (select.value && option) {
      desc.value = option.dataset.name || '';
      price.value = option.dataset.price || '0';
    } else {
      desc.value = '';
      price.value = '0';
    }
  });

  content.addEventListener('submit', async (event) => {
    if (event.target.id !== 'line-form') return;
    event.preventDefault();
    const values = formValues(event.target);
    const payload = { quantity: Number(values.quantity) || 1 };
    if (values.service_item_id) {
      payload.service_item_id = Number(values.service_item_id);
    } else {
      if (!values.description) {
        toast('Enter a description or pick a service.', 'warning');
        return;
      }
      payload.description = values.description;
      payload.unit_price = Number(values.unit_price) || 0;
    }
    try {
      await api.post(`/api/billing/invoices/${id}/lines`, payload);
      toast('Line added.', 'success');
      await refresh();
      await onChanged();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  delegate(content, '[data-act]', 'click', async (event, button) => {
    const act = button.dataset.act;
    try {
      if (act === 'issue') {
        await api.post(`/api/billing/invoices/${id}/issue`);
        toast('Invoice issued.', 'success');
        await refresh();
        await onChanged();
      } else if (act === 'pay') {
        await openPaymentDialog(invoice, async () => {
          await refresh();
          await onChanged();
        });
      } else if (act === 'void') {
        const ok = await confirmDialog({
          title: 'Void invoice',
          message: 'This marks the invoice void; it stays on record but no longer counts as owed.',
          confirmLabel: 'Void invoice',
          danger: true,
        });
        if (!ok) return;
        await api.post(`/api/billing/invoices/${id}/void`);
        toast('Invoice voided.', 'success');
        await refresh();
        await onChanged();
      } else if (act === 'delete') {
        const ok = await confirmDialog({
          title: 'Delete invoice',
          message: 'This permanently removes the draft invoice.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        await api.delete(`/api/billing/invoices/${id}`);
        toast('Invoice deleted.', 'success');
        dialog.close();
        await onChanged();
      } else if (act === 'del-line') {
        await api.delete(`/api/billing/invoices/${id}/lines/${button.dataset.id}`);
        toast('Line removed.', 'success');
        await refresh();
        await onChanged();
      } else if (act === 'edit-line') {
        const line = invoice.lines.find((l) => String(l.id) === String(button.dataset.id));
        if (line) {
          openEditLine(id, line, async () => {
            await refresh();
            await onChanged();
          });
        }
      }
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  try {
    services = await api.get('/api/billing/service-items', { active: true, limit: 500 });
    await refresh();
  } catch (err) {
    content.innerHTML = String(errorState(err.message));
  }
}

/* ---------------------------------------------------------------- view ---- */

export default async function billingView({ outlet }) {
  setPage('Billing', 'Invoices, payments and service catalogue.');

  mount(
    outlet,
    html`<div class="toolbar toolbar--wrap">
      <div class="tabs" role="tablist" aria-label="Billing views" id="billing-tabs">
        <button type="button" role="tab" class="tab is-selected" data-tab="invoices" aria-selected="true">Invoices</button>
        <button type="button" role="tab" class="tab" data-tab="payments" aria-selected="false">Payments</button>
        <button type="button" role="tab" class="tab" data-tab="catalog" aria-selected="false">Service catalogue</button>
      </div>
      <div class="toolbar__actions" id="billing-actions"></div>
    </div>
    <section class="panel" aria-labelledby="billing-heading">
      <h2 id="billing-heading" class="panel__title">Invoices</h2>
      <div id="billing-body">${spinner('Loading billing data…')}</div>
    </section>`
  );

  const tabs = outlet.querySelector('#billing-tabs');
  const actions = outlet.querySelector('#billing-actions');
  const body = outlet.querySelector('#billing-body');
  const heading = outlet.querySelector('#billing-heading');
  let active = 'invoices';
  const cache = { invoices: [], catalog: [] };

  async function renderInvoices() {
    heading.textContent = 'Invoices';
    actions.innerHTML = canBill()
      ? html`<button type="button" class="btn btn--primary" id="new-invoice">＋ New invoice</button>`
      : '';
    body.innerHTML = spinner('Loading invoices…');
    try {
      const invoices = await api.get('/api/billing/invoices', { limit: 100 });
      cache.invoices = invoices;
      if (!invoices.length) {
        body.innerHTML = emptyState('No invoices yet.', 'Create one to start a bill.');
        return;
      }
      body.innerHTML = html`<div class="table-wrap">
        <table class="table table--cards">
          <thead>
            <tr>
              <th scope="col">Invoice #</th>
              <th scope="col">Patient</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
              <th scope="col">Paid</th>
              <th scope="col">Balance</th>
              <th scope="col">Created</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${invoices.map(
              (inv) => html`<tr>
                <td data-label="Invoice #">${inv.invoice_no}</td>
                <td data-label="Patient">${inv.patient_first_name} ${inv.patient_last_name}<br><span class="muted">${inv.mrn}</span></td>
                <td data-label="Status">${statusBadge(inv.status)}</td>
                <td data-label="Total">${formatMoney(inv.total)}</td>
                <td data-label="Paid">${formatMoney(inv.paid_total)}</td>
                <td data-label="Balance">${formatMoney(inv.balance_due)}</td>
                <td data-label="Created">${formatDate(inv.created_at)}</td>
                <td class="table__actions">
                  <button type="button" class="btn btn--ghost btn--sm" data-open="${inv.id}">Open</button>
                  ${inv.status === 'issued' || inv.status === 'partially_paid'
                    ? html`<button type="button" class="btn btn--sm" data-pay="${inv.id}">Record payment</button>`
                    : ''}
                  ${inv.status === 'draft' && isAdmin()
                    ? html`<button type="button" class="btn btn--ghost btn--sm" data-delete="${inv.id}">Delete</button>`
                    : ''}
                </td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>`;
    } catch (err) {
      body.innerHTML = errorState(err.message, { retry: 'reload-invoices' });
    }
  }

  async function renderPayments() {
    heading.textContent = 'Payments';
    actions.innerHTML = '';
    body.innerHTML = spinner('Loading payments…');
    try {
      const payments = await api.get('/api/billing/payments', { limit: 200 });
      if (!payments.length) {
        body.innerHTML = emptyState('No payments recorded yet.');
        return;
      }
      body.innerHTML = html`<div class="table-wrap">
        <table class="table table--cards">
          <thead>
            <tr>
              <th scope="col">Invoice #</th>
              <th scope="col">Patient</th>
              <th scope="col">Amount</th>
              <th scope="col">Method</th>
              <th scope="col">Reference</th>
              <th scope="col">Received by</th>
              <th scope="col">Paid at</th>
              <th scope="col">Status</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(
              (p) => html`<tr class="${p.is_void ? 'row--done' : ''}">
                <td data-label="Invoice #">${p.invoice_no}</td>
                <td data-label="Patient">${p.patient_first_name} ${p.patient_last_name}<br><span class="muted">${p.mrn}</span></td>
                <td data-label="Amount">${formatMoney(p.amount)}</td>
                <td data-label="Method">${METHOD_LABELS[p.method] || p.method}</td>
                <td data-label="Reference">${p.reference || '—'}</td>
                <td data-label="Received by">${p.received_by_name || '—'}</td>
                <td data-label="Paid at">${formatDateTime(p.paid_at)}</td>
                <td data-label="Status">${p.is_void ? statusBadge('void') : statusBadge('completed')}</td>
                <td class="table__actions">
                  ${!p.is_void && isAdmin()
                    ? html`<button type="button" class="btn btn--ghost btn--sm" data-void-payment="${p.id}">Void</button>`
                    : ''}
                </td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>`;
    } catch (err) {
      body.innerHTML = errorState(err.message, { retry: 'reload-payments' });
    }
  }

  async function renderCatalog() {
    heading.textContent = 'Service catalogue';
    actions.innerHTML = isAdmin()
      ? html`<button type="button" class="btn btn--primary" id="new-item">＋ New service</button>`
      : '';
    body.innerHTML = spinner('Loading catalogue…');
    try {
      const items = await api.get('/api/billing/service-items', { limit: 500 });
      cache.catalog = items;
      if (!items.length) {
        body.innerHTML = emptyState('No service items defined.');
        return;
      }
      body.innerHTML = html`<div class="table-wrap">
        <table class="table table--cards">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Category</th>
              <th scope="col">Price</th>
              <th scope="col">Active</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${items.map(
              (item) => html`<tr>
                <td data-label="Code">${item.code}</td>
                <td data-label="Name">${item.name}</td>
                <td data-label="Category">${item.category}</td>
                <td data-label="Price">${formatMoney(item.unit_price)}</td>
                <td data-label="Active">${item.is_active ? 'Yes' : 'No'}</td>
                <td class="table__actions">
                  ${isAdmin()
                    ? html`<button type="button" class="btn btn--ghost btn--sm" data-edit-item="${item.id}">Edit</button>`
                    : ''}
                </td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>`;
    } catch (err) {
      body.innerHTML = errorState(err.message, { retry: 'reload-catalog' });
    }
  }

  async function load() {
    if (!canRead()) {
      body.innerHTML = errorState('You do not have access to billing.');
      return;
    }
    if (active === 'invoices') await renderInvoices();
    else if (active === 'payments') await renderPayments();
    else await renderCatalog();
  }

  delegate(tabs, '[data-tab]', 'click', (event, tab) => {
    active = tab.dataset.tab;
    tabs.querySelectorAll('[data-tab]').forEach((t) => {
      t.classList.toggle('is-selected', t.dataset.tab === active);
      t.setAttribute('aria-selected', t.dataset.tab === active ? 'true' : 'false');
    });
    load();
  });

  delegate(actions, '#new-invoice', 'click', () => openNewInvoice(async (id) => { await load(); await openInvoiceDetail(id, load); }));
  delegate(actions, '#new-item', 'click', () => openServiceDialog(null, load));

  delegate(body, '[data-open]', 'click', (event, button) => openInvoiceDetail(button.dataset.open, load));

  delegate(body, '[data-pay]', 'click', (event, button) => {
    const inv = cache.invoices.find((i) => String(i.id) === String(button.dataset.pay));
    if (inv) openPaymentDialog(inv, load);
  });

  delegate(body, '[data-delete]', 'click', async (event, button) => {
    const ok = await confirmDialog({
      title: 'Delete invoice',
      message: 'This permanently removes the draft invoice.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/billing/invoices/${button.dataset.delete}`);
      toast('Invoice deleted.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  delegate(body, '[data-void-payment]', 'click', async (event, button) => {
    const ok = await confirmDialog({
      title: 'Void payment',
      message: 'This reverses the payment and updates the invoice balance.',
      confirmLabel: 'Void payment',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/api/billing/payments/${button.dataset.voidPayment}/void`);
      toast('Payment voided.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  delegate(body, '[data-edit-item]', 'click', (event, button) => {
    const item = cache.catalog.find((i) => String(i.id) === String(button.dataset.editItem));
    if (item) openServiceDialog(item, load);
  });

  delegate(body, '[data-action="reload-invoices"]', 'click', renderInvoices);
  delegate(body, '[data-action="reload-payments"]', 'click', renderPayments);
  delegate(body, '[data-action="reload-catalog"]', 'click', renderCatalog);

  await load();
  return null;
}
