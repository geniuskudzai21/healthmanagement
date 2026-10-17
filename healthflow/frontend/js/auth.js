import { api } from './api.js';

let currentUser = null;

export function getUser() {
  return currentUser;
}

export function isAuthenticated() {
  return currentUser !== null;
}

export function hasRole(...roles) {
  return currentUser !== null && roles.includes(currentUser.role);
}

/** Restore the session from the httpOnly cookie on page load. */
export async function loadSession() {
  try {
    currentUser = await api.get('/api/auth/me');
  } catch (err) {
    currentUser = null;
  }
  return currentUser;
}

export async function login(email, password) {
  const { user } = await api.post('/api/auth/login', { email, password });
  currentUser = user;
  notifySessionChanged();
  return user;
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } finally {
    currentUser = null;
    notifySessionChanged();
  }
}

function notifySessionChanged() {
  window.dispatchEvent(new CustomEvent('session-changed'));
}
