import { isAuthenticated, hasRole } from './auth.js';
import { errorState, announce } from './ui.js';

const routes = new Map();
let fallbackView = null;
let cleanup = null;

export function register(path, view, { roles = null, requiresAuth = true } = {}) {
  routes.set(path, { view, roles, requiresAuth });
}

export function setFallback(view) {
  fallbackView = view;
}

export function currentPath() {
  const path = window.location.hash.replace(/^#/, '');
  return path || '/';
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (window.location.hash === target) {
    render();
    return;
  }
  if (replace) {
    window.location.replace(`${window.location.pathname}${window.location.search}${target}`);
  } else {
    window.location.hash = target;
  }
}

const FORBIDDEN_TITLE = 'Access denied';

function renderForbidden(outlet) {
  outlet.innerHTML = errorState('Your role does not have access to this page.');
  const heading = document.getElementById('page-title');
  if (heading) heading.textContent = FORBIDDEN_TITLE;
  announce('Access denied.');
}

async function renderError(outlet) {
  outlet.innerHTML = errorState('Something went wrong while loading this page.');
  const heading = document.getElementById('page-title');
  if (heading) heading.textContent = 'Error';
}

export async function render() {
  const outlet = document.getElementById('outlet');
  if (!outlet) return;

  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (err) {
      console.error('view cleanup failed', err);
    }
    cleanup = null;
  }

  const path = currentPath();
  const route = routes.get(path);

  if (!route) {
    if (fallbackView) {
      cleanup = await fallbackView({ outlet, path }) || null;
      return;
    }
    outlet.innerHTML = errorState(`Page not found: ${path}`);
    return;
  }

  if (route.requiresAuth && !isAuthenticated()) {
    navigate('/login', { replace: true });
    return;
  }

  if (route.requiresAuth && route.roles && !hasRole(...route.roles)) {
    renderForbidden(outlet);
    return;
  }

  try {
    cleanup = (await route.view({ outlet, path })) || null;
  } catch (err) {
    console.error('view render failed', err);
    if (err && err.isAuthError) {
      navigate('/login', { replace: true });
      return;
    }
    await renderError(outlet);
  }

  // Move focus to the page heading for keyboard/screen-reader users.
  const heading = document.getElementById('page-title');
  if (heading && !heading.closest('[hidden]')) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  return render();
}
