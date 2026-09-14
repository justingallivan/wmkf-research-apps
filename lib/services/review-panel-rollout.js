/**
 * Runtime rollout gates for the Virtual Review Panel Phase A foundation.
 * Clone of cycle-dossier-rollout.js's shape (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §3, §5 A.2).
 *
 * `REVIEW_PANEL_ENABLED`, `REVIEW_PANEL_ROLLOUT_MODE` (`smoke`|`pilot`|`access`),
 * and `REVIEW_PANEL_REQUEST_ALLOWLIST` are readable config, not secrets. An
 * unrecognised rollout mode fails closed (503), matching the dossier's
 * assertDossierProfileAllowed.
 *
 * `access` mode (owner decision T2, docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md):
 * the admin-panel `review-panel` app grant is the cohort control, so the env
 * allowlist is ignored and every request in the server-scoped roster is
 * launchable. `smoke` and `pilot` keep the allowlist semantics unchanged.
 */

export const REVIEW_PANEL_ROLLOUT_MODES = ['pilot', 'smoke', 'access'];
import { reviewPanelError, readReviewPanelControl } from './review-panel-store';
import { constantTimeEqual } from '../utils/cron-auth';
import { buildVisibilityFilter } from '../../shared/config/workbenchVisibility.js';
import { buildProgramScopeFilter } from './workbench/program-scope-service';

/**
 * The panel's roster predicate — the server-scoped Workbench Research roster
 * (A.2: same server-scoped selection model as the dossier), but with NO cycle
 * restriction (D5: the panel is not cycle-scoped, unlike the dossier's D26
 * filter). Program scope is resolved server-side; the page renders no
 * selector.
 */
export function buildReviewPanelRosterFilter(programId) {
  return `${buildProgramScopeFilter(programId)} and ${buildVisibilityFilter(false)}`;
}

export function parseReviewPanelRequestAllowlist(value) {
  const values = String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (values.length > 50 || values.some((v) => !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(v))) return [];
  return [...new Set(values)];
}

/** Fails closed on any mode other than the two recognised values. */
export function assertReviewPanelModeValid(env = process.env) {
  const mode = env.REVIEW_PANEL_ROLLOUT_MODE || 'pilot';
  if (!REVIEW_PANEL_ROLLOUT_MODES.includes(mode)) throw reviewPanelError('The review panel rollout mode is invalid.', 503);
  return mode;
}

/** Routed through assertReviewPanelModeValid so an unrecognised mode fails closed here too, instead of being handed back verbatim for a caller to trust. */
export function reviewPanelRolloutConfig(env = process.env) {
  return {
    enabled: env.REVIEW_PANEL_ENABLED === 'true',
    mode: assertReviewPanelModeValid(env),
    requestAllowlist: parseReviewPanelRequestAllowlist(env.REVIEW_PANEL_REQUEST_ALLOWLIST),
  };
}

export function assertReviewPanelPilotEnabled(env = process.env) {
  if (env.REVIEW_PANEL_ENABLED !== 'true') {
    throw reviewPanelError('The review panel is awaiting activation.', 503);
  }
}

/** In `access` mode there is no env cohort (returns null); the app grant is the control. */
export function assertReviewPanelCohortConfigured(env = process.env) {
  const mode = assertReviewPanelModeValid(env);
  if (mode === 'access') return null;
  const allowlist = parseReviewPanelRequestAllowlist(env.REVIEW_PANEL_REQUEST_ALLOWLIST);
  if (!allowlist.length) throw reviewPanelError('The review panel request cohort is not configured.', 503);
  if (mode === 'smoke' && allowlist.length > 4) {
    throw reviewPanelError('Smoke mode allows at most four allowlisted requests.', 503);
  }
  return allowlist;
}

/** Smoke and pilot are enforced through the shared allowlist: only allowlisted requests may run, and smoke additionally caps the cohort size (see assertReviewPanelCohortConfigured). `access` mode admits every roster request. */
export function assertReviewPanelRequestAllowed({ requestId, requestNumber }, env = process.env) {
  const allowlist = assertReviewPanelCohortConfigured(env);
  if (allowlist === null) return;
  const candidates = [requestId, requestNumber].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  if (!candidates.some((value) => allowlist.includes(value))) {
    throw reviewPanelError('This request is outside the controlled review panel cohort.', 403);
  }
}

/** Gate used immediately before paid calls. Honours the durable operator stop in review_panel_control in addition to the env-level enable flag. */
export async function assertReviewPanelWorkerOpen(env = process.env, readControl = readReviewPanelControl) {
  assertReviewPanelPilotEnabled(env);
  const control = await readControl();
  if (!control || control.stop_requested) {
    const error = reviewPanelError('Review panel work is paused by the rollout operator.', 503);
    error.interrupted = true;
    throw error;
  }
}

/** Strict platform CRON_SECRET bearer check — no development bypass, mirrors cycle-dossier-rollout.js's verifyDossierCronSecret exactly. */
export function verifyReviewPanelCronSecret(req, res, env = process.env) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    console.error('[review-panel] CRON_SECRET not configured');
    res.status(500).json({ error: 'Cron secret not configured' });
    return false;
  }
  if (!constantTimeEqual(req.headers?.authorization, `Bearer ${secret}`)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}
