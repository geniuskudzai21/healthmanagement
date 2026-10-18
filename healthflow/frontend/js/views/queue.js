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
  formatDuration,
  elapsedSeconds,
  triageBadge,
  statusBadge,
  openDialog,
  setBusy,
  formValues,
} from '../ui.js';

const AREAS = [
  ['all', 'All'],
  ['general', 'General'],
  ['vitals', 'Vitals'],
  ['consult', 'Consultation'],
];

const ACTIVE = ['waiting', 'called', 'in_room'];

function canManage() {
  return hasRole('nurse', 'clinician', 'admin');
}

function summaryChips(summary) {
  const chip = (label, value, tone = 'default') =>
    html`<span class="chip chip--stat chip--${tone}"><strong>${value}</strong> ${label}</span>`;
  return html`
    ${chip('waiting', summary.waiting ?? 0, 'warning')}
    ${chip('called', summary.called ?? 0, 'info')}
    ${chip('done today', summary.done ?? 0, 'success')}
    ${chip('avg wait', formatDuration(summary.avg_wait_seconds))}
    ${chip('median wait', formatDuration(summary.median_wait_seconds))}
    ${chip('longest wait', formatDuration(summary.longest_wait_seconds), 'danger')}
  `;
}

function rowActions(entry) {
  if (!canManage()) return [];
  const id = entry.id;
  const buttons = [];
  if (entry.status === 'waiting') {
    buttons.push(html`<button type="button" class="btn btn--primary btn--sm" data-act="called" data-id="${id}">Call</button>`);
  }
  if (entry.status === 'called') {
    buttons.push(html`<button type="button" class="btn btn--success btn--sm" data-act="done" data-id="${id}">Done</button>`);
  }
  if (entry.status === 'in_room') {
    buttons.push(html`<button type="button" class="btn btn--success btn--sm" data-act="done" data-id="${id}">Done</button>`);
  }
  if (['called', 'in_room'].includes(entry.status)) {
    buttons.push(html`<button type="button" class="btn btn--ghost btn--sm" data-route="${id}"
      data-visit="${entry.visit_id}" data-area="${entry.area}">Assign room</button>`);
  }
  if (ACTIVE.includes(entry.status)) {
    buttons.push(html`<button type="button" class="btn btn--danger btn--sm" data-act="cancelled" data-id="${id}">Cancel</button>`);
  }
  return buttons;
}

