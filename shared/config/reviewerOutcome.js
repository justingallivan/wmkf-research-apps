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
 * Not yet read or written by runtime code: the provisioning has not run, and
 * the readers are wired in later slices. Do not add the status to
 * TERMINAL_REVIEW_STATUS_VALUES until terminal-transition.js has an explicit
 * branch for it (an unhandled terminal falls through to Released).
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
