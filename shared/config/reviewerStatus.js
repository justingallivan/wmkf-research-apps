/**
 * Dataverse option values for post-accept terminal reviewer statuses.
 *
 * These values are declared once because runtime readers/writers and the
 * owner-gated provisioning script must agree exactly. The provisioning script
 * probes the live option set and refuses to insert unless these are the next
 * two free values; it also asserts Dataverse returns each requested value.
 */
export const TERMINAL_REVIEW_STATUS_VALUES = Object.freeze({
  withdrew: 100000005,
  released: 100000006,
});

export const TERMINAL_REVIEW_STATUS_KEYS = Object.freeze(
  Object.keys(TERMINAL_REVIEW_STATUS_VALUES),
);

export function isTerminalReviewStatus(value) {
  return TERMINAL_REVIEW_STATUS_KEYS.includes(value);
}
