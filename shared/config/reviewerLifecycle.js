/**
 * Canonical Dataverse option values for the reviewer engagement lifecycle.
 *
 * Kept outside the adapter so pure lifecycle state machines and browser-safe
 * readers do not have to import the Dataverse service graph. The adapter
 * re-exports these names for backwards compatibility with existing callers.
 */

import { TERMINAL_REVIEW_STATUS_VALUES } from './reviewerStatus.js';

export const RESPONSE_TYPE_MAP = {
  accepted: 100000000,
  declined: 100000001,
  no_response: 100000002,
  withdrawn_sufficient: 100000003,
  held: 100000004,
};

export const REVIEW_STATUS_MAP = {
  accepted: 100000000,
  materials_sent: 100000001,
  under_review: 100000002,
  review_received: 100000003,
  complete: 100000004,
  withdrew: TERMINAL_REVIEW_STATUS_VALUES.withdrew,
  released: TERMINAL_REVIEW_STATUS_VALUES.released,
};

export const APPLICANT_DISPOSITION_MAP = {
  recommended: 100000000,
  excluded: 100000001,
};

export const APPLICANT_DISPOSITION_EXCLUDED = APPLICANT_DISPOSITION_MAP.excluded;

// Lead-PD closeout disposition on one reviewer engagement. This is deliberately
// separate from akoya_request.wmkf_authorizationtoremitpaymentflag, which remains
// an Operations/Finance decision outside the reviewer application.
export const HONORARIUM_ELIGIBILITY_MAP = Object.freeze({
  eligible: 100000000,
  not_eligible: 100000001,
  not_applicable: 100000002,
});

export const HONORARIUM_ELIGIBILITY_KEYS = Object.freeze(
  Object.keys(HONORARIUM_ELIGIBILITY_MAP),
);

export function isHonorariumEligibility(value) {
  return HONORARIUM_ELIGIBILITY_KEYS.includes(value);
}
