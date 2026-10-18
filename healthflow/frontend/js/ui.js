/* Tiny DOM/UI toolkit. Every interpolation through `html` is escaped - use
   raw() only for strings you built yourself with `html`. */

import { icon } from './icons.js';

export { icon };

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

/* A string that is already safe HTML. Carrying this marker (instead of a
   plain string) lets fragments nest without being escaped twice, while still
   coercing to a string for innerHTML and Array.join(). */
function safe(value) {
  return {
    __safeHtml: true,
    value: String(value),
    toString() {
      return this.value;
    },
  };
}

/** Wrap trusted markup so it is inserted verbatim. Use sparingly. */
export function raw(value) {
  return safe(value ?? '');
}

function renderInterpolation(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(renderInterpolation).join('');
  if (typeof value === 'object' && value.__safeHtml === true) return value.value;
  return esc(value);
}

/** Tagged template that HTML-escapes every interpolation by default. */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += renderInterpolation(values[i]) + strings[i + 1];
  }
  return safe(out);
}

/* ------------------------------------------------------------------ DOM ---- */

export function el(markup) {
  const template = document.createElement('template');
  template.innerHTML = String(markup).trim();
  return template.content.firstElementChild;
}

export function mount(container, markup) {
  container.innerHTML = String(markup);
  return container;
}

export function delegate(root, selector, eventName, handler) {
  root.addEventListener(eventName, (event) => {
    const node = event.target;
    if (!node || typeof node.closest !== 'function') return;
    const target = node.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  });
}

export function formValues(scope) {
  const values = {};
  const read = (field) => {
    if (!field.name) return;
    if (field.type === 'checkbox') values[field.name] = field.checked;
    else if (field.type === 'radio') {
      if (field.checked) values[field.name] = field.value;
    } else {
      values[field.name] = typeof field.value === 'string' ? field.value.trim() : field.value;
    }
  };

  if (typeof HTMLFormElement !== 'undefined' && scope instanceof HTMLFormElement) {
    new FormData(scope).forEach((value, key) => {
      const field = scope.elements[key];
      if (field && field.type === 'checkbox') values[key] = field.checked;
      else values[key] = typeof value === 'string' ? value.trim() : value;
    });
    return values;
  }

  scope.querySelectorAll('input[name], select[name], textarea[name]').forEach(read);
  return values;
}

/* ------------------------------------------------------------- feedback ---- */

export function spinner(label = 'Loading…') {
  return html`<div class="state state--loading" role="status">
    <span class="spinner" aria-hidden="true"></span><span>${label}</span>
  </div>`;
}

export function errorState(message, { retry = null } = {}) {
  return html`<div class="state state--error" role="alert">
    <p>${message}</p>
    ${retry ? raw(`<button type="button" class="btn btn--ghost" data-action="${esc(retry)}">Try again</button>`) : ''}
  </div>`;
}

export function emptyState(title, hint = '') {
  return html`<div class="state state--empty" role="status">
    <p class="state__title">${title}</p>
    ${hint ? html`<p class="muted">${hint}</p>` : ''}
  </div>`;
}

/* ---------------------------------------------------------- skeletons ---- */

/** A single shimmering placeholder block. */
export function skeleton(className = 'skeleton--text') {
  return html`<span class="skeleton ${className}" aria-hidden="true"></span>`;
}

/** n stacked skeleton rows, for table/list loading states. */
export function skeletonRows(count = 4) {
  const rows = Array.from({ length: count }, () => html`<div class="skeleton skeleton--row" aria-hidden="true"></div>`);
  return html`<div class="skeleton-stack" role="status" aria-label="Loading">${rows}</div>`;
}

/** Skeleton stat cards to drop into a `.stats` grid. */
export function skeletonStats(count = 4) {
  const cards = Array.from({ length: count }, () => html`<div class="skeleton skeleton--stat" aria-hidden="true"></div>`);
  return html`${cards}`;
}

/** Set the page heading/subtitle rendered by the app shell. Pass '' to hide the head. */
export function setPage(title, subtitle = '') {
  const head = document.getElementById('page-head');
  const heading = document.getElementById('page-title');
  const sub = document.getElementById('page-subtitle');
  if (head) head.hidden = !title;
  if (heading) heading.textContent = title || '';
  if (sub) {
    sub.textContent = subtitle || '';
    sub.hidden = !subtitle;
  }
}

