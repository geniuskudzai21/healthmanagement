import { loadSession, getUser, isAuthenticated, logout } from './auth.js';
import { register, setFallback, navigate, startRouter, currentPath } from './router.js';
import {
  html,
  mount,
  delegate,
  toast,
  confirmDialog,
  initials,
  raw,
  icon,
} from './ui.js';
import { ROLE_LABELS } from './config.js';

import loginView from './views/login.js';
import dashboardView from './views/dashboard.js';
import patientsView from './views/patients.js';
import checkinView from './views/checkin.js';
import queueView from './views/queue.js';
import appointmentsView from './views/appointments.js';
import roomsView from './views/rooms.js';
import reportsView from './views/reports.js';
import billingView from './views/billing.js';
import usersView from './views/users.js';
import notFoundView from './views/notFound.js';

const NAV = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/patients', label: 'Patients', icon: 'patients' },
  { path: '/check-in', label: 'Check-in', icon: 'checkin', roles: ['reception', 'nurse', 'admin'] },
  { path: '/queue', label: 'Queue', icon: 'queue' },
  { path: '/rooms', label: 'Rooms', icon: 'room' },
  { path: '/appointments', label: 'Appointments', icon: 'appointments' },
  { path: '/billing', label: 'Billing', icon: 'bill', roles: ['reception', 'clinician', 'admin'] },
  { path: '/reports', label: 'Reports', icon: 'reports', roles: ['admin', 'clinician'] },
  { path: '/users', label: 'Users', icon: 'users', roles: ['admin'] },
];

const SIDEBAR_KEY = 'hf_sidebar_collapsed';

/* Listeners on elements that survive chrome re-renders (sidebar, overlay) are
   attached once, so repeated renderChrome() calls don't stack handlers. */
let persistentWired = false;

function wirePersistentChrome() {
  if (persistentWired) return;
  persistentWired = true;

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) delegate(sidebar, 'a.nav__link', 'click', () => closeDrawer());
  if (overlay) overlay.addEventListener('click', () => closeDrawer({ restoreFocus: true }));
}

function isCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function setCollapsed(value) {
  try {
    localStorage.setItem(SIDEBAR_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function visibleNav() {
  const user = getUser();
  if (!user) return [];
  return NAV.filter((item) => !item.roles || item.roles.includes(user.role));
}

/* ------------------------------------------------------------- chrome ---- */

function renderSidebar(sidebar, user, active) {
  mount(
    sidebar,
    html`<div class="sidebar__brand">
        <a class="brand" href="#/dashboard" aria-label="HealthFlow home">
          <span class="brand__mark" aria-hidden="true">✚</span>
          <span class="brand__name">HealthFlow</span>
        </a>
      </div>

      <nav class="sidebar__nav" id="primary-nav" aria-label="Primary">
        <span class="sidebar__section">Menu</span>
        ${visibleNav().map(
          (item) => html`<a class="nav__link${item.path === active ? ' is-active' : ''}"
            href="#${item.path}"
            title="${item.label}"
            ${item.path === active ? raw('aria-current="page"') : ''}>
            <span class="nav__icon">${icon(item.icon, { label: item.label })}</span>
            <span class="nav__label">${item.label}</span>
          </a>`
        )}
      </nav>

      <div class="sidebar__foot">
        <div class="sidebar__user" title="${user.full_name}">
          <span class="avatar" aria-hidden="true">${initials(user.full_name)}</span>
          <span class="sidebar__user-meta">
            <span class="sidebar__user-name">${user.full_name}</span>
            <span class="sidebar__user-role">${ROLE_LABELS[user.role] || user.role}</span>
          </span>
        </div>
      </div>`
  );
}

function renderTopbar(header, active) {
  const current = NAV.find((item) => item.path === active);
  mount(
    header,
    html`<button type="button" class="icon-btn topbar__burger" id="drawer-toggle"
        aria-label="Open navigation" aria-expanded="false" aria-controls="primary-nav">
        ${icon('menu')}
      </button>

      <button type="button" class="icon-btn topbar__collapse" id="sidebar-collapse"
        aria-label="Collapse sidebar" aria-expanded="true">
        ${icon('panel')}
      </button>

      <span class="topbar__title">${current ? current.label : 'HealthFlow'}</span>

      <div class="topbar__spacer"></div>

      <div class="topbar__actions">
        <button type="button" class="btn btn--ghost btn--sm" id="logout-btn">
          ${icon('logout', { size: 18 })}
          <span class="topbar__logout-label">Log out</span>
        </button>
      </div>`
  );
}

function closeDrawer({ restoreFocus = false } = {}) {
  const shell = document.getElementById('app-shell');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('drawer-toggle');
  if (!shell) return;
  shell.classList.remove('is-drawer-open');
  if (overlay) overlay.hidden = true;
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
}

function openDrawer() {
  const shell = document.getElementById('app-shell');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('drawer-toggle');
  if (!shell) return;
  shell.classList.add('is-drawer-open');
  if (overlay) overlay.hidden = false;
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  const firstLink = document.querySelector('.sidebar .nav__link');
  if (firstLink) firstLink.focus();
}

function renderChrome() {
  const shell = document.getElementById('app-shell');
  const sidebar = document.getElementById('sidebar');
  const header = document.getElementById('app-header');
  const user = getUser();
  const active = currentPath();

  if (!user) {
    mount(sidebar, '');
    mount(header, '');
    shell.classList.remove('is-collapsed', 'is-drawer-open');
    shell.classList.add('no-chrome');
    closeDrawer();
    return;
  }

  shell.classList.remove('no-chrome');
  shell.classList.toggle('is-collapsed', isCollapsed());
  renderSidebar(sidebar, user, active);
  renderTopbar(header, active);
  wirePersistentChrome();

  const collapseBtn = document.getElementById('sidebar-collapse');
  if (collapseBtn) {
    collapseBtn.setAttribute('aria-expanded', String(!isCollapsed()));
    collapseBtn.addEventListener('click', () => {
      const next = !shell.classList.contains('is-collapsed');
      shell.classList.toggle('is-collapsed', next);
      setCollapsed(next);
      collapseBtn.setAttribute('aria-expanded', String(!next));
    });
  }

  const burger = document.getElementById('drawer-toggle');
  if (burger) {
    burger.addEventListener('click', () => {
      if (shell.classList.contains('is-drawer-open')) closeDrawer({ restoreFocus: true });
      else openDrawer();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Log out',
        message: 'End your session on this device?',
        confirmLabel: 'Log out',
      });
      if (!ok) return;
      await logout();
      toast('Signed out.', 'info');
      navigate('/login', { replace: true });
    });
  }
}

function registerRoutes() {
  register('/login', loginView, { requiresAuth: false });
  register('/dashboard', dashboardView);
  register('/patients', patientsView);
  register('/check-in', checkinView, { roles: ['reception', 'nurse', 'admin'] });
  register('/queue', queueView);
  register('/rooms', roomsView);
  register('/appointments', appointmentsView);
  register('/billing', billingView, { roles: ['reception', 'clinician', 'admin'] });
  register('/reports', reportsView, { roles: ['admin', 'clinician'] });
  register('/users', usersView, { roles: ['admin'] });
  setFallback(notFoundView);
}

function wireGlobalListeners() {
  window.addEventListener('session-changed', renderChrome);
  window.addEventListener('hashchange', () => {
    closeDrawer();
    renderChrome();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer({ restoreFocus: true });
  });
  if (window.matchMedia) {
    window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => {
      if (event.matches) closeDrawer();
    });
  }
}

async function boot() {
  await loadSession();
  registerRoutes();
  wireGlobalListeners();

  if (!isAuthenticated()) {
    navigate('/login', { replace: true });
    renderChrome();
  } else if (!window.location.hash || currentPath() === '/login') {
    navigate('/dashboard', { replace: true });
    renderChrome();
  } else {
    renderChrome();
  }

  await startRouter();
}

boot();

export { renderChrome };
