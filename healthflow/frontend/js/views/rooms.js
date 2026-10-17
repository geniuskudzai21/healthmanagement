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
  delegate,
  setBusy,
  formValues,
  openDialog,
  confirmDialog,
  showFieldErrors,
  clearFieldErrors,
  statusBadge,
} from '../ui.js';

const TYPES = [
  ['consult', 'Consultation'],
  ['triage', 'Triage'],
  ['procedure', 'Procedure'],
  ['waiting', 'Waiting'],
  ['other', 'Other'],
];

const STATUSES = [
  ['available', 'Available'],
  ['occupied', 'Occupied'],
  ['maintenance', 'Maintenance'],
  ['reserved', 'Reserved'],
];

function isAdmin() {
  return hasRole('admin');
}

/** Nurses, clinicians and admins can change a room's status / release it. */
function canManage() {
  return hasRole('nurse', 'clinician', 'admin');
}

function typeLabel(value) {
  const found = TYPES.find(([v]) => v === value);
  return found ? found[1] : value;
}

function roomForm(room = {}) {
  return html`<form id="room-form" novalidate>
    <div class="form-grid">
      <div class="field">
        <label for="code">Code</label>
        <input id="code" name="code" required maxlength="40" value="${room.code || ''}" />
      </div>
      <div class="field">
        <label for="name">Name</label>
        <input id="name" name="name" required maxlength="120" value="${room.name || ''}" />
      </div>
      <div class="field">
        <label for="room_type">Type</label>
        <select id="room_type" name="room_type">
          ${TYPES.map(([v, l]) => html`<option value="${v}"${room.room_type === v ? ' selected' : ''}>${l}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="status">Status</label>
        <select id="status" name="status">
          ${STATUSES.map(([v, l]) => html`<option value="${v}"${room.status === v ? ' selected' : ''}>${l}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="floor">Floor</label>
        <input id="floor" name="floor" maxlength="40" value="${room.floor || ''}" />
      </div>
      <div class="field field--full">
        <label for="notes">Notes</label>
        <textarea id="notes" name="notes" rows="2" maxlength="500">${room.notes || ''}</textarea>
      </div>
    </div>
    <p id="room-error" class="form-error" role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn--primary" id="room-submit">${room.id ? 'Save changes' : 'Create room'}</button>
    </div>
  </form>`;
}

async function openRoomDialog({ room = null, onSaved }) {
  const editing = Boolean(room && room.id);
  const dialog = openDialog({
    title: editing ? `Edit ${room.code}` : 'New room',
    content: roomForm(room || {}),
    size: 'md',
  });
  const form = dialog.querySelector('#room-form');
  const errorBox = dialog.querySelector('#room-error');
  const submit = dialog.querySelector('#room-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);

    const values = formValues(form);
    const payload = { ...values };
    if (!payload.floor) delete payload.floor;
    if (!payload.notes) delete payload.notes;

    setBusy(submit, true, 'Saving…');
    try {
      if (editing) {
        await api.patch(`/api/rooms/${room.id}`, payload);
        toast(`${payload.code} updated.`, 'success');
      } else {
        await api.post('/api/rooms', payload);
        toast(`${payload.code} created.`, 'success');
      }
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

function chip(label, value, tone = 'default') {
  return html`<span class="chip chip--stat chip--${tone}"><strong>${value}</strong> ${label}</span>`;
}

export default async function roomsView({ outlet }) {
  setPage('Rooms', 'Consultation, triage and procedure rooms — who is free right now.');

  mount(
    outlet,
    html`<div class="toolbar toolbar--wrap">
      <div id="room-stats" class="summary" aria-live="polite"></div>
      ${isAdmin() ? html`<button type="button" class="btn btn--primary" id="add-room">＋ New room</button>` : ''}
    </div>

    <section class="panel" aria-labelledby="rooms-heading">
      <h2 id="rooms-heading" class="panel__title">Rooms</h2>
      <div id="room-results">${spinner('Loading rooms…')}</div>
    </section>`
  );

  const statsEl = outlet.querySelector('#room-stats');
  const results = outlet.querySelector('#room-results');
  const addButton = outlet.querySelector('#add-room');

  async function load() {
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = spinner();
    try {
      const rooms = await api.get('/api/rooms');
      renderStats(rooms);
      renderList(rooms);
    } catch (err) {
      statsEl.innerHTML = '';
      results.innerHTML = errorState(err.message, { retry: 'reload' });
    } finally {
      results.removeAttribute('aria-busy');
    }
  }

  function renderStats(rooms) {
    const count = (status) => rooms.filter((room) => room.status === status).length;
    statsEl.innerHTML = html`
      ${chip('available', count('available'), 'success')}
      ${chip('occupied', count('occupied'), 'warning')}
      ${chip('maintenance', count('maintenance'), 'danger')}
      ${chip('total rooms', rooms.length, 'info')}
    `;
  }

  function renderList(rooms) {
    if (!rooms.length) {
      results.innerHTML = emptyState(
        'No rooms yet.',
        isAdmin() ? 'Use "New room" to add the first one.' : 'Ask an admin to add rooms.'
      );
      return;
    }
    results.innerHTML = html`<div class="table-wrap">
      <table class="table table--cards">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Floor</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${rooms.map(
            (room) => html`<tr>
              <td data-label="Code"><strong>${room.code}</strong></td>
              <td data-label="Name">${room.name}</td>
              <td data-label="Type">${typeLabel(room.room_type)}</td>
              <td data-label="Floor">${room.floor || '—'}</td>
              <td data-label="Status">${statusBadge(room.status)}</td>
              <td class="table__actions">
                ${canManage() && room.status !== 'available'
                  ? html`<button type="button" class="btn btn--ghost btn--sm" data-release="${room.id}">Set available</button>`
                  : ''}
                ${isAdmin() ? html`<button type="button" class="btn btn--ghost btn--sm" data-edit="${room.id}">Edit</button>` : ''}
                ${isAdmin() ? html`<button type="button" class="btn btn--sm" data-delete="${room.id}">Delete</button>` : ''}
              </td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  if (addButton) {
    addButton.addEventListener('click', () => openRoomDialog({ onSaved: load }));
  }

  delegate(results, '[data-action="reload"]', 'click', load);

  delegate(results, '[data-edit]', 'click', async (event, button) => {
    try {
      const room = await api.get(`/api/rooms/${button.dataset.edit}`);
      openRoomDialog({ room, onSaved: load });
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  delegate(results, '[data-release]', 'click', async (event, button) => {
    setBusy(button, true, '…');
    try {
      await api.post(`/api/rooms/${button.dataset.release}/release`, {});
      toast('Room marked available.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
      setBusy(button, false);
    }
  });

  delegate(results, '[data-delete]', 'click', async (event, button) => {
    const id = button.dataset.delete;
    const ok = await confirmDialog({
      title: 'Delete room',
      message: 'Remove this room from the system? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/rooms/${id}`);
      toast('Room deleted.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  await load();
  return null;
}
