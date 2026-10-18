import { api } from '../api.js';
import { getUser } from '../auth.js';
import { ROLES, ROLE_LABELS } from '../config.js';
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
  formatDateTime,
  initials,
  raw,
} from '../ui.js';

function currentUserId() {
  const user = getUser();
  return user ? Number(user.id) : null;
}

function isSelf(id) {
  return Number(id) === currentUserId();
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function accountForm(user = {}) {
  const editing = Boolean(user.id);
  return html`<form id="user-form" novalidate>
    <div class="form-grid">
      <div class="field">
        <label for="full_name">Full name</label>
        <input id="full_name" name="full_name" required maxlength="120" value="${user.full_name || ''}" />
      </div>
      <div class="field">
        <label for="role">Role</label>
        <select id="role" name="role" required>
          ${ROLES.map(
            (role) => html`<option value="${role}" ${role === user.role ? 'selected' : ''}>${roleLabel(role)}</option>`
          )}
        </select>
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required maxlength="160" value="${user.email || ''}" />
      </div>
      <div class="field">
        <label for="phone">Phone <span class="muted">(optional)</span></label>
        <input id="phone" name="phone" maxlength="40" value="${user.phone || ''}" />
      </div>
      <div class="field field--full">
        <label for="password">${editing ? 'New password' : 'Password'}</label>
        <input id="password" name="password" type="password" autocomplete="new-password"
          minlength="8" maxlength="200" ${editing ? '' : 'required'}
          placeholder="${editing ? 'Leave blank to keep the current password' : 'At least 8 characters'}" />
      </div>
    </div>
    <p id="user-error" class="form-error" role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn--primary" id="user-submit">${editing ? 'Save changes' : 'Create account'}</button>
    </div>
  </form>`;
}

async function openAccountDialog({ user = null, onSaved }) {
  const editing = Boolean(user && user.id);
  const dialog = openDialog({
    title: editing ? `Edit ${user.full_name}` : 'New account',
    content: accountForm(user || {}),
    size: 'md',
  });
  const form = dialog.querySelector('#user-form');
  const errorBox = dialog.querySelector('#user-error');
  const submit = dialog.querySelector('#user-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    clearFieldErrors(form);

    const values = formValues(form);
    const payload = {
      role: values.role,
      full_name: values.full_name,
      email: values.email,
    };
    if (values.phone) payload.phone = values.phone;
    if (values.password) payload.password = values.password;

    setBusy(submit, true, 'Saving…');
    try {
      if (editing) {
        await api.patch(`/api/users/${user.id}`, payload);
        toast(`${payload.full_name} updated.`, 'success');
      } else {
        await api.post('/api/users', payload);
        toast(`Account for ${payload.full_name} created.`, 'success');
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

export default async function usersView({ outlet }) {
  setPage('Users', 'Create, edit, deactivate and delete staff accounts.');

  mount(
    outlet,
    html`<div class="toolbar toolbar--wrap">
      <div id="user-stats" class="summary" aria-live="polite"></div>
      <button type="button" class="btn btn--primary" id="add-user">＋ New account</button>
    </div>

    <section class="panel" aria-labelledby="users-heading">
      <h2 id="users-heading" class="panel__title">Staff accounts</h2>
      <div id="user-results">${spinner('Loading accounts…')}</div>
    </section>`
  );

  const statsEl = outlet.querySelector('#user-stats');
  const results = outlet.querySelector('#user-results');
  const addButton = outlet.querySelector('#add-user');

  let accounts = [];

  async function load() {
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = spinner();
    try {
      const users = await api.get('/api/users');
      accounts = users;
      renderStats(users);
      renderList(users);
    } catch (err) {
      statsEl.innerHTML = '';
      results.innerHTML = errorState(err.message, { retry: 'reload' });
    } finally {
      results.removeAttribute('aria-busy');
    }
  }

  function renderStats(users) {
    const active = users.filter((user) => user.is_active).length;
    const byRole = (role) => users.filter((user) => user.role === role).length;
    statsEl.innerHTML = html`
      ${chip('active', active, 'success')}
      ${chip('inactive', users.length - active, 'warning')}
      ${chip('doctors', byRole('clinician'), 'info')}
      ${chip('total accounts', users.length, 'info')}
    `;
  }

  function renderList(users) {
    if (!users.length) {
      results.innerHTML = emptyState('No accounts yet.', 'Use "New account" to add the first one.');
      return;
    }
    results.innerHTML = html`<div class="table-wrap">
      <table class="table table--cards">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Email</th>
            <th scope="col">Phone</th>
            <th scope="col">Status</th>
            <th scope="col">Last login</th>
            <th scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          ${users.map(
            (user) => html`<tr>
              <td data-label="Name">
                <span class="cell-person">
                  <span class="avatar avatar--sm" aria-hidden="true">${initials(user.full_name)}</span>
                  <strong>${user.full_name}</strong>${isSelf(user.id) ? html`<span class="muted"> (you)</span>` : ''}
                </span>
              </td>
              <td data-label="Role">${roleLabel(user.role)}</td>
              <td data-label="Email">${user.email}</td>
              <td data-label="Phone">${user.phone || '—'}</td>
              <td data-label="Status">${statusBadge(user.is_active ? 'active' : 'inactive')}</td>
              <td data-label="Last login">${user.last_login_at ? formatDateTime(user.last_login_at) : '—'}</td>
              <td class="table__actions">
                <button type="button" class="btn btn--ghost btn--sm" data-edit="${user.id}">Edit</button>
                ${isSelf(user.id)
                  ? ''
                  : html`<button type="button" class="btn btn--ghost btn--sm" data-toggle="${user.id}">
                      ${user.is_active ? 'Deactivate' : 'Activate'}
                    </button>`}
                <button type="button" class="btn btn--sm" data-delete="${user.id}"
                  ${isSelf(user.id) ? raw('disabled title="You cannot delete your own account"') : ''}>Delete</button>
              </td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  if (addButton) {
    addButton.addEventListener('click', () => openAccountDialog({ onSaved: load }));
  }

  delegate(results, '[data-action="reload"]', 'click', load);

  delegate(results, '[data-edit]', 'click', async (event, button) => {
    try {
      const user = await api.get(`/api/users/${button.dataset.edit}`);
      openAccountDialog({ user, onSaved: load });
    } catch (err) {
      toast(err.message, 'danger');
    }
  });

  delegate(results, '[data-toggle]', 'click', async (event, button) => {
    const id = Number(button.dataset.toggle);
    const user = accounts.find((item) => Number(item.id) === id);
    if (!user) return;
    const activating = !user.is_active;
    const ok = await confirmDialog({
      title: activating ? 'Activate account' : 'Deactivate account',
      message: activating
        ? `Allow ${user.full_name} to sign in again?`
        : `Disable ${user.full_name}? They will not be able to sign in and the account is hidden from active lists. Records are preserved.`,
      confirmLabel: activating ? 'Activate' : 'Deactivate',
      danger: !activating,
    });
    if (!ok) return;

    setBusy(button, true, '…');
    try {
      await api.patch(`/api/users/${id}`, { is_active: activating });
      toast(activating ? 'Account activated.' : 'Account deactivated.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'danger');
      setBusy(button, false);
    }
  });

  delegate(results, '[data-delete]', 'click', async (event, button) => {
    const id = button.dataset.delete;
    const ok = await confirmDialog({
      title: 'Delete account',
      message: 'Permanently delete this account? Accounts with linked records cannot be deleted — deactivate them instead.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    setBusy(button, true, '…');
    try {
      await api.delete(`/api/users/${id}`);
      toast('Account deleted.', 'success');
      await load();
    } catch (err) {
      setBusy(button, false);
      if (err.status === 409) {
        const deactivate = await confirmDialog({
          title: 'Account has linked records',
          message: `${err.message} Deactivate it instead?`,
          confirmLabel: 'Deactivate',
        });
        if (deactivate) {
          try {
            await api.patch(`/api/users/${id}`, { is_active: false });
            toast('Account deactivated.', 'success');
            await load();
          } catch (patchErr) {
            toast(patchErr.message, 'danger');
          }
        }
      } else {
        toast(err.message, 'danger');
      }
    }
  });

  await load();
}
