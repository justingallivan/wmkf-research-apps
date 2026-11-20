/** Roster-only backend switch. Defaults to Postgres; unknown values fail closed. */
import { PRODUCTION_HOSTS } from '../../dataverse/core/target-registry.js';
import { ServiceHttpError } from '../service-http-error.js';
function invalid() {
  return new ServiceHttpError('The expertise roster is misconfigured. Contact an administrator.', { httpStatus: 503, code: 'roster_backend_misconfigured' });
}
export function rosterMode(env = process.env) {
  const value = env.EXPERTISE_ROSTER_BACKEND;
  if (value === undefined || value === '' || value === 'postgres') return 'legacy';
  if (value === 'dataverse') return 'dataverse';
  throw invalid();
}
export function usesDataverseRoster(env = process.env) { return rosterMode(env) === 'dataverse'; }
export function rosterTarget(env = process.env) {
  if (!usesDataverseRoster(env)) throw invalid();
  const raw = String(env.DYNAMICS_URL || '').replace(/\/$/, '');
  let url;
  try { url = new URL(raw); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.origin !== raw || !PRODUCTION_HOSTS.includes(url.hostname)) throw invalid();
  return { host: url.hostname };
}
