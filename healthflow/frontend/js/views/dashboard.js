import { api } from '../api.js';
import { getUser } from '../auth.js';
import {
  html,
  mount,
  setPage,
  errorState,
  emptyState,
  formatDuration,
  formatTime,
  elapsedSeconds,
  statusBadge,
  triageBadge,
  skeletonStats,
  skeletonRows,
  icon,
} from '../ui.js';

function startOfTodayIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.toISOString();
}

function endOfTodayIso() {
  const start = new Date();
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return end.toISOString();
}

function isToday(value) {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function statCard({ label, value, hint, tone = 'default', iconName = '' }) {
  return html`<div class="stat stat--${tone}">
    <span class="stat__label">${iconName ? icon(iconName, { size: 16 }) : ''} ${label}</span>
    <span class="stat__value">${value}</span>
    ${hint ? html`<span class="stat__hint">${hint}</span>` : ''}
  </div>`;
}

const ACTIVE = ['waiting', 'called', 'in_room', 'in_vitals', 'in_consult'];

export default async function dashboardView({ outlet }) {
  const user = getUser();
  setPage('Dashboard', `Hello ${user.full_name} — here is today at a glance.`);

  mount(
    outlet,
    html`<div class="grid">
      <section class="panel" aria-labelledby="stats-heading">
        <h2 id="stats-heading" class="panel__title">Today</h2>
        <div id="stats" class="stats stats--dashboard">${skeletonStats(8)}</div>
      </section>

      <section class="panel" aria-labelledby="nextup-heading">
        <h2 id="nextup-heading" class="panel__title">Live queue</h2>
        <div id="nextup">${skeletonRows(5)}</div>
      </section>

      <section class="panel" aria-labelledby="appts-heading">
        <h2 id="appts-heading" class="panel__title">Today's appointments</h2>
        <div id="appts">${skeletonRows(4)}</div>
      </section>
    </div>`
  );

  const statsEl = outlet.querySelector('#stats');
  const nextupEl = outlet.querySelector('#nextup');
  const apptsEl = outlet.querySelector('#appts');

  let ticker = null;
  let queueEntries = [];

  async function loadStats() {
    const [summary, visits, appointments, rooms, patients] = await Promise.allSettled([
      api.get('/api/queue/summary'),
      api.get('/api/visits', { limit: 200 }),
      api.get('/api/appointments', { from: startOfTodayIso(), to: endOfTodayIso() }),
      api.get('/api/rooms'),
      api.get('/api/patients/stats'),
    ]);

    if (summary.status === 'rejected' && visits.status === 'rejected') {
      statsEl.innerHTML = errorState(summary.reason.message);
      return;
    }

    const queue = summary.status === 'fulfilled' ? summary.value : {};
    const visitList = visits.status === 'fulfilled' ? visits.value : [];
    const apptList = appointments.status === 'fulfilled' ? appointments.value : [];
    const roomList = rooms.status === 'fulfilled' ? rooms.value : [];
    const patientStats = patients.status === 'fulfilled' ? patients.value : { total: 0, active: 0 };

    const todayVisits = visitList.filter((visit) => isToday(visit.arrived_at));
    const completed = todayVisits.filter((visit) => visit.status === 'completed').length;
    const open = todayVisits.filter((visit) =>
      ['registered', 'waiting', 'in_vitals', 'in_consult'].includes(visit.status)
    ).length;
    const availableRooms = roomList.filter((room) => room.status === 'available').length;

    statsEl.innerHTML = html`
      ${statCard({ label: 'Total patients', value: patientStats.total ?? 0, hint: `${patientStats.active ?? 0} active`, tone: 'teal', iconName: 'patients' })}
      ${statCard({ label: 'Patients today', value: todayVisits.length, hint: `${open} open`, tone: 'teal', iconName: 'patients' })}
      ${statCard({ label: 'In queue', value: queue.waiting ?? 0, hint: `${queue.called ?? 0} called`, tone: 'warning', iconName: 'queue' })}
      ${statCard({ label: 'Average wait', value: formatDuration(queue.avg_wait_seconds), hint: 'service time', tone: 'info', iconName: 'clock' })}
      ${statCard({ label: 'Appointments', value: apptList.length, hint: 'scheduled today', tone: 'info', iconName: 'appointments' })}
      ${statCard({ label: 'Completed today', value: completed, hint: `${todayVisits.length} total`, tone: 'success', iconName: 'check' })}
      ${statCard({ label: 'Seen today', value: queue.done ?? 0, hint: 'served', tone: 'success', iconName: 'check' })}
      ${statCard({ label: 'Rooms available', value: `${availableRooms}/${roomList.length}`, hint: 'free now', tone: 'teal', iconName: 'room' })}
    `;

    apptsEl.innerHTML = apptList.length
      ? html`<ul class="list">
          ${apptList.slice(0, 6).map(
            (appt) => html`<li class="list__item">
              <span class="list__time">${formatTime(appt.scheduled_start)}</span>
              <span class="list__main">
                <span class="list__title">${appt.patient_first_name} ${appt.patient_last_name}</span>
                <span class="list__sub">${appt.clinician_name}${appt.room_code ? ` · ${appt.room_code}` : ''}</span>
              </span>
              ${statusBadge(appt.status)}
            </li>`
          )}
        </ul>`
      : emptyState('No appointments scheduled for today.');
  }

  async function loadNextUp() {
    queueEntries = await api.get('/api/queue', { area: 'general' });
    const active = queueEntries.filter((entry) => ACTIVE.includes(entry.status)).slice(0, 8);

    nextupEl.innerHTML = active.length
      ? html`<div class="table-wrap">
          <table class="table table--queue table--cards">
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Patient</th>
                <th scope="col">Triage</th>
                <th scope="col">Status</th>
                <th scope="col">Waiting</th>
              </tr>
            </thead>
            <tbody>
              ${active.map(
                (entry) => html`<tr class="row--${entry.status}">
                  <td data-label="Ticket"><span class="ticket-no">#${entry.ticket_no}</span></td>
                  <td data-label="Patient">
                    <strong>${entry.first_name} ${entry.last_name}</strong>
                    <span class="muted block">${entry.mrn}</span>
                  </td>
                  <td data-label="Triage">${triageBadge(entry.triage_level)}</td>
                  <td data-label="Status">${statusBadge(entry.status)}</td>
                  <td data-label="Waiting">
                    <span data-nextup-wait="${entry.id}" data-since="${entry.created_at}">
                      ${formatDuration(entry.wait_seconds)}
                    </span>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>`
      : emptyState('Queue is empty.', 'Waiting patients will appear here.');
  }

  function tick() {
    nextupEl.querySelectorAll('[data-since]').forEach((node) => {
      node.textContent = formatDuration(elapsedSeconds(node.dataset.since));
    });
  }

  try {
    await Promise.all([loadStats(), loadNextUp()]);
    ticker = window.setInterval(tick, 1000);
  } catch (err) {
    statsEl.innerHTML = errorState(err.message);
  }

  return () => {
    if (ticker) window.clearInterval(ticker);
  };
}
