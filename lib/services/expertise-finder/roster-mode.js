/**
 * Expertise roster backend selection.
 *
 * Local rehearsal (`EXPERTISE_ROSTER_REHEARSAL=on`) wins and keeps its sandbox/loopback
 * guard. Otherwise `EXPERTISE_ROSTER_BACKEND` decides: unset, empty or `postgres` keeps
 * the legacy Postgres roster; `dataverse` reads profiles from this deployment's own
 * Dataverse target. Any other value is a roster configuration error. Only roster callers
 * read this, so a bad value cannot affect sign-in or other shared paths.
 * Plan: docs/plans/data/expertise-roster/PRODUCTION_CUTOVER_SIMPLIFICATION_2026-11-18.md.
 */
import rehearsal from './roster-rehearsal-target.cjs';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../dataverse/core/target-registry.js';
import { ServiceHttpError } from '../service-http-error.js';

const MISCONFIGURED = 'The expertise roster is misconfigured. Contact an administrator.';

function configError() {
  return new ServiceHttpError(MISCONFIGURED, {
    httpStatus: 503,
    code: 'roster_backend_misconfigured',
    body: { error: MISCONFIGURED, reason: 'roster_backend_misconfigured' },
  });
}

/** @returns {'rehearsal'|'dataverse'|'legacy'} */
export function rosterMode(env = process.env) {
  if (rehearsal.enabled(env)) return 'rehearsal';
  const value = env.EXPERTISE_ROSTER_BACKEND;
  if (value === undefined || value === '' || value === 'postgres') return 'legacy';
  if (value === 'dataverse') return 'dataverse';
  throw configError();
}

export function usesDataverseRoster(env = process.env) {
  return rosterMode(env) !== 'legacy';
}

/** The Dataverse target for roster reads/writes. Never call in legacy mode. */
export function rosterTarget(env = process.env) {
  const mode = rosterMode(env);
  if (mode === 'rehearsal') return rehearsal.assertTarget(env);
  if (mode !== 'dataverse') throw configError();
  const raw = typeof env.DYNAMICS_URL === 'string' ? env.DYNAMICS_URL.replace(/\/$/, '') : '';
  let url;
  try { url = new URL(raw); } catch { throw configError(); }
  if (url.protocol !== 'https:' || url.origin !== raw) throw configError();
  const host = url.hostname;
  if (!PRODUCTION_HOSTS.includes(host) && !SANDBOX_HOSTS.includes(host)) throw configError();
  return { host };
}
