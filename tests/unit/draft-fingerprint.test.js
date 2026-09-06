/**
 * Unit tests for lib/services/review-manager/draft-fingerprint.js (Reviewer
 * Lifecycle Stage 6D).
 *
 * Golden hashes below were computed once by hand (a throwaway script that
 * imported the production module directly) and are pasted here as literals —
 * NOT recomputed by importing draft-fingerprint.js at test time — so a
 * canonicalization regression (a normalization rule silently changing) fails
 * this suite instead of passing vacuously against itself.
 */

const { buildDraftFingerprintInputs, fingerprintDraft } = require('../../lib/services/review-manager/draft-fingerprint');
const { computeFixtureFingerprint } = require('../helpers/draft-fingerprint');

function baseArgs() {
  return {
    templateType: 'materials',
    suggestionId: '22222222-2222-4222-8222-222222222222',
    suggestion: { wmkf_reviewduedateoverride: null },
    person: { wmkf_name: 'Dr. Jane Roe', wmkf_primaryaffiliation: 'Uni A' },
    request: {
      akoya_title: 'Proposal T',
      wmkf_abstract: 'Abstract text',
      _wmkf_projectleader_value_formatted: 'Dr. Sam PI',
      wmkf_organizationname: 'Org A',
      wmkf_reviewduedate: '2099-01-01',
      wmkf_meetingdate: '2099-06-01',
    },
    coPINames: ['Dr. Alex Co', 'Dr. Bea Co'],
    cycle: { program_name: 'Program', review_deadline: '2099-02-01', custom_fields: { foo: 'bar' } },
    honorariumAmount: 250,
  };
}

// Golden hash for baseArgs() above — the canonical fixture every other case
// in this file is diffed against.
const BASE_HASH = 'e11cba6940f5fc3345d936ad4662029ab3b39c57beac9b5230837e714a26face';

