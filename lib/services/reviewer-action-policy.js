/**
 * Pure reviewer action-eligibility contract (C0.4 Stage A).
 *
 * This module performs no reads or writes and has no runtime caller yet. It
 * evaluates only server-loaded Wave 13 person-binding and proposal-COI state.
 * Email/address confidence is deliberately outside this contract: a staff
 * acknowledgement of an address may never turn an identity-ineligible result
 * into an eligible one.
 *
 * Unknown, malformed, legacy, or stale state fails closed to a named result.
 * Runtime render/send enforcement remains a separately owner-gated stage.
 */

import {
  IDENTITY_LINEAGE_FIELDS,
  normalizeIdentityTimestamp,
  parseIdentityFieldLineage,
  validateIdentityBindingTuple,
} from './reviewer-identity-binding-contract.js';
import {
  REVIEWER_ACTION_POLICY_PERSON_FIELDS,
  REVIEWER_ACTION_POLICY_SUGGESTION_FIELDS,
} from '../utils/reviewer-action-policy-fields.js';

export {
  REVIEWER_ACTION_POLICY_PERSON_FIELDS,
  REVIEWER_ACTION_POLICY_SUGGESTION_FIELDS,
};

export const REVIEWER_ACTION_POLICY_RESULTS = Object.freeze([
  'eligible',
  'legacy_unclassified',
  'binding_invalid',
  'derived_stale',
  'coi_unknown',
  'coi_conflict',
  'coi_stale',
]);

const COI_STATUSES = new Set(['clear', 'conflict', 'unknown']);
const SHA256_RE = /^[0-9a-f]{64}$/;

function lineageValues(person) {
  return Object.fromEntries(IDENTITY_LINEAGE_FIELDS.map((field) => [field, person?.[field]]));
}

/**
 * Return one closed reviewer-action policy result.
 *
 * `expectedCoiContextHash` must be recomputed from current server-owned request
 * context by a future caller. This helper never accepts client authority or an
 * address-confidence override.
 */
export function evaluateReviewerActionPolicy({
  person,
  suggestion,
  expectedCoiContextHash,
} = {}) {
  const binding = validateIdentityBindingTuple({
    bindingVersion: person?.wmkf_identitybindingversion,
    bindingSource: person?.wmkf_identitybindingsource,
    bindingAnchor: person?.wmkf_identitybindinganchor,
    boundAt: person?.wmkf_identityboundat,
    derivedBindingVersion: person?.wmkf_identityderivedbindingversion,
  });

  if (binding.state === 'unbound') return 'legacy_unclassified';
  if (!binding.ok || binding.state !== 'bound') return 'binding_invalid';

  const bindingVersion = person.wmkf_identitybindingversion;
  const lineage = parseIdentityFieldLineage(person.wmkf_identityfieldlineagejson, {
    values: lineageValues(person),
    currentBindingVersion: bindingVersion,
  });
  if (!lineage.ok) return 'binding_invalid';

  if (person.wmkf_identityderivedbindingversion !== bindingVersion) return 'derived_stale';

  const coiStatus = suggestion?.wmkf_identitycoistatus;
  if (!COI_STATUSES.has(coiStatus)) return 'coi_unknown';

  if (
    !Number.isSafeInteger(suggestion?.wmkf_identitycoibindingversion)
    || suggestion.wmkf_identitycoibindingversion !== bindingVersion
  ) {
    return 'coi_stale';
  }

  const storedContextHash = suggestion?.wmkf_identitycoicontexthash;
  if (
    !SHA256_RE.test(expectedCoiContextHash || '')
    || !SHA256_RE.test(storedContextHash || '')
    || storedContextHash !== expectedCoiContextHash
    || !normalizeIdentityTimestamp(suggestion?.wmkf_identitycoicheckedat)
  ) {
    return 'coi_stale';
  }

  if (coiStatus === 'conflict') return 'coi_conflict';
  if (coiStatus === 'unknown') return 'coi_unknown';
  return 'eligible';
}
