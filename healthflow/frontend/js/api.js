import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || null;
  }

  /** True when the session is missing or expired. */
  get isAuthError() {
    return this.status === 401;
  }
}

function buildUrl(path, query) {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, value);
  });
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request(method, path, { body, query } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }

  let data = null;
  if (response.status !== 204) {
    data = await response.json().catch(() => null);
  }

  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `Request failed (${response.status}).`;
    throw new ApiError(response.status, message, data && data.error ? data.error.details : null);
  }
  return data;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  delete: (path) => request('DELETE', path),
};

export { buildUrl };