describe('fingerprintDraft golden hashes', () => {
  test('base fixture hashes to the pinned golden value', () => {
    expect(fingerprintDraft(buildDraftFingerprintInputs(baseArgs()))).toBe(BASE_HASH);
  });

  test('determinism: same inputs (fresh objects) hash identically', () => {
    const a = fingerprintDraft(buildDraftFingerprintInputs(baseArgs()));
    const b = fingerprintDraft(buildDraftFingerprintInputs(baseArgs()));
    expect(a).toBe(b);
    expect(a).toBe(BASE_HASH);
  });

  test('string-trim normalisation: leading/trailing whitespace on candidate name does not change the hash', () => {
    const args = baseArgs();
    args.person.wmkf_name = '  Dr. Jane Roe  ';
    expect(fingerprintDraft(buildDraftFingerprintInputs(args))).toBe(BASE_HASH);
  });

  test('suggestionId is lower-cased before hashing: casing does not change the hash', () => {
    const args = baseArgs();
    args.suggestionId = args.suggestionId.toUpperCase();
    expect(fingerprintDraft(buildDraftFingerprintInputs(args))).toBe(BASE_HASH);
  });

  test('null-normalisation: candidate.affiliation with no primary/org affiliation hashes differently (not equal to a missing-key omission)', () => {
    const args = baseArgs();
    args.person.wmkf_primaryaffiliation = null;
    args.person.wmkf_organizationname = null;
    const hash = fingerprintDraft(buildDraftFingerprintInputs(args));
    expect(hash).toBe('3bc3e8d3af313165f023e93e11d76a2519b48749bd3a22a59aaccb506633a106');
    expect(hash).not.toBe(BASE_HASH);
  });

  // Table-driven: each fingerprinted input, changed alone, must flip the hash.
  // This is the coverage the plan asks for ("a table-driven case per input
  // field proving each flips the hash") plus the co-PI *order* sensitivity
  // case (order is part of the body — the plan documents this explicitly).
  test.each([
    ['templateType', (a) => { a.templateType = 'invitation'; }, '265c2616ad4c21597bbc51f325451c753353eef822c2cf032e94ae752cf77ab1'],
    ['suggestionId (a different GUID)', (a) => { a.suggestionId = '33333333-3333-4333-8333-333333333333'; }, 'b454ccfd09b01964f0d1654447ecc17128d7bde3510b0467fd12568b32a5b654'],
    ['candidate.name', (a) => { a.person.wmkf_name = 'Dr. Other Name'; }, '9bf6544f5e3cdba822a1c5ded5592244f827d32140c687b20e86e65e564d1838'],
    ['candidate.affiliation', (a) => { a.person.wmkf_primaryaffiliation = 'Uni B'; }, '5a193e49a6b8874d5514e662df434e75202b74a4cca171183cddfd2a66261498'],
    ['proposal.title', (a) => { a.request.akoya_title = 'Different title'; }, '49e0ea176bccee0a61cc43376a54e3d14154bb978b03ca5c061929828b87369c'],
    ['proposal.abstract', (a) => { a.request.wmkf_abstract = 'Different abstract'; }, '9226edfae124b34c8a81f72919b16cb1b224c6158d571f0057cdcd19b0ffce0c'],
    ['proposal.authors', (a) => { a.request._wmkf_projectleader_value_formatted = 'Dr. Other PI'; }, 'a37d5134462211770cf88ce3f149c5aee2521cc93fbc31d63343c9d1ec9efde5'],
    ['proposal.institution', (a) => { a.request.wmkf_organizationname = 'Org B'; }, '0dd4b7115f405a69e01e0fe3d69da9fe5cc720eb891f25634655fbd687be1337'],
    ['proposal.coInvestigators (membership)', (a) => { a.coPINames = ['Dr. Alex Co']; }, '40ef06db702fc0a85f165a8eac1ccb85f916efac527d5b5f10d7f7c2762e6236'],
    ['proposal.coInvestigators (order only, same membership)', (a) => { a.coPINames = ['Dr. Bea Co', 'Dr. Alex Co']; }, 'aa5fee701a734466660ddb005b61d872927d1d9ca26d4a80f468cb7acebbaad1'],
    ['engagement.reviewDueDateOverride', (a) => { a.suggestion = { wmkf_reviewduedateoverride: '2099-03-01' }; }, '00b7072b317770b4bf441aa175a18ec2894d3e641d38e580bfa4d07d3daf5eeb'],
    ['request.reviewDueDate', (a) => { a.request.wmkf_reviewduedate = '2099-04-01'; }, '656efb94c140e7b270d14795a2e8afe3d3eab1ab8ae5ea19c91e21845f74fbf5'],
    ['request.meetingDate', (a) => { a.request.wmkf_meetingdate = '2099-07-01'; }, 'fe66186139c51ddba538c9c4f0831fbd6799fc4ab9b2b6ce86c4155d7e232c4f'],
    ['cycle.programName', (a) => { a.cycle.program_name = 'Different Program'; }, '794e06ab683228f9091f1e0af172ae7fe1ab0336bbe0c7c03f729b3862e87c3b'],
    ['cycle.reviewDeadline', (a) => { a.cycle.review_deadline = '2099-05-01'; }, '10a68ffe8a9f692e35f58267ed8dddf56ddfe05221ba08982ef9ab577a717986'],
    ['cycle.customFields', (a) => { a.cycle.custom_fields = { foo: 'baz' }; }, '1020108177dc6940a24838006f365d83abe785851f74705e3f348ec4da091260'],
    ['honorariumAmount', (a) => { a.honorariumAmount = 999; }, 'cd96769bee2189cccf0d2000878fb43eac67d75e11637a41f9ee356cf14f2dbc'],
  ])('changing %s alone flips the hash away from the base golden value', (label, mutate, goldenForMutation) => {
    const args = baseArgs();
    mutate(args);
    const hash = fingerprintDraft(buildDraftFingerprintInputs(args));
    expect(hash).not.toBe(BASE_HASH);
    expect(hash).toBe(goldenForMutation);
  });
});

