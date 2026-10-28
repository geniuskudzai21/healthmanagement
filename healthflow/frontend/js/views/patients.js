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
  statusBadge,
} from '../ui.js';

const SEX_OPTIONS = ['female', 'male'];
const BLOOD_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function canRegister() {
  return hasRole('reception', 'admin');
}

function canCheckIn() {
  return hasRole('reception', 'nurse', 'admin');
}

function sexLabel(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—';
}

function registerForm() {
  return html`<form id="patient-form" novalidate>
    <div class="form-grid">
      <div class="field">
        <label for="mrn">Medical record no.</label>
        <input id="mrn" name="mrn" required maxlength="40" />
      </div>
      <div class="field">
        <label for="date_of_birth">Date of birth</label>
        <input id="date_of_birth" name="date_of_birth" type="date" required />
      </div>
      <div class="field">
        <label for="first_name">First name</label>
        <input id="first_name" name="first_name" required maxlength="100" />
      </div>
      <div class="field">
        <label for="last_name">Last name</label>
        <input id="last_name" name="last_name" required maxlength="100" />
      </div>
      <div class="field">
        <label for="sex">Sex</label>
        <select id="sex" name="sex" required>
          ${SEX_OPTIONS.map((s) => html`<option value="${s}">${sexLabel(s)}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="blood_type">Blood type</label>
        <select id="blood_type" name="blood_type">
          <option value="">Unknown</option>
          ${BLOOD_OPTIONS.map((b) => html`<option value="${b}">${b}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="phone">Phone</label>
        <input id="phone" name="phone" type="tel" maxlength="40" />
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" maxlength="200" />
      </div>
      <div class="field field--full">
        <label for="address">Address</label>
        <input id="address" name="address" maxlength="500" />
      </div>
      <div class="field field--full">
        <label for="allergies">Allergies</label>
        <textarea id="allergies" name="allergies" rows="2" maxlength="1000"></textarea>
      </div>
    </div>
    <p id="patient-error" class="form-error" role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn--primary" id="patient-submit">Save patient</button>
    </div>
  </form>`;
}

async function openRegisterDialog(onSaved) {
  const dialog = openDialog({ title: 'Register patient', content: registerForm(), size: 'lg' });
  const form = dialog.querySelector('#patient-form');
  const errorBox = dialog.querySelector('#patient-error');
  const submit = dialog.querySelector('#patient-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);

    const values = formValues(form);
    const payload = { ...values };
    if (!payload.blood_type) delete payload.blood_type;
    ['email', 'phone', 'address', 'allergies'].forEach((key) => {
      if (!payload[key]) delete payload[key];
    });

    setBusy(submit, true, 'Saving…');
    try {
      const patient = await api.post('/api/patients', payload);
      toast(`${patient.first_name} ${patient.last_name} registered.`, 'success');
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

function openPatientDialog(patient) {
  openDialog({
    title: `${patient.first_name} ${patient.last_name}`,
    content: html`<dl class="detail-list">
      <div><dt>MRN</dt><dd>${patient.mrn}</dd></div>
      <div><dt>Date of birth</dt><dd>${formatDate(patient.date_of_birth)}</dd></div>
      <div><dt>Sex</dt><dd>${sexLabel(patient.sex)}</dd></div>
      <div><dt>Phone</dt><dd>${patient.phone || '—'}</dd></div>
      <div><dt>Email</dt><dd>${patient.email || '—'}</dd></div>
      <div><dt>Blood type</dt><dd>${patient.blood_type || '—'}</dd></div>
      <div><dt>Allergies</dt><dd>${patient.allergies || 'None recorded'}</dd></div>
      <div><dt>Address</dt><dd>${patient.address || '—'}</dd></div>
      <div><dt>Status</dt><dd>${patient.is_active ? 'Active' : 'Inactive'}</dd></div>
      <div><dt>Registered by</dt><dd>${patient.created_by_name || '—'}</dd></div>
    </dl>`,
    size: 'md',
  });
}

export default async function patientsView({ outlet }) {
  setPage('Patients', 'Search the register and admit new patients.');

  mount(
    outlet,
    html`<div class="toolbar">
      <form class="search" id="patient-search" role="search">
        <label class="sr-only" for="patient-query">Search patients</label>
        <input id="patient-query" name="q" type="search" placeholder="Search by name, MRN or phone" autocomplete="off" />
        <button type="submit" class="btn btn--primary">Search</button>
      </form>
      ${canRegister() ? html`<button type="button" class="btn btn--primary" id="add-patient">＋ Register patient</button>` : ''}
    </div>

    <section class="panel" aria-labelledby="results-heading">
      <h2 id="results-heading" class="panel__title">Register</h2>
      <p id="patient-meta" class="muted" aria-live="polite"></p>
      <div id="patient-results">${spinner('Loading patients…')}</div>
    </section>`
  );

  const results = outlet.querySelector('#patient-results');
  const meta = outlet.querySelector('#patient-meta');
  const searchForm = outlet.querySelector('#patient-search');
  const addButton = outlet.querySelector('#add-patient');

  async function load(query = '') {
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = spinner();
    try {
      const [patients, stats] = await Promise.all([
        api.get('/api/patients', { q: query, limit: 50 }),
        api.get('/api/patients/stats'),
      ]);
      meta.textContent = `${stats.total} patient${stats.total === 1 ? '' : 's'} in the system · ${stats.active} active`;
      renderList(patients);
    } catch (err) {
      results.innerHTML = errorState(err.message, { retry: 'reload' });
    } finally {
      results.removeAttribute('aria-busy');
    }
  }

  function renderList(patients) {
    if (!patients.length) {
      results.innerHTML = emptyState('No patients match your search.');
      return;
    }
    results.innerHTML = html`<div class="table-wrap">
      <table class="table table--cards">
        <thead>
          <tr>
            <th scope="col">MRN</th>
            <th scope="col">Name</th>
            <th scope="col">Date of birth</th>
            <th scope="col">Sex</th>
            <th scope="col">Phone</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${patients.map(
            (patient) => html`<tr>
              <td data-label="MRN">${patient.mrn}</td>
              <td data-label="Name"><strong>${patient.first_name} ${patient.last_name}</strong></td>
              <td data-label="Date of birth">${formatDate(patient.date_of_birth)}</td>
              <td data-label="Sex">${sexLabel(patient.sex)}</td>
              <td data-label="Phone">${patient.phone || '—'}</td>
              <td data-label="Status">${patient.is_active ? statusBadge('active') : statusBadge('inactive')}</td>
              <td class="table__actions">
                <button type="button" class="btn btn--ghost btn--sm" data-view="${patient.id}">View</button>
                ${canCheckIn() ? html`<button type="button" class="btn btn--sm" data-checkin="${patient.id}">Check in</button>` : ''}
              </td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    load(searchForm.elements.q.value.trim());
  });

  if (addButton) {
    addButton.addEventListener('click', () => openRegisterDialog(() => load(searchForm.elements.q.value.trim())));
  }

  delegate(results, '[data-view]', 'click', async (event, button) => {
    try {
      const patient = await api.get(`/api/patients/${button.dataset.view}`);
      openPatientDialog(patient);
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  delegate(results, '[data-checkin]', 'click', (event, button) => {
    sessionStorage.setItem('hf_checkin_patient', button.dataset.checkin);
    navigate('/check-in');
  });

  delegate(results, '[data-action="reload"]', 'click', () => load(searchForm.elements.q.value.trim()));

  await load();
  return null;
}
