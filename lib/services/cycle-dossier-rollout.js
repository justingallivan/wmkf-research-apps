/**
 * Runtime rollout gates for the D26 Cycle Dossier pilot.
 *
 * These checks are intentionally small and deterministic. The request cohort
 * is server-owned, and worker checks run immediately before every paid or
 * external write boundary so a stale claimed run cannot continue after an
 * operator stop.
 */
import { constantTimeEqual } from '../utils/cron-auth';
import { dossierError, readDossierControl } from './cycle-dossier-store';

export const DOSSIER_ENVIRONMENT_NAMES = ['local', 'preview', 'production'];

export function parseDossierRequestAllowlist(value) {
  const values = String(value || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (values.length > 50 || values.some(v => !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(v))) return [];
  return [...new Set(values)];
}

export function dossierRolloutConfig(env = process.env) {
  const mode = env.CYCLE_DOSSIER_ROLLOUT_MODE || 'pilot';
  return {
    enabled: env.CYCLE_DOSSIER_ENABLED === 'true',
    operatorStop: env.CYCLE_DOSSIER_OPERATOR_STOP === 'true',
    requestAllowlist: parseDossierRequestAllowlist(env.CYCLE_DOSSIER_REQUEST_ALLOWLIST),
    mode,
    operatorProfileId: Number.isInteger(Number(env.CYCLE_DOSSIER_OPERATOR_PROFILE_ID))
      ? Number(env.CYCLE_DOSSIER_OPERATOR_PROFILE_ID) : null,
  };
}

export function assertDossierProfileAllowed(profileId, env = process.env) {
  const mode = env.CYCLE_DOSSIER_ROLLOUT_MODE || 'pilot';
  if (!['pilot', 'smoke'].includes(mode)) throw dossierError('The dossier rollout mode is invalid.', 503);
  if (mode === 'smoke' && Number(profileId) !== Number(env.CYCLE_DOSSIER_OPERATOR_PROFILE_ID)) {
    throw dossierError('This superuser is outside the controlled dossier operator profile.', 403);
  }
}

export function assertDossierPilotEnabled(env = process.env) {
  if (env.CYCLE_DOSSIER_ENABLED !== 'true') {
    throw dossierError('The dossier pilot is awaiting activation.', 503);
  }
}

export function assertDossierRequestAllowed({ requestId, requestNumber }, env = process.env) {
  const allowlist = assertDossierCohortConfigured(env);
  if (!allowlist.length) {
    throw dossierError('The dossier pilot request cohort is not configured.', 503);
  }
  const candidates = [requestId, requestNumber].filter(Boolean).map(value => String(value).trim().toLowerCase());
  if (!candidates.some(value => allowlist.includes(value))) {
    throw dossierError('This request is outside the controlled dossier pilot cohort.', 403);
  }
}

export function assertDossierCohortConfigured(env = process.env) {
  const allowlist = parseDossierRequestAllowlist(env.CYCLE_DOSSIER_REQUEST_ALLOWLIST);
  if (!allowlist.length) throw dossierError('The dossier pilot request cohort is not configured.', 503);
  if ((env.CYCLE_DOSSIER_ROLLOUT_MODE || 'pilot') === 'smoke' && allowlist.length !== 1) {
    throw dossierError('Smoke mode requires exactly one allowlisted request.', 503);
  }
  return allowlist;
}

/** Gate used immediately before paid calls and SharePoint mutations. */
export async function assertDossierWorkerOpen(env = process.env, readControl = readDossierControl) {
  const control = await readControl();
  if (env.CYCLE_DOSSIER_ENABLED !== 'true' || env.CYCLE_DOSSIER_OPERATOR_STOP === 'true' || !control || control.stop_requested) {
    const error = dossierError('Dossier work is paused by the rollout operator.', 503);
    error.interrupted = true;
    throw error;
  }
}

export function verifyDossierCronSecret(req, res, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    console.error('[cycle-dossier] CRON_SECRET not configured');
    res.status(500).json({ error: 'Cron secret not configured' });
    return false;
  }
  if (!constantTimeEqual(req.headers?.authorization, `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function validateDossierEnvironment({ expected, vercelEnv, nodeEnv, dynamicsUrl }) {
  if (!DOSSIER_ENVIRONMENT_NAMES.includes(expected)) return { ok: false, reason: `Unsupported environment: ${expected}` };
  const actual = vercelEnv || (nodeEnv === 'production' ? null : 'local');
  if (actual !== expected) return { ok: false, reason: `VERCEL_ENV is ${actual || 'unset'}; expected ${expected}.` };
  if (dynamicsUrl) {
    let host;
    try { host = new URL(dynamicsUrl).hostname.toLowerCase(); } catch { return { ok: false, reason: 'DYNAMICS_URL is not a valid URL.' }; }
    const expectedHost = expected === 'production' ? 'wmkf.crm.dynamics.com' : expected === 'preview' ? 'orgd9e66399.crm.dynamics.com' : null;
    if (expectedHost && host !== expectedHost) return { ok: false, reason: `DYNAMICS_URL targets ${host}; expected ${expectedHost}.` };
  }
  return { ok: true, environment: actual };
}