describe('helper cross-check (tests/helpers/draft-fingerprint.js independence)', () => {
  test('the test helper (which does NOT import production) agrees with the production builder over the standard fixture', () => {
    const args = baseArgs();
    const production = fingerprintDraft(buildDraftFingerprintInputs(args));
    const helper = computeFixtureFingerprint(args);
    expect(helper).toBe(production);
    expect(helper).toBe(BASE_HASH);
  });

  test('the two implementations agree over every single-field mutation in the table above', () => {
    const mutations = [
      (a) => { a.templateType = 'invitation'; },
      (a) => { a.suggestionId = a.suggestionId.toUpperCase(); },
      (a) => { a.person.wmkf_name = '  Dr. Jane Roe  '; },
      (a) => { a.person.wmkf_primaryaffiliation = null; a.person.wmkf_organizationname = null; },
      (a) => { a.request.akoya_title = 'Different title'; },
      (a) => { a.coPINames = ['Dr. Bea Co', 'Dr. Alex Co']; },
      (a) => { a.suggestion = { wmkf_reviewduedateoverride: '2099-03-01' }; },
      (a) => { a.cycle.custom_fields = { foo: 'baz' }; },
      (a) => { a.honorariumAmount = null; },
    ];
    for (const mutate of mutations) {
      const args = baseArgs();
      mutate(args);
      expect(computeFixtureFingerprint(args)).toBe(fingerprintDraft(buildDraftFingerprintInputs(args)));
    }
  });
});

// Projection-divergence coverage moved off this file (2026-09-06 correction
// round): calling the pure builder twice with literal objects here never ran
// either service, so a real regression in which projection of a row
// send-emails-service.js actually reads (a narrowed $select) could not fail
// any test — every mock elsewhere returns the same fixed object regardless
// of the `select` string it receives (Opus proved this: narrowing send's
// request $select back to `akoya_title` only left 449/449 tests green). The
// two files below run the REAL renderEmails/sendEmails against
// select-honoring adapter mocks and assert on the mocks' call arguments, so a
// narrowed select fails directly:
//   - tests/unit/send-emails-fingerprint-selects.test.js (select/field
//     inspection: request select, person select, cycle fields map,
//     fetchCoPIs/getHonorariumAmount invocation)
//   - tests/unit/draft-fingerprint-projection-divergence.test.js (Case A:
//     both routes' real selects agree → sent; Case B: a request read whose
//     select omits wmkf_abstract, simulated without touching production code
//     → draft_stale, no dispatch/write)

describe('exclusions (Stage 6D accepted contract)', () => {
  test('wmkf_honorariumoptout is not part of the fingerprint inputs', () => {
    const args = baseArgs();
    const before = fingerprintDraft(buildDraftFingerprintInputs(args));
    // buildDraftFingerprintInputs never reads suggestion.wmkf_honorariumoptout;
    // setting it must not appear in the built inputs at all.
    args.suggestion.wmkf_honorariumoptout = true;
    const after = fingerprintDraft(buildDraftFingerprintInputs(args));
    expect(after).toBe(before);
    expect(JSON.stringify(buildDraftFingerprintInputs(args))).not.toContain('honorariumoptout');
    expect(JSON.stringify(buildDraftFingerprintInputs(args))).not.toContain('honorariumOptOut');
  });

  test('candidate email is not part of the fingerprint inputs', () => {
    const inputs = buildDraftFingerprintInputs({ ...baseArgs(), person: { ...baseArgs().person, wmkf_emailaddress: 'jane@uni.edu' } });
    expect(JSON.stringify(inputs)).not.toContain('jane@uni.edu');
  });

  test('honorarium read failure sentinel (null) is accepted and hashes deterministically', () => {
    const args = baseArgs();
    args.honorariumAmount = null;
    const a = fingerprintDraft(buildDraftFingerprintInputs(args));
    const b = fingerprintDraft(buildDraftFingerprintInputs({ ...baseArgs(), honorariumAmount: null }));
    expect(a).toBe(b);
  });
});
