/**
 * @jest-environment node
 */

import {
  REVIEWER_ACTION_POLICY_RESULTS,
  evaluateReviewerActionPolicy,
} from '../../lib/services/reviewer-action-policy.js';

const ORCID = '0000-0002-1825-0097';
const CURRENT_HASH = 'a'.repeat(64);

function currentPerson(overrides = {}) {
  const fields = {
    wmkf_orcid: { source: 'self_reported', bindingVersion: 2 },
    wmkf_orcidurl: { source: 'self_reported', bindingVersion: 2 },
  };
  return {
    wmkf_identitybindingversion: 2,
    wmkf_identitybindingsource: 'self_reported',
    wmkf_identitybindinganchor: `orcid:${ORCID}`,
    wmkf_identityboundat: '2026-07-14T12:00:00.000Z',
    wmkf_identityderivedbindingversion: 2,
    wmkf_identityfieldlineagejson: JSON.stringify({ schemaVersion: 1, fields }),
    wmkf_orcid: ORCID,
    wmkf_orcidurl: `https://orcid.org/${ORCID}`,
    ...overrides,
  };
}

function currentSuggestion(overrides = {}) {
  return {
    wmkf_identitycoistatus: 'clear',
    wmkf_identitycoibindingversion: 2,
    wmkf_identitycoicontexthash: CURRENT_HASH,
    wmkf_identitycoicheckedat: '2026-07-14T12:05:00.000Z',
    ...overrides,
  };
}

function evaluate({ person = currentPerson(), suggestion = currentSuggestion(), expectedCoiContextHash = CURRENT_HASH, ...extra } = {}) {
  return evaluateReviewerActionPolicy({ person, suggestion, expectedCoiContextHash, ...extra });
}

describe('reviewer action policy', () => {
  test('pins the complete closed result set', () => {
    expect(REVIEWER_ACTION_POLICY_RESULTS).toEqual([
      'eligible',
      'legacy_unclassified',
      'binding_invalid',
      'derived_stale',
      'coi_unknown',
      'coi_conflict',
      'coi_stale',
    ]);
  });

  test('returns eligible only for a complete current binding and current clear COI', () => {
    expect(evaluate()).toBe('eligible');
  });

  test.each([
    ['missing person', null],
    ['all-null legacy tuple', {
      wmkf_identitybindingversion: null,
      wmkf_identitybindingsource: null,
      wmkf_identitybindinganchor: null,
      wmkf_identityboundat: null,
      wmkf_identityderivedbindingversion: null,
      wmkf_identityfieldlineagejson: null,
    }],
    ['explicit legacy_unbound tuple', { wmkf_identitybindingsource: 'legacy_unbound' }],
    ['dirty legacy identity values without a binding', { wmkf_orcid: ORCID }],
  ])('classifies %s as legacy_unclassified', (_label, person) => {
    expect(evaluate({ person })).toBe('legacy_unclassified');
  });

  test.each([
    ['unsupported binding source', { wmkf_identitybindingsource: 'model_guess' }],
    ['noncanonical anchor', { wmkf_identitybindinganchor: 'orcid:bad' }],
    ['malformed bound timestamp', { wmkf_identityboundat: 'yesterday' }],
    ['malformed lineage', { wmkf_identityfieldlineagejson: '{' }],
    ['missing lineage for a present field', { wmkf_identityfieldlineagejson: '{"schemaVersion":1,"fields":{}}' }],
  ])('fails closed as binding_invalid for %s', (_label, overrides) => {
    expect(evaluate({ person: currentPerson(overrides) })).toBe('binding_invalid');
  });

  test.each([
    ['missing derived generation', null],
    ['older derived generation', 1],
  ])('fails closed as derived_stale for %s', (_label, derivedVersion) => {
    expect(evaluate({
      person: currentPerson({ wmkf_identityderivedbindingversion: derivedVersion }),
    })).toBe('derived_stale');
  });

  test.each([
    ['missing suggestion', null],
    ['missing status', currentSuggestion({ wmkf_identitycoistatus: null })],
    ['explicit unknown', currentSuggestion({ wmkf_identitycoistatus: 'unknown' })],
    ['unrecognized status', currentSuggestion({ wmkf_identitycoistatus: 'maybe' })],
  ])('fails closed as coi_unknown for %s', (_label, suggestion) => {
    expect(evaluate({ suggestion })).toBe('coi_unknown');
  });

  test('returns coi_conflict only when the conflict record is current', () => {
    expect(evaluate({
      suggestion: currentSuggestion({ wmkf_identitycoistatus: 'conflict' }),
    })).toBe('coi_conflict');
    expect(evaluate({
      suggestion: currentSuggestion({
        wmkf_identitycoistatus: 'conflict',
        wmkf_identitycoibindingversion: 1,
      }),
    })).toBe('coi_stale');
  });

  test.each([
    ['missing COI binding generation', { wmkf_identitycoibindingversion: null }, CURRENT_HASH],
    ['mismatched COI binding generation', { wmkf_identitycoibindingversion: 1 }, CURRENT_HASH],
    ['missing stored context hash', { wmkf_identitycoicontexthash: null }, CURRENT_HASH],
    ['uppercase stored context hash', { wmkf_identitycoicontexthash: CURRENT_HASH.toUpperCase() }, CURRENT_HASH],
    ['mismatched current context hash', {}, 'b'.repeat(64)],
    ['missing expected context hash', {}, null],
    ['malformed checked timestamp', { wmkf_identitycoicheckedat: 'not-a-date' }, CURRENT_HASH],
  ])('fails closed as coi_stale for %s', (_label, overrides, expectedCoiContextHash) => {
    expect(evaluate({
      suggestion: currentSuggestion(overrides),
      expectedCoiContextHash,
    })).toBe('coi_stale');
  });

  test('address-confidence inputs cannot override an identity-ineligible result', () => {
    expect(evaluateReviewerActionPolicy({
      person: currentPerson({ wmkf_identitybindingsource: 'model_guess' }),
      suggestion: currentSuggestion(),
      expectedCoiContextHash: CURRENT_HASH,
      emailConfidence: 'high',
      confirmedLowConfidenceIds: ['suggestion-1'],
    })).toBe('binding_invalid');
  });
});
