/**
 * Dataverse option values for invited-reviewer outcomes
 * (docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md).
 *
 * Declared once because runtime readers/writers and the owner-gated
 * provisioning scripts must agree exactly:
 *   - ENDED_BY_VALUES: wmkf_appreviewersuggestion.wmkf_endedby (Wave 35,
 *     scripts/preflight-reviewer-outcomes-schema.mjs);
 *   - DID_NOT_SUBMIT_REVIEW_STATUS_VALUE: a new wmkf_reviewstatus option
 *     (scripts/extend-reviewstatus-picklist-did-not-submit.mjs, which refuses
 *     unless this is the next free value in the live option set).
 *
 * Both are provisioned in Production (2026-10-31), not the sandbox. Did not
 * submit is a terminal status (shared/config/reviewerStatus.js) written only by
 * applyStaffReviewerDidNotSubmit through terminal-transition.js's explicit
 * branch. Runtime code writes Ended by there but does not yet read it.
 */

export const ENDED_BY_VALUES = Object.freeze({
  reviewer_before_accepting: 100000000,
  reviewer_after_accepting: 100000001,
  foundation: 100000002,
});

export const ENDED_BY_KEYS = Object.freeze(Object.keys(ENDED_BY_VALUES));

export const ENDED_BY_BY_VALUE = Object.freeze(Object.fromEntries(
  Object.entries(ENDED_BY_VALUES).map(([key, value]) => [value, key]),
));

export const DID_NOT_SUBMIT_REVIEW_STATUS_VALUE = 100000007;
