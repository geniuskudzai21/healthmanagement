/* Inline SVG icon set. Every icon is drawn with `currentColor` so it inherits
   the surrounding text colour, and is returned as a pre-escaped (safe) value so
   it can be dropped straight into an `html` template without double escaping.

   Icons are hand-written, static path data - there is no user input here, so
   the markup is trusted by construction. */

function safe(value) {
  return {
    __safeHtml: true,
    value: String(value),
    toString() {
      return this.value;
    },
  };
}

/* Each entry is the inner markup of a 24x24 viewBox. */
const PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  patients: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 6.5a3 3 0 0 1 0 6"/><path d="M17.5 20a5.5 5.5 0 0 0-3-4.9"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  checkin: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a2 2 0 0 1 4 0"/><path d="M9 13l2 2 4-4"/>',
  queue: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  appointments: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-6M22 20H2"/>',
  menu: '<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 12h9M16 8l3 4-3 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.3L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 13.7 5.3L21 15"/><path d="M21 20v-5h-5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  room: '<path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M2.5 21h19"/><path d="M10.5 12h.01"/>',
  bill: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h8M8 14h5"/>',
  phone: '<path d="M6 3h3l1.5 4-2 1.5a12 12 0 0 0 5 5L15 11l4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9.5 12 1.8 1.8L15 10"/>',
  ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a2.5 2.5 0 0 0 0-5z"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',
  'heart-pulse': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
};

const CLOSE_TAG = "</svg>";

/**
 * Render an inline SVG icon.
 * @param {string} name key from PATHS
 * @param {{ size?: number, label?: string, class?: string }} [opts]
 *   `label` turns the icon into an accessible image; omit it for decorative use.
 */
export function icon(name, { size = 20, label = '', className = '' } = {}) {
  const body = PATHS[name];
  if (!body) return safe('');
  const cls = className ? ` class="${className}"` : '';
  const a11y = label
    ? ` role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"`
    : ' aria-hidden="true" focusable="false"';
  return safe(
    `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"${a11y}>` +
      body +
      CLOSE_TAG
  );
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

export const ICON_NAMES = Object.keys(PATHS);
