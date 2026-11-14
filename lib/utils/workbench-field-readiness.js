import { classifyDeployment, classifyTarget } from '../dataverse/core/interlock.js';
import { initialAssessmentRationaleEnabled } from './initial-assessment-rationale-readiness.js';
import { meetingRosterSchemaEnabled } from './meeting-roster-readiness.js';

/**
 * Whether this deployment and Dataverse target have the request page's new
 * fields (schema waves 37 to 40). Synchronous: it decides which columns reads
 * select and whether the request page may consider the phase layout at all.
 * Whether a given request is admitted is a separate, per-request decision
 * (`lib/services/workbench/phase-admission.js`).
 *
 * Two ways in:
 * - the existing isolated sandbox rule of each field helper (non-production
 *   deployment, sandbox target, and that field's own setting where it has one);
 * - a Production deployment on the registered Production target with
 *   `WORKBENCH_PRODUCTION_SCHEMA_READY` set to the literal `on` (the five
 *   fields were applied and read back in Production on 2026-11-13).
 * Any other deployment and target pairing has neither.
 *
 * The existing helpers are left unchanged on purpose: the Recommendation to
 * Chairs step and the automatic integrity screen build on the rationale helper
 * and stay out of Production (owner, 2026-11-13).
 */
export function productionWorkbenchFieldsReady() {
  return classifyDeployment() === 'production'
    && classifyTarget(process.env.DYNAMICS_URL) === 'production'
    && process.env.WORKBENCH_PRODUCTION_SCHEMA_READY === 'on';
}

/**
 * Isolated sandbox rule for the staff review summary and visit assessment
 * (and, before this release, the request page's phase layout). Re-exported by
 * `staff-review-summary-service.js` under the same name.
 */
export function staffReviewSummaryEnabled() {
  return classifyDeployment() !== 'production' && classifyTarget(process.env.DYNAMICS_URL) === 'sandbox';
}

/** Staff rationale (`wmkf_initialassessmentrationale`). */
export function rationaleFieldReady() {
  return initialAssessmentRationaleEnabled() || productionWorkbenchFieldsReady();
}

/** Confirmed attendance (`wmkf_confirmedmeetingroster`). */
export function rosterFieldReady() {
  return meetingRosterSchemaEnabled() || productionWorkbenchFieldsReady();
}

/**
 * Staff review summary, its evidence hash and the staff visit assessment.
 * Also the precondition for the request page's phase layout, as before.
 */
export function reviewSummaryFieldsReady() {
  return staffReviewSummaryEnabled() || productionWorkbenchFieldsReady();
}

/**
 * Zoom attendance suggestions on the confirmed-attendance panel. Off in a
 * Production deployment: manual attendance is the release path, and switching
 * suggestions on there is a separate decision (rollout plan).
 */
export function zoomAttendanceSuggestionsEnabled() {
  return classifyDeployment() !== 'production';
}
