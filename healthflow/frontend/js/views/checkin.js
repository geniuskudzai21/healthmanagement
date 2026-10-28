import { api } from '../api.js';
import {
  html,
  mount,
  setPage,
  toast,
  announce,
  el,
  setBusy,
  formValues,
  showFieldErrors,
  clearFieldErrors,
} from '../ui.js';
import { patientPicker } from '../components.js';
import { navigate } from '../router.js';

const SEX_OPTIONS = ['female', 'male'];
const VISIT_TYPES = [
  ['walk-in', 'Walk-in'],
  ['appointment', 'Appointment'],
  ['follow-up', 'Follow-up'],
];

function sexLabel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function successCard({ patient, visit, queue_entry }) {
  return html`<section class="panel panel--accent" aria-live="polite">
    <h2 class="panel__title">Checked in</h2>
    <p class="ticket">
      <span class="ticket__label">${queue_entry.area} ticket</span>
      <strong class="ticket__number">#${queue_entry.ticket_no}</strong>
    </p>
    <p>
      <strong>${patient.first_name} ${patient.last_name}</strong>
      <span class="muted"> · ${patient.mrn}</span>
    </p>
    <dl class="detail-list detail-list--inline">
      <div><dt>Area</dt><dd>${queue_entry.area}</dd></div>
      <div><dt>Priority</dt><dd>P${queue_entry.priority}</dd></div>
      <div><dt>Visit</dt><dd>#${visit.id}</dd></div>
    </dl>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-another>Check in another</button>
      <button type="button" class="btn btn--primary" data-goto-queue>View queue</button>
    </div>
  </section>`;
}

export default function checkinView({ outlet }) {
  setPage('Check-in', 'Admit a walk-in or booked patient and add them to the queue.');

  mount(
    outlet,
    html`<div class="grid grid--2">
      <section class="panel" aria-labelledby="who-heading">
        <h2 id="who-heading" class="panel__title">1. Who is being seen?</h2>
        <div class="tabs" role="tablist" aria-label="Patient source">
          <button type="button" role="tab" class="tab is-selected" id="tab-existing"
            aria-selected="true" aria-controls="panel-existing" data-mode="existing">Existing patient</button>
          <button type="button" role="tab" class="tab" id="tab-new"
            aria-selected="false" aria-controls="panel-new" data-mode="new">New patient</button>
        </div>

        <div id="panel-existing" role="tabpanel" aria-labelledby="tab-existing" class="tabpanel">
          <div id="patient-picker"></div>
        </div>

        <div id="panel-new" role="tabpanel" aria-labelledby="tab-new" class="tabpanel" hidden>
          <div class="form-grid">
            <div class="field">
              <label for="new-mrn">Medical record no.</label>
              <input id="new-mrn" name="mrn" maxlength="40" required />
            </div>
            <div class="field">
              <label for="new-dob">Date of birth</label>
              <input id="new-dob" name="date_of_birth" type="date" required />
            </div>
            <div class="field">
              <label for="new-first">First name</label>
              <input id="new-first" name="first_name" maxlength="100" required />
            </div>
            <div class="field">
              <label for="new-last">Last name</label>
              <input id="new-last" name="last_name" maxlength="100" required />
            </div>
            <div class="field">
              <label for="new-sex">Sex</label>
              <select id="new-sex" name="sex" required>
                ${SEX_OPTIONS.map((s) => html`<option value="${s}">${sexLabel(s)}</option>`)}
              </select>
            </div>
            <div class="field">
              <label for="new-phone">Phone</label>
              <input id="new-phone" name="phone" type="tel" maxlength="40" />
            </div>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="visit-heading">
        <h2 id="visit-heading" class="panel__title">2. Visit details</h2>
        <form id="checkin-form" novalidate>
          <div class="field">
            <label for="visit_type">Visit type</label>
            <select id="visit_type" name="visit_type">
              ${VISIT_TYPES.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
            </select>
          </div>
          <div class="field">
            <label for="triage_level">Triage level (1 = most urgent)</label>
            <select id="triage_level" name="triage_level">
              ${[1, 2, 3, 4, 5].map(
                (level) => html`<option value="${level}"${level === 3 ? ' selected' : ''}>P${level}</option>`
              )}
            </select>
          </div>
          <div class="field">
            <label for="chief_complaint">Chief complaint</label>
            <textarea id="chief_complaint" name="chief_complaint" rows="3" maxlength="1000"
              placeholder="Brief reason for visit"></textarea>
          </div>
          <p id="checkin-error" class="form-error" role="alert" hidden></p>
          <button type="submit" class="btn btn--primary btn--block" id="checkin-submit">
            Check in & add to queue
          </button>
        </form>
      </section>
    </div>`
  );

  const tabs = outlet.querySelectorAll('[data-mode]');
  const panelExisting = outlet.querySelector('#panel-existing');
  const panelNew = outlet.querySelector('#panel-new');
  const form = outlet.querySelector('#checkin-form');
  const errorBox = outlet.querySelector('#checkin-error');
  const submit = outlet.querySelector('#checkin-submit');

  let mode = 'existing';
  const picker = patientPicker(outlet.querySelector('#patient-picker'), {});

  function setMode(next) {
    mode = next;
    tabs.forEach((tab) => {
      const selected = tab.dataset.mode === next;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    });
    panelExisting.hidden = next !== 'existing';
    panelNew.hidden = next !== 'new';
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  function collect() {
    const visit = formValues(form);
    visit.triage_level = Number(visit.triage_level);
    visit.area = 'consult';

    if (mode === 'existing') {
      const patient = picker.getSelected();
      if (!patient) return { error: 'Select an existing patient, or switch to New patient.' };
      return { payload: { ...visit, patient_id: patient.id } };
    }

    const p = formValues(outlet.querySelector('#panel-new'));
    if (!p.mrn || !p.first_name || !p.last_name || !p.date_of_birth || !p.sex) {
      return { error: 'Enter MRN, name, date of birth and sex for the new patient.' };
    }
    if (!p.phone) delete p.phone;
    return { payload: { ...visit, ...p } };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);

    const { payload, error } = collect();
    if (error) {
      errorBox.textContent = error;
      errorBox.hidden = false;
      announce(error, true);
      return;
    }

    setBusy(submit, true, 'Checking in…');
    try {
      const result = await api.post('/api/check-in', payload);
      sessionStorage.removeItem('hf_checkin_patient');
      toast(`Ticket #${result.queue_entry.ticket_no} issued for ${result.patient.first_name}.`, 'success');
      announce(`Checked in. Ticket number ${result.queue_entry.ticket_no}.`);
      showSuccess(result);
    } catch (err) {
      if (err.details && err.details.fields) {
        showFieldErrors(form, err.details.fields);
        errorBox.textContent = 'Please correct the highlighted fields.';
      } else {
        errorBox.textContent = err.message;
      }
      errorBox.hidden = false;
      announce(errorBox.textContent, true);
    } finally {
      setBusy(submit, false);
    }
  });

  function showSuccess(result) {
    const card = el(successCard(result));
    outlet.replaceChildren(card);
    card.querySelector('[data-another]').addEventListener('click', () => checkinView({ outlet }));
    card.querySelector('[data-goto-queue]').addEventListener('click', () => navigate('/queue'));
  }

  // Prefill from a patient chosen elsewhere (e.g. the Patients page).
  const prefillId = sessionStorage.getItem('hf_checkin_patient');
  if (prefillId) {
    api
      .get(`/api/patients/${prefillId}`)
      .then((patient) => {
        setMode('existing');
        picker.setSelected(patient);
      })
      .catch(() => {});
  }

  return null;
}
