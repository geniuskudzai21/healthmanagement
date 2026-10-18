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
  formatTime,
  statusBadge,
  toLocalInputValue,
  fromLocalInputValue,
  addMinutes,
  todayIso,
} from '../ui.js';
import { patientPicker, fillClinicianSelect, fillRoomSelect } from '../components.js';

const STATUSES = [
  ['scheduled', 'Scheduled'],
  ['checked_in', 'Checked in'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['no_show', 'No show'],
];

function canCreate() {
  return hasRole('reception', 'admin');
}

function canDelete() {
  return hasRole('admin');
}

function defaultWindow() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const startIso = start.toISOString();
  return { start: toLocalInputValue(startIso), end: toLocalInputValue(addMinutes(startIso, 30)) };
}

async function openCreateDialog(onSaved) {
  const { start, end } = defaultWindow();
  const dialog = openDialog({
    title: 'New appointment',
    size: 'lg',
    content: html`<form id="appt-form" novalidate>
      <div class="form-grid">
        <div class="field field--full">
          <label for="patient-search">Patient</label>
          <div id="appt-patient-picker"></div>
        </div>
        <div class="field">
          <label for="clinician_id">Clinician</label>
          <select id="clinician_id" name="clinician_id" required></select>
        </div>
        <div class="field">
          <label for="room_id">Room</label>
          <select id="room_id" name="room_id"></select>
        </div>
        <div class="field">
          <label for="scheduled_start">Start</label>
          <input id="scheduled_start" name="scheduled_start" type="datetime-local" value="${start}" required />
        </div>
        <div class="field">
          <label for="scheduled_end">End</label>
          <input id="scheduled_end" name="scheduled_end" type="datetime-local" value="${end}" required />
        </div>
        <div class="field field--full">
          <label for="reason">Reason</label>
          <input id="reason" name="reason" maxlength="1000" />
        </div>
        <div class="field field--full">
          <label for="notes">Notes</label>
          <textarea id="notes" name="notes" rows="2" maxlength="2000"></textarea>
        </div>
      </div>
      <p id="appt-error" class="form-error" role="alert" hidden></p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn--primary" id="appt-submit">Schedule</button>
      </div>
    </form>`,
  });

  const form = dialog.querySelector('#appt-form');
  const errorBox = dialog.querySelector('#appt-error');
  const submit = dialog.querySelector('#appt-submit');

  const picker = patientPicker(dialog.querySelector('#appt-patient-picker'), {});
  const clinicianSelect = dialog.querySelector('#clinician_id');
  const roomSelect = dialog.querySelector('#room_id');

  try {
    await Promise.all([
      fillClinicianSelect(clinicianSelect),
      fillRoomSelect(roomSelect, { includeEmpty: 'No room' }),
    ]);
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);

    const patient = picker.getSelected();
    if (!patient) {
      errorBox.textContent = 'Choose a patient for this appointment.';
      errorBox.hidden = false;
      return;
    }

    const values = formValues(form);
    const payload = {
      patient_id: patient.id,
      clinician_id: Number(values.clinician_id),
      scheduled_start: fromLocalInputValue(values.scheduled_start),
      scheduled_end: fromLocalInputValue(values.scheduled_end),
    };
    if (values.room_id) payload.room_id = Number(values.room_id);
    if (values.reason) payload.reason = values.reason;
    if (values.notes) payload.notes = values.notes;

    if (!payload.clinician_id) {
      errorBox.textContent = 'Choose a clinician.';
      errorBox.hidden = false;
      return;
    }

    setBusy(submit, true, 'Scheduling…');
    try {
      await api.post('/api/appointments', payload);
      toast('Appointment scheduled.', 'success');
      dialog.close();
      await onSaved();
    } catch (err) {
      if (err.status === 409) {
        errorBox.textContent = 'That time is already booked for this clinician or room. Pick another slot.';
      } else if (err.details && err.details.fields) {
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

function rowActions(appt) {
  const buttons = [];
  const canAct = hasRole('reception', 'nurse', 'clinician', 'admin');
  if (appt.status === 'scheduled' && canAct) {
    buttons.push(html`<button type="button" class="btn btn--sm" data-status="checked_in" data-id="${appt.id}">Check in</button>`);
  }
  if (['scheduled', 'checked_in'].includes(appt.status) && canAct) {
    buttons.push(html`<button type="button" class="btn btn--success btn--sm" data-status="completed" data-id="${appt.id}">Complete</button>`);
    buttons.push(html`<button type="button" class="btn btn--danger btn--sm" data-status="no_show" data-id="${appt.id}">No show</button>`);
  }
  if (!['cancelled', 'completed'].includes(appt.status) && canAct) {
    buttons.push(html`<button type="button" class="btn btn--ghost btn--sm" data-status="cancelled" data-id="${appt.id}">Cancel</button>`);
  }
  if (canDelete()) {
    buttons.push(html`<button type="button" class="btn btn--danger btn--sm" data-delete="${appt.id}">Delete</button>`);
  }
  return buttons;
}

export default async function appointmentsView({ outlet }) {
  setPage('Appointments', 'Book, reschedule and track scheduled visits.');

  let date = todayIso();
  let status = '';

  mount(
    outlet,
    html`<div class="toolbar toolbar--wrap">
      <form class="toolbar__filters" id="appt-filters">
        <div class="field field--inline">
          <label for="appt-date">Day</label>
          <input id="appt-date" name="date" type="date" value="${date}" />
        </div>
        <div class="field field--inline">
          <label for="appt-status">Status</label>
          <select id="appt-status" name="status">
            <option value="">All</option>
            ${STATUSES.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
          </select>
        </div>
      </form>
      ${canCreate() ? html`<button type="button" class="btn btn--primary" id="add-appt">＋ New appointment</button>` : ''}
    </div>

    <section class="panel" aria-labelledby="appt-heading">
      <h2 id="appt-heading" class="panel__title">Schedule</h2>
      <div id="appt-body">${spinner('Loading appointments…')}</div>
    </section>`
  );

  const body = outlet.querySelector('#appt-body');
  const dateInput = outlet.querySelector('#appt-date');
  const statusSelect = outlet.querySelector('#appt-status');

  function dayRange() {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 3600000);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  async function load() {
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = spinner();
    try {
      const { from, to } = dayRange();
      const params = { from, to };
      if (status) params.status = status;
      const appointments = await api.get('/api/appointments', params);
      render(appointments);
    } catch (err) {
      body.innerHTML = errorState(err.message, { retry: 'appt-refresh' });
    } finally {
      body.removeAttribute('aria-busy');
    }
  }

  function render(appointments) {
    if (!appointments.length) {
      body.innerHTML = emptyState('No appointments for this day.');
      return;
    }
    body.innerHTML = html`<div class="table-wrap">
      <table class="table table--cards">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Patient</th>
            <th scope="col">Clinician</th>
            <th scope="col">Room</th>
            <th scope="col">Reason</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${appointments.map(
            (appt) => html`<tr>
              <td data-label="Time">
                <strong>${formatTime(appt.scheduled_start)}</strong>
                <span class="muted block">${formatDate(appt.scheduled_start)}</span>
              </td>
              <td data-label="Patient">
                <strong>${appt.patient_first_name} ${appt.patient_last_name}</strong>
                <span class="muted block">${appt.mrn}</span>
              </td>
              <td data-label="Clinician">${appt.clinician_name}</td>
              <td data-label="Room">${appt.room_code || '—'}</td>
              <td data-label="Reason">${appt.reason || '—'}</td>
              <td data-label="Status">${statusBadge(appt.status)}</td>
              <td class="table__actions">${rowActions(appt)}</td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  async function setStatus(id, next) {
    if (next === 'cancelled' || next === 'no_show') {
      const ok = await confirmDialog({
        title: next === 'cancelled' ? 'Cancel appointment' : 'Mark as no-show',
        message: 'This will update the appointment status.',
        confirmLabel: next === 'cancelled' ? 'Cancel appointment' : 'Mark no-show',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const result = await api.patch(`/api/appointments/${id}/status`, { status: next });
      if (next === 'checked_in') {
        toast(result && result.queued ? 'Checked in and added to the queue.' : 'Checked in.', 'success');
      } else {
        toast('Appointment updated.', 'success');
      }
      announce('Appointment status updated.');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function remove(id) {
    const ok = await confirmDialog({
      title: 'Delete appointment',
      message: 'This permanently removes the appointment.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/appointments/${id}`);
      toast('Appointment deleted.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  dateInput.addEventListener('change', () => {
    date = dateInput.value || todayIso();
    load();
  });
  statusSelect.addEventListener('change', () => {
    status = statusSelect.value;
    load();
  });

  delegate(body, '[data-status]', 'click', (event, button) => setStatus(button.dataset.id, button.dataset.status));
  delegate(body, '[data-delete]', 'click', (event, button) => remove(button.dataset.delete));
  delegate(body, '[data-action="appt-refresh"]', 'click', load);

  const addBtn = outlet.querySelector('#add-appt');
  if (addBtn) addBtn.addEventListener('click', () => openCreateDialog(load));

  await load();
  return null;
}
