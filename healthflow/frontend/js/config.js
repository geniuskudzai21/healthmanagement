/**
 * Runtime configuration.
 *
 * The API base URL is resolved in this order:
 *   1. localStorage "hf_api_base" (handy for switching environments without a rebuild)
 *   2. window.HEALTHFLOW_API set in index.html
 *   3. a local development default
 *
 * On Vercel, set window.HEALTHFLOW_API in index.html to your Render API URL.
 */
const runtimeOverride =
  typeof localStorage !== 'undefined' ? localStorage.getItem('hf_api_base') : null;

export const API_BASE = String(
  runtimeOverride || (typeof window !== 'undefined' && window.HEALTHFLOW_API) || 'http://localhost:4000'
).replace(/\/+$/, '');

export const APP_NAME = 'HealthFlow';

export const ROLES = ['reception', 'nurse', 'clinician', 'admin'];

export const ROLE_LABELS = {
  reception: 'Reception',
  nurse: 'Nurse',
  clinician: 'Clinician',
  admin: 'Admin',
};
