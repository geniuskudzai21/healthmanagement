/* Reusable form components shared by views. */
import { api } from './api.js';
import { html, mount, delegate, emptyState, spinner } from './ui.js';

/**
 * Searchable patient picker. Renders a search box + result list; calls
 * onSelect(patient) when a patient is chosen.
 * Returns { element, getSelected, setSelected }.
 */
export function patientPicker(container, { onSelect, placeholder = 'Search by name, MRN or phone' } = {}) {
  let selected = null;
  let timer = null;

  mount(
    container,
    html`<div class="picker">
      <div class="field">
        <label class="sr-only" for="picker-search">${placeholder}</label>
        <input id="picker-search" type="search" placeholder="${placeholder}" autocomplete="off"
          role="combobox" aria-expanded="false" aria-controls="picker-results" />
      </div>
      <div id="picker-results" class="picker__results" role="listbox" aria-label="Patient results"></div>
      <div id="picker-selected" class="picker__selected" hidden></div>
    </div>`
  );

  const input = container.querySelector('#picker-search');
  const results = container.querySelector('#picker-results');
  const selectedBox = container.querySelector('#picker-selected');

  function showSelected(patient) {
    selected = patient;
    results.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    if (!patient) {
      selectedBox.hidden = true;
      selectedBox.innerHTML = '';
      return;
    }
    mount(
      selectedBox,
      html`<div class="chip">
        <span class="chip__text">
          <strong>${patient.first_name} ${patient.last_name}</strong>
          <span class="muted">${patient.mrn} · ${patient.date_of_birth ? String(patient.date_of_birth).slice(0, 10) : '—'}</span>
        </span>
        <button type="button" class="chip__remove" data-clear aria-label="Clear selected patient">✕</button>
      </div>`
    );
    selectedBox.hidden = false;
    if (typeof onSelect === 'function') onSelect(patient);
  }

  async function search(term) {
    results.innerHTML = spinner('Searching…');
    input.setAttribute('aria-expanded', 'true');
    try {
      const patients = await api.get('/api/patients', { q: term, limit: 10 });
      results.innerHTML = patients.length
        ? patients
            .map(
              (patient) => html`<button type="button" class="picker__item" role="option"
                aria-selected="false" data-id="${patient.id}">
                <span class="picker__item-title">${patient.first_name} ${patient.last_name}</span>
                <span class="picker__item-sub">${patient.mrn} · ${patient.phone || 'no phone'}</span>
              </button>`
            )
            .join('')
        : emptyState('No matching patients.');
    } catch (err) {
      results.innerHTML = html`<p class="form-error" role="alert">${err.message}</p>`;
    }
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    const term = input.value;
    timer = window.setTimeout(() => {
      if (term.trim().length === 0) {
        results.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      search(term);
    }, 300);
  });

  delegate(results, '.picker__item', 'click', async (event, button) => {
    try {
      const patient = await api.get(`/api/patients/${button.dataset.id}`);
      showSelected(patient);
    } catch (err) {
      results.innerHTML = html`<p class="form-error" role="alert">${err.message}</p>`;
    }
  });

  delegate(selectedBox, '[data-clear]', 'click', () => {
    input.value = '';
    input.focus();
    showSelected(null);
  });

  return {
    element: container,
    getSelected: () => selected,
    setSelected: showSelected,
  };
}

/** Fill a <select> with active clinicians. */
export async function fillClinicianSelect(select, { includeEmpty = 'Select clinician', selectedId = '' } = {}) {
  const clinicians = await api.get('/api/clinicians');
  select.innerHTML = [
    includeEmpty ? html`<option value="">${includeEmpty}</option>` : '',
    ...clinicians.map(
      (clinician) => html`<option value="${clinician.id}"${String(clinician.id) === String(selectedId) ? ' selected' : ''}>
        ${clinician.full_name}
      </option>`
    ),
  ].join('');
  return clinicians;
}

/** Fill a <select> with rooms (optionally only available ones). */
export async function fillRoomSelect(select, { availableOnly = false, includeEmpty = 'No room', selectedId = '' } = {}) {
  const rooms = availableOnly ? await api.get('/api/rooms/available') : await api.get('/api/rooms');
  select.innerHTML = [
    includeEmpty ? html`<option value="">${includeEmpty}</option>` : '',
    ...rooms.map(
      (room) => html`<option value="${room.id}"${String(room.id) === String(selectedId) ? ' selected' : ''}>
        ${room.code} — ${room.name}${room.status ? ` (${room.status})` : ''}
      </option>`
    ),
  ].join('');
  return rooms;
}
