/**
 * Server-side proof for a reviewer bind on one Request. A person GUID from a
 * client is only an identity to re-read; it is never proof of a pairing.
 */

import { isGuid } from '../../utils/guid.js';
import { adapterError } from '../../dataverse/core/errors.js';
import * as grantRequests from '../../dataverse/adapters/grant-request.js';
import * as potentialReviewers from '../../dataverse/adapters/potential-reviewer.js';
import * as suggestions from '../../dataverse/adapters/reviewer-suggestion.js';
import {
  SYNTHETIC_REVIEWER_MARKER_FIELDS,
  isSyntheticReviewerRow,
  syntheticReviewerIsolationEnabled,
  testRequestIsolationEnabled,
} from './isolation.js';
import { resolveRequestTestState } from './request-test-state.js';

const SLOT_FIELDS = Object.freeze([1, 2, 3, 4, 5].map(
  (slot) => `_wmkf_potentialreviewer${slot}_value`,
));

function denied(code) {
  return adapterError('Reviewer binding is unavailable until the person and Request can be verified.', {
    code,
    status: 409,
  });
}

export function assertReviewerIsolationReady(env = process.env) {
  if (!syntheticReviewerIsolationEnabled(env)) throw denied('reviewer_isolation_not_ready');
}

function sameGuid(left, right) {
  return isGuid(left) && isGuid(right) && left.toLowerCase() === right.toLowerCase();
}

/**
 * Ordinary people retain their normal bind path after a positive marker read.
 * A marked person requires both switches, a valid test Request marker, and a
 * fresh server-side slot or suggestion pairing. Manual add and merge callers
 * pass allowSynthetic=false, so those paths never adopt the cast person.
 * Only applicant-slot ingestion opts into inactive ordinary people so their
 * existing repair card remains reachable. This never permits an inactive cast.
 */
export async function resolveReviewerBindCapability({
  personId,
  requestId,
  allowSynthetic = true,
  allowInactiveOrdinary = false,
  env = process.env,
  personAdapter = potentialReviewers,
  requestAdapter = grantRequests,
  suggestionAdapter = suggestions,
  resolveTestState = resolveRequestTestState,
} = {}) {
  assertReviewerIsolationReady(env);
  if (!isGuid(personId) || !isGuid(requestId)) throw denied('reviewer_binding_id_invalid');

  const person = await personAdapter.getById(personId);
  if (!sameGuid(person?.wmkf_potentialreviewersid, personId)
    || !Object.hasOwn(person, SYNTHETIC_REVIEWER_MARKER_FIELDS.marker)) {
    throw denied('reviewer_person_unavailable');
  }
  const inactiveOrdinaryAllowed = allowInactiveOrdinary === true
    && (person[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] === false
      || person[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] === null);
  if (person.statecode !== undefined && person.statecode !== 0 && !inactiveOrdinaryAllowed) {
    throw denied('reviewer_person_inactive');
  }
  if (!isSyntheticReviewerRow(person)) {
    if (person[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] !== false
      && person[SYNTHETIC_REVIEWER_MARKER_FIELDS.marker] !== null) {
      throw denied('reviewer_person_marker_unknown');
    }
    return { kind: 'ordinary', person };
  }
  if (!allowSynthetic) throw denied('synthetic_reviewer_not_bindable');
  if (!testRequestIsolationEnabled(env)) throw denied('test_request_isolation_not_ready');

  const state = await resolveTestState(requestId);
  if (state.kind !== 'synthetic' || !isGuid(state.runId)) {
    throw denied('synthetic_reviewer_request_not_verified');
  }
  const request = await requestAdapter.getById(requestId, {
    select: ['akoya_requestid', ...SLOT_FIELDS].join(','),
  });
  if (!sameGuid(request?.akoya_requestid, requestId)) {
    throw denied('synthetic_reviewer_request_unavailable');
  }
  const slotBound = SLOT_FIELDS.some((field) => sameGuid(request?.[field], personId));
  if (!slotBound) {
    const suggestion = await suggestionAdapter.findByPotentialReviewerAndRequest(personId, requestId);
    if (!sameGuid(suggestion?._wmkf_potentialreviewer_value, personId)
      || !sameGuid(suggestion?._wmkf_request_value, requestId)) {
      throw denied('synthetic_reviewer_pair_unverified');
    }
  }
  return { kind: 'synthetic', person, requestState: state, binding: slotBound ? 'slot' : 'suggestion' };
}
