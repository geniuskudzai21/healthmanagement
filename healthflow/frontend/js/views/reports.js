import { api } from '../api.js';
import {
  html,
  mount,
  setPage,
  spinner,
  errorState,
  emptyState,
  delegate,
  barChart,
  formatDuration,
  formatDate,
  formatMoney,
  todayIso,
  currentMonthIso,
} from '../ui.js';

function statCard({ label, value, tone = 'default' }) {
  return html`<div class="stat stat--${tone}">
    <span class="stat__label">${label}</span>
    <span class="stat__value">${value}</span>
  </div>`;
}

function visitCards(v) {
  return html`
    ${statCard({ label: 'Total visits', value: v.total })}
    ${statCard({ label: 'Completed', value: v.completed, tone: 'success' })}
    ${statCard({ label: 'Open', value: v.open, tone: 'info' })}
    ${statCard({ label: 'Cancelled', value: v.cancelled, tone: 'warning' })}
    ${statCard({ label: 'No show', value: v.no_show, tone: 'danger' })}
    ${statCard({ label: 'Walk-ins', value: v.walk_ins })}
    ${statCard({ label: 'From appointments', value: v.from_appointments })}
  `;
}

function queueCards(q) {
  return html`
    ${statCard({ label: 'Served', value: q.served, tone: 'success' })}
    ${statCard({ label: 'Avg wait', value: formatDuration(q.avg_wait_seconds), tone: 'info' })}
    ${statCard({ label: 'Median wait', value: formatDuration(q.median_wait_seconds) })}
    ${statCard({ label: 'Longest wait', value: formatDuration(q.max_wait_seconds), tone: 'danger' })}
    ${statCard({ label: 'Avg time in queue', value: formatDuration(q.avg_total_seconds) })}
  `;
}

function appointmentCards(a) {
  return html`
    ${statCard({ label: 'Appointments', value: a.total })}
    ${statCard({ label: 'Completed', value: a.completed, tone: 'success' })}
    ${statCard({ label: 'Checked in', value: a.checked_in, tone: 'info' })}
    ${statCard({ label: 'Cancelled', value: a.cancelled, tone: 'warning' })}
    ${statCard({ label: 'No show', value: a.no_show, tone: 'danger' })}
  `;
}

function clinicianTable(rows) {
  if (!rows || !rows.length) return emptyState('No clinician activity.');
  return html`<div class="table-wrap">
    <table class="table table--cards">
      <thead><tr><th scope="col">Clinician</th><th scope="col">Visits</th><th scope="col">Completed</th></tr></thead>
      <tbody>
        ${rows.map(
          (row) => html`<tr>
            <td data-label="Clinician">${row.full_name}</td>
            <td data-label="Visits">${row.visits}</td>
            <td data-label="Completed">${row.completed}</td>
          </tr>`
        )}
      </tbody>
    </table>
  </div>`;
}

function renderDaily(data, container) {
  const hourly = data.hourly.map((row) => ({ label: row.hour, value: row.visits }));
  mount(
    container,
    html`<div class="report">
      <p class="muted">Report for ${formatDate(`${data.date}T00:00:00`)} · generated ${formatDate(data.generated_at)}</p>

      <h3 class="report__heading">Visits</h3>
      <div class="stats">${visitCards(data.visits)}${statCard({ label: 'New patients', value: data.new_patients, tone: 'info' })}</div>

      <h3 class="report__heading">Queue</h3>
      <div class="stats">${queueCards(data.queue)}</div>

      <h3 class="report__heading">Appointments</h3>
      <div class="stats">${appointmentCards(data.appointments)}</div>

      <h3 class="report__heading">Billing</h3>
      <div class="stats">
        ${statCard({ label: 'Issued invoices', value: data.billing.issued || 0 })}
        ${statCard({ label: 'Invoiced total', value: formatMoney(data.billing.invoiced_total || 0), tone: 'success' })}
        ${statCard({ label: 'Paid total (this period)', value: formatMoney(data.billing.paid_total || 0), tone: 'info' })}
        ${statCard({ label: 'Outstanding', value: formatMoney(data.billing.outstanding_total || 0), tone: 'warning' })}
      </div>

      <h3 class="report__heading">Arrivals by hour</h3>
      ${barChart(hourly, { ariaLabel: 'Visits by hour of day' })}

      <div class="grid grid--2">
        <section class="panel">
          <h3 class="panel__title">By clinician</h3>
          ${clinicianTable(data.by_clinician)}
        </section>
        <section class="panel">
          <h3 class="panel__title">Room utilisation</h3>
          ${
            data.room_utilisation.length
              ? html`<div class="table-wrap"><table class="table table--cards">
                  <thead><tr><th scope="col">Room</th><th scope="col">Visits</th></tr></thead>
                  <tbody>
                    ${data.room_utilisation.map(
                      (room) => html`<tr>
                        <td data-label="Room">${room.code} — ${room.name}</td>
                        <td data-label="Visits">${room.visits}</td>
                      </tr>`
                    )}
                  </tbody>
                </table></div>`
              : emptyState('No rooms used.')
          }
        </section>
      </div>
    </div>`
  );
}

