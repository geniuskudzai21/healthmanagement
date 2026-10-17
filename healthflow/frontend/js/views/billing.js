import { api } from '../api.js';
import { hasRole } from '../auth.js';
import { navigate } from '../router.js';
import {
  html,
  mount,
  setPage,
  spinner,
  errorState,
  emptyState,
  toast,
  delegate,
  setBusy,
  formValues,
  openDialog,
  showFieldErrors,
  clearFieldErrors,
  formatDate,
  formatDateTime,
  formatMoney,
  statusBadge,
} from '../ui.js';

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

  async function renderInvoices() {
    heading.textContent = 'Invoices';
    actions.innerHTML = canBill()
      ? html`<button type="button" class="btn btn--primary" id="new-invoice">＋ New invoice</button>`
      : '';
    body.innerHTML = spinner('Loading invoices…');
    try {
      const invoices = await api.get('/api/billing/invoices', { limit: 100 });
      if (!invoices.length) {
        body.innerHTML = emptyState('No invoices found.');
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
                  ${inv.status === 'draft' && canBill()
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
    if (active === 'invoices') await renderInvoices();
    else if (active === 'payments') await renderPayments();
    else await renderCatalog();
  }

  // Delegation...
  delegate(tabs, '[data-tab]', 'click', (e, tab) => {
    active = tab.dataset.tab;
    tabs.querySelectorAll('[data-tab]').forEach((t) => {
      t.classList.toggle('is-selected', t.dataset.tab === active);
      t.setAttribute('aria-selected', t.dataset.tab === active ? 'true' : 'false');
    });
    load();
  });
  delegate(body, '[data-action="reload-invoices"]', 'click', renderInvoices);
  delegate(body, '[data-action="reload-payments"]', 'click', renderPayments);
  delegate(body, '[data-action="reload-catalog"]', 'click', renderCatalog);

  // Triggers (invoice ops, payments, catalog) use placeholder TODOs below pattern; keep simple.

  await load();
  return null;
}