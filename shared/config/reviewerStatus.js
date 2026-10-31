/**
 * Dataverse option values for post-accept terminal reviewer statuses.
 *
 * These values are declared once because runtime readers/writers and the
 * owner-gated provisioning scripts must agree exactly. The provisioning
 * scripts probe the live option set and refuse to insert unless each value is
 * the next free one; they also assert Dataverse returns each requested value.
 * Every key here needs its own explicit branch in
 * lib/services/reviewer-engagement/terminal-transition.js.
 */
import { DID_NOT_SUBMIT_REVIEW_STATUS_VALUE } from './reviewerOutcome.js';

export const TERMINAL_REVIEW_STATUS_VALUES = Object.freeze({
  withdrew: 100000005,
  released: 100000006,
  did_not_submit: DID_NOT_SUBMIT_REVIEW_STATUS_VALUE,
});

export const TERMINAL_REVIEW_STATUS_KEYS = Object.freeze(
  Object.keys(TERMINAL_REVIEW_STATUS_VALUES),
);

export function isTerminalReviewStatus(value) {
  return TERMINAL_REVIEW_STATUS_KEYS.includes(value);
}