/** Simple CSS bar chart builder. items: [{label, value}] */
export function barChart(items, { ariaLabel = 'Bar chart' } = {}) {
  if (!items || !items.length) return emptyState('No data for this period.');
  const max = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  return html`<div class="chart" role="img" aria-label="${ariaLabel}">
    ${items.map((item) => {
      const value = Number(item.value) || 0;
      const pct = Math.round((value / max) * 100);
      return html`<div class="chart__row">
        <span class="chart__label">${item.label}</span>
        <span class="chart__track"><span class="chart__bar" style="width:${pct}%"></span></span>
        <span class="chart__value">${value}</span>
      </div>`;
    })}
  </div>`;
}

export function announce(message, assertive = false) {  const region = document.getElementById('live-region');
  if (!region) return;
  region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = message;
  }, 30);
}

export function toast(message, variant = 'success') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = el(html`<div class="toast toast--${variant}" role="status">
    <span>${message}</span>
    <button type="button" class="toast__close" aria-label="Dismiss notification">${icon('close', { size: 16 })}</button>
  </div>`);

  let timer = window.setTimeout(dismiss, 6000);
  function dismiss() {
    window.clearTimeout(timer);
    if (!node.isConnected) return;
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 250);
  }

  node.addEventListener('click', dismiss);
  region.appendChild(node);
}

export function setBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function clearFieldErrors(form) {
  form.querySelectorAll('.field__error').forEach((node) => node.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((node) => {
    node.removeAttribute('aria-invalid');
    node.removeAttribute('aria-describedby');
  });
}

export function showFieldErrors(form, fields = {}) {
  clearFieldErrors(form);
  const names = Object.keys(fields);
  names.forEach((name, index) => {
    const input = form.elements[name];
    if (!input) return;
    const error = el(html`<p class="field__error" id="error-${name}" role="alert">${fields[name]}</p>`);
    (input.closest('.field') || input.parentElement).appendChild(error);
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `error-${name}`);
    if (index === 0) input.focus();
  });
  return names.length > 0;
}

/* -------------------------------------------------------------- dialogs ---- */

export function openDialog({ title, content, size = 'md' }) {
  const dialog = el(html`<dialog class="dialog dialog--${size}" aria-labelledby="dialog-title">
    <div class="dialog__inner">
      <header class="dialog__header">
        <h2 id="dialog-title" class="dialog__title">${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close dialog">✕</button>
      </header>
      <div class="dialog__content">${raw(content)}</div>
    </div>
  </dialog>`);

  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) dialog.close();
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dialog = openDialog({
      title,
      size: 'sm',
      content: html`<p>${message}</p>
        <div class="dialog__actions">
          <button type="button" class="btn btn--ghost" data-close>Cancel</button>
          <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm>${confirmLabel}</button>
        </div>`,
    });
    dialog.querySelector('[data-confirm]').addEventListener('click', () => {
      dialog.close();
      resolve(true);
    });
    dialog.addEventListener('close', () => resolve(false), { once: true });
  });
}

/* ------------------------------------------------------------- format ------ */

const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const TIME_ONLY = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const DATE_ONLY = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
}

export function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : TIME_ONLY.format(date);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_ONLY.format(date);
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

export function formatMoney(value, currency = 'USD') {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${currency} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function elapsedSeconds(fromIso) {
  if (!fromIso) return 0;
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}

export function todayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function currentMonthIso() {
  return todayIso().slice(0, 7);
}

/** Value for <input type="datetime-local"> from an ISO string. */
export function toLocalInputValue(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** ISO string from a datetime-local value. */
export function fromLocalInputValue(value) {
  if (!value) return '';
  return new Date(value).toISOString();
}

export function addMinutes(value, minutes) {
  const date = new Date(value);
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

export function statusBadge(status) {
  const label = String(status || '').replace(/_/g, ' ');
  return html`<span class="badge badge--status badge--${String(status || '').replace(/_/g, '-')}">${label}</span>`;
}

export function triageBadge(level) {
  if (!level) return html`<span class="muted">—</span>`;
  return html`<span class="badge badge--triage badge--triage-${level}" title="Triage level ${level}">P${level}</span>`;
}