function renderMonthly(data, container) {
  const byDay = data.by_day.map((row) => ({ label: row.date.slice(8), value: row.total }));
  mount(
    container,
    html`<div class="report">
      <p class="muted">Report for ${data.month} · generated ${formatDate(data.generated_at)}</p>

      <h3 class="report__heading">Visits</h3>
      <div class="stats">${visitCards(data.visits)}${statCard({ label: 'New patients', value: data.new_patients, tone: 'info' })}</div>

      <h3 class="report__heading">Queue</h3>
      <div class="stats">${queueCards(data.queue)}</div>

      <h3 class="report__heading">Appointments</h3>
      <div class="stats">${appointmentCards(data.appointments)}</div>

      <h3 class="report__heading">Visits per day</h3>
      ${barChart(byDay, { ariaLabel: 'Visits per day of month' })}

      <h3 class="report__heading">Billing</h3>
      <div class="stats">
        ${statCard({ label: 'Issued invoices', value: data.billing.issued || 0 })}
        ${statCard({ label: 'Invoiced total', value: formatMoney(data.billing.invoiced_total || 0), tone: 'success' })}
        ${statCard({ label: 'Paid total (this period)', value: formatMoney(data.billing.paid_total || 0), tone: 'info' })}
        ${statCard({ label: 'Outstanding', value: formatMoney(data.billing.outstanding_total || 0), tone: 'warning' })}
      </div>

      <div class="grid grid--2">
        <section class="panel">
          <h3 class="panel__title">By clinician</h3>
          ${clinicianTable(data.by_clinician)}
        </section>
        <section class="panel">
          <h3 class="panel__title">By visit type</h3>
          ${
            data.by_type.length
              ? barChart(
                  data.by_type.map((row) => ({ label: row.visit_type, value: row.visits })),
                  { ariaLabel: 'Visits by type' }
                )
              : emptyState('No visits recorded.')
          }
        </section>
      </div>
    </div>`
  );
}

export default async function reportsView({ outlet }) {
  setPage('Reports', 'Daily and monthly clinic activity.');

  let mode = 'daily';
  let date = todayIso();
  let month = currentMonthIso();

  mount(
    outlet,
    html`<div class="toolbar toolbar--wrap">
      <div class="tabs" role="tablist" aria-label="Report period" id="report-tabs">
        <button type="button" role="tab" class="tab is-selected" data-mode="daily" aria-selected="true">Daily</button>
        <button type="button" role="tab" class="tab" data-mode="monthly" aria-selected="false">Monthly</button>
      </div>
      <div class="toolbar__filters">
        <div class="field field--inline" id="daily-field">
          <label for="report-date">Day</label>
          <input id="report-date" type="date" value="${date}" />
        </div>
        <div class="field field--inline" id="monthly-field" hidden>
          <label for="report-month">Month</label>
          <input id="report-month" type="month" value="${month}" />
        </div>
      </div>
    </div>

    <section class="panel" aria-labelledby="report-heading">
      <h2 id="report-heading" class="panel__title">Summary</h2>
      <div id="report-body">${spinner('Building report…')}</div>
    </section>`
  );

  const body = outlet.querySelector('#report-body');
  const dateInput = outlet.querySelector('#report-date');
  const monthInput = outlet.querySelector('#report-month');
  const dailyField = outlet.querySelector('#daily-field');
  const monthlyField = outlet.querySelector('#monthly-field');

  async function load() {
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = spinner();
    try {
      if (mode === 'daily') {
        const data = await api.get('/api/reports/daily', { date });
        renderDaily(data, body);
      } else {
        const data = await api.get('/api/reports/monthly', { month });
        renderMonthly(data, body);
      }
    } catch (err) {
      body.innerHTML = errorState(err.message, { retry: 'report-refresh' });
    } finally {
      body.removeAttribute('aria-busy');
    }
  }

  delegate(outlet.querySelector('#report-tabs'), '[data-mode]', 'click', (event, tab) => {
    mode = tab.dataset.mode;
    outlet.querySelectorAll('[data-mode]').forEach((node) => {
      const selected = node.dataset.mode === mode;
      node.classList.toggle('is-selected', selected);
      node.setAttribute('aria-selected', String(selected));
    });
    dailyField.hidden = mode !== 'daily';
    monthlyField.hidden = mode !== 'monthly';
    load();
  });

  dateInput.addEventListener('change', () => {
    date = dateInput.value || todayIso();
    load();
  });
  monthInput.addEventListener('change', () => {
    month = monthInput.value || currentMonthIso();
    load();
  });

  delegate(body, '[data-action="report-refresh"]', 'click', load);

  await load();
  return null;
}
