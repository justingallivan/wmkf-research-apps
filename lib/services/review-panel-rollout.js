/**
 * Runtime rollout gates for the Virtual Review Panel Phase A foundation.
 * Clone of cycle-dossier-rollout.js's shape (docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md §3, §5 A.2).
 *
 * `REVIEW_PANEL_ENABLED`, `REVIEW_PANEL_ROLLOUT_MODE` (`smoke`|`pilot`), and
 * `REVIEW_PANEL_REQUEST_ALLOWLIST` are readable config, not secrets. An
 * unrecognised rollout mode fails closed (503), matching the dossier's
 * assertDossierProfileAllowed.
 */
import { reviewPanelError, readReviewPanelControl } from './review-panel-store';

export function parseReviewPanelRequestAllowlist(value) {
  const values = String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (values.length > 50 || values.some((v) => !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(v))) return [];
  return [...new Set(values)];
}

export function reviewPanelRolloutConfig(env = process.env) {
  return {
    enabled: env.REVIEW_PANEL_ENABLED === 'true',
    mode: env.REVIEW_PANEL_ROLLOUT_MODE || 'pilot',
    requestAllowlist: parseReviewPanelRequestAllowlist(env.REVIEW_PANEL_REQUEST_ALLOWLIST),
  };
}

/** Fails closed on any mode other than the two recognised values. */
export function assertReviewPanelModeValid(env = process.env) {
  const mode = env.REVIEW_PANEL_ROLLOUT_MODE || 'pilot';
  if (!['pilot', 'smoke'].includes(mode)) throw reviewPanelError('The review panel rollout mode is invalid.', 503);
  return mode;
}

export function assertReviewPanelPilotEnabled(env = process.env) {
  if (env.REVIEW_PANEL_ENABLED !== 'true') {
    throw reviewPanelError('The review panel is awaiting activation.', 503);
  }
}

export function assertReviewPanelCohortConfigured(env = process.env) {
  const mode = assertReviewPanelModeValid(env);
  const allowlist = parseReviewPanelRequestAllowlist(env.REVIEW_PANEL_REQUEST_ALLOWLIST);
  if (!allowlist.length) throw reviewPanelError('The review panel request cohort is not configured.', 503);
  if (mode === 'smoke' && allowlist.length > 4) {
    throw reviewPanelError('Smoke mode allows at most four allowlisted requests.', 503);
  }
  return allowlist;
}

/** Smoke mode is enforced through the shared allowlist: only allowlisted requests may run in either mode, and smoke additionally caps the cohort size (see assertReviewPanelCohortConfigured). */
export function assertReviewPanelRequestAllowed({ requestId, requestNumber }, env = process.env) {
  const allowlist = assertReviewPanelCohortConfigured(env);
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
