import { html, mount, setPage } from '../ui.js';

export default function notFoundView({ outlet, path }) {
  setPage('Page not found', 'The link you followed does not exist.');
  mount(
    outlet,
    html`<div class="state state--empty">
      <p>No page matches <code>${path}</code>.</p>
      <a class="btn btn--primary" href="#/dashboard">Back to dashboard</a>
    </div>`
  );
  return null;
}