export default async function queueView({ outlet }) {
  setPage('Queue', 'Live waiting list, called patients and rooms.');

  let area = 'all';
  let showFinished = false;
  let autoRefresh = true;
  let pollTimer = null;
  let tickTimer = null;
  let entries = [];
  let loading = false;

  mount(
    outlet,
    html`<div class="queue">
      <div class="toolbar toolbar--wrap">
        <div class="tabs" role="tablist" aria-label="Queue area" id="area-tabs">
          ${AREAS.map(
            ([value, label]) => html`<button type="button" role="tab" class="tab${value === area ? ' is-selected' : ''}"
              data-area="${value}" aria-selected="${value === area}">${label}</button>`
          )}
        </div>

        <div class="toolbar__actions">
          <label class="switch">
            <input type="checkbox" id="show-finished" />
            <span>Show finished</span>
          </label>
          <label class="switch">
            <input type="checkbox" id="auto-refresh" checked />
            <span>Auto-refresh</span>
          </label>
          ${canManage() ? html`<button type="button" class="btn btn--primary" id="call-next">Call next</button>` : ''}
          <button type="button" class="btn btn--ghost" id="refresh">Refresh</button>
        </div>
      </div>

      <div class="summary" id="queue-summary" aria-live="polite">${summaryChips({})}</div>

      <section class="panel" aria-labelledby="queue-heading">
        <h2 id="queue-heading" class="panel__title">Waiting list</h2>
        <div id="queue-body">${spinner('Loading queue…')}</div>
      </section>
    </div>`
  );

  const body = outlet.querySelector('#queue-body');
  const summaryEl = outlet.querySelector('#queue-summary');
  const finishedToggle = outlet.querySelector('#show-finished');
  const autoToggle = outlet.querySelector('#auto-refresh');

  function setArea(next) {
    area = next;
    outlet.querySelectorAll('[data-area]').forEach((tab) => {
      const selected = tab.dataset.area === next;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    load();
  }

  async function loadSummary() {
    try {
      const summary = await api.get('/api/queue/summary');
      summaryEl.innerHTML = summaryChips(summary);
    } catch {
      /* summary is non-critical */
    }
  }

  async function load() {
    if (loading) return;
    loading = true;
    body.setAttribute('aria-busy', 'true');
    if (!entries.length) body.innerHTML = spinner();
    try {
      const params = {};
      if (area !== 'all') params.area = area;
      entries = await api.get('/api/queue', params);
      render();
    } catch (err) {
      body.innerHTML = errorState(err.message, { retry: 'queue-refresh' });
    } finally {
      loading = false;
      body.removeAttribute('aria-busy');
    }
  }

  function render() {
    const visible = entries.filter((entry) => showFinished || ACTIVE.includes(entry.status));
    if (!visible.length) {
      body.innerHTML = emptyState(showFinished ? 'The queue is empty.' : 'No patients waiting.');
      return;
    }
    body.innerHTML = html`<div class="table-wrap">
      <table class="table table--queue table--cards">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Patient</th>
            <th scope="col">Triage</th>
            <th scope="col">Area</th>
            <th scope="col">Waiting</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(
            (entry) => html`<tr class="row--${entry.status}">
              <td data-label="Ticket"><span class="ticket-no">#${entry.ticket_no}</span></td>
              <td data-label="Patient">
                <strong>${entry.first_name} ${entry.last_name}</strong>
                <span class="muted block">${entry.mrn}</span>
              </td>
              <td data-label="Triage">${triageBadge(entry.triage_level)}</td>
              <td data-label="Area">${entry.area}</td>
              <td data-label="Waiting">
                <span data-wait="${entry.id}" data-since="${entry.created_at}"
                  data-live="${ACTIVE.includes(entry.status) ? '1' : '0'}">
                  ${formatDuration(entry.wait_seconds)}
                </span>
              </td>
              <td data-label="Status">${statusBadge(entry.status)}</td>
              <td class="table__actions">${rowActions(entry)}</td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  function tick() {
    body.querySelectorAll('[data-wait][data-live="1"]').forEach((node) => {
      node.textContent = formatDuration(elapsedSeconds(node.dataset.since));
    });
  }

  async function act(id, status) {
    try {
      await api.patch(`/api/queue/${id}/status`, { status });
      toast(`Marked ${status.replace('_', ' ')}.`, 'success');
      announce(`Queue entry marked ${status}.`);
      await Promise.all([load(), loadSummary()]);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function route(visitId) {
    const dialog = openDialog({
      title: 'Assign room',
      size: 'sm',
      content: html`<form id="route-form">
        <div class="field">
          <label for="room_type">Room type</label>
          <select id="room_type" name="room_type">
            <option value="consult">Consultation</option>
            <option value="triage">Triage</option>
            <option value="procedure">Procedure</option>
            <option value="waiting">Waiting</option>
            <option value="other">Other</option>
          </select>
        </div>
        <p class="muted">The next free room of this type will be assigned automatically.</p>
        <p id="route-error" class="form-error" role="alert" hidden></p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn--primary" id="route-submit">Assign room</button>
        </div>
      </form>`,
    });
    const form = dialog.querySelector('#route-form');
    const errorBox = dialog.querySelector('#route-error');
    const submit = dialog.querySelector('#route-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      const { room_type } = formValues(form);
      setBusy(submit, true, 'Assigning…');
      try {
        const result = await api.post('/api/rooms/route', { visit_id: Number(visitId), room_type });
        toast(`Room ${result.room.code} assigned.`, 'success');
        dialog.close();
        await load();
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.hidden = false;
      } finally {
        setBusy(submit, false);
      }
    });
  }

  async function callNext() {
    if (area === 'all') {
      toast('Choose a specific area to call the next patient.', 'warning');
      return;
    }
    const button = outlet.querySelector('#call-next');
    setBusy(button, true, 'Calling…');
    try {
      const called = await api.post('/api/queue/call-next', { area });
      if (called) {
        toast(`Now calling ticket #${called.ticket_no}.`, 'success');
        announce(`Now calling ticket number ${called.ticket_no}.`, true);
      } else {
        toast('No one is waiting in this area.', 'warning');
      }
      await Promise.all([load(), loadSummary()]);
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setBusy(button, false);
    }
  }

  outlet.querySelectorAll('[data-area]').forEach((tab) =>
    tab.addEventListener('click', () => setArea(tab.dataset.area))
  );

  finishedToggle.addEventListener('change', () => {
    showFinished = finishedToggle.checked;
    render();
  });

  autoToggle.addEventListener('change', () => {
    autoRefresh = autoToggle.checked;
    schedulePoll();
  });

  delegate(body, '[data-act]', 'click', (event, button) => act(button.dataset.id, button.dataset.act));
  delegate(body, '[data-route]', 'click', (event, button) => route(button.dataset.visit));
  delegate(body, '[data-action="queue-refresh"]', 'click', () => load());

  const refreshBtn = outlet.querySelector('#refresh');
  refreshBtn.addEventListener('click', () => {
    load();
    loadSummary();
  });

  const callNextBtn = outlet.querySelector('#call-next');
  if (callNextBtn) callNextBtn.addEventListener('click', callNext);

  function schedulePoll() {
    if (pollTimer) window.clearInterval(pollTimer);
    if (autoRefresh) {
      pollTimer = window.setInterval(() => {
        if (!document.hidden) {
          load();
          loadSummary();
        }
      }, 15000);
    }
  }

  await Promise.all([load(), loadSummary()]);
  tickTimer = window.setInterval(tick, 1000);
  schedulePoll();

  return () => {
    if (pollTimer) window.clearInterval(pollTimer);
    if (tickTimer) window.clearInterval(tickTimer);
  };
}
