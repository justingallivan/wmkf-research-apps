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
      _wmkf_programdirector_value: 'PD-A',
      _akoya_applicantid_value_formatted: 'Org A',
      wmkf_organizationname: 'N/A',
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
// Re-pinned 2026-10-29 for the D48 version bump (v1→v2 for non-invitations).
const BASE_HASH = 'ec72d4a4f9f025617e35f13e22ae8a5e89e4239f97318f6e9e328af3338e6180';

describe('fingerprintDraft golden hashes', () => {
  test('base fixture hashes to the pinned golden value', () => {
    expect(fingerprintDraft(buildDraftFingerprintInputs(baseArgs()))).toBe(BASE_HASH);
  });

  test('request.wmkf_organizationname is not a body input: changing it leaves the hash at the golden value', () => {
    const args = baseArgs();
    args.request.wmkf_organizationname = 'Some Other Org';
    expect(fingerprintDraft(buildDraftFingerprintInputs(args))).toBe(BASE_HASH);
  });

  test('only invitation fingerprints use v3 and bind the normalized request Program Director', () => {
    const invite = { ...baseArgs(), templateType: 'invitation' };
    const first = buildDraftFingerprintInputs(invite);
    expect(first.v).toBe(3);
    expect(first.request.programDirectorId).toBe('pd-a');

    invite.request._wmkf_programdirector_value = 'pd-b';
    expect(fingerprintDraft(buildDraftFingerprintInputs(invite)))
      .not.toBe(fingerprintDraft(first));

    const materials = buildDraftFingerprintInputs(baseArgs());
    expect(materials.v).toBe(2);
    expect(materials.request).not.toHaveProperty('programDirectorId');
    expect(fingerprintDraft(materials)).toBe(BASE_HASH);
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
    expect(hash).toBe('1ab98d4c1a40ac6aefa8c44f5e297dcc08e6b9acb6f3725dedfe71dfbd36f725');
    expect(hash).not.toBe(BASE_HASH);
  });

  // Table-driven: each fingerprinted input, changed alone, must flip the hash.
  // This is the coverage the plan asks for ("a table-driven case per input
  // field proving each flips the hash") plus the co-PI *order* sensitivity
  // case (order is part of the body — the plan documents this explicitly).
  test.each([
    ['templateType (invitation v3)', (a) => { a.templateType = 'invitation'; }, 'b97d939b34b382f6329bc4a4a65d2fd84c2f6ed635cc34342ac106b4af182c38'],
    ['suggestionId (a different GUID)', (a) => { a.suggestionId = '33333333-3333-4333-8333-333333333333'; }, '81106b0e073c4066aff5e593f9b7f99d9deca8143f3fab4bc7929eebb519064d'],
    ['candidate.name', (a) => { a.person.wmkf_name = 'Dr. Other Name'; }, '02fac203d9512887b780fab55296eedc64dcd87faaaf53c1e19dcfcbdf3c722b'],
    ['candidate.affiliation', (a) => { a.person.wmkf_primaryaffiliation = 'Uni B'; }, '33f3ce7e0bcbc4cc6b5dc6de04201eca6ee397554b80d8f07daab62b2b7ae819'],
    ['proposal.title', (a) => { a.request.akoya_title = 'Different title'; }, '146a570b6f9156683e107c276c35ca749bb8a187f035b053551e214902e5ea31'],
    ['proposal.abstract', (a) => { a.request.wmkf_abstract = 'Different abstract'; }, 'c3a3aeaa3c68eb864ee4ff5d8a6576e458721b0e438f15c541a3e735f16ca022'],
    ['proposal.authors', (a) => { a.request._wmkf_projectleader_value_formatted = 'Dr. Other PI'; }, '848315855cbdebcd8ea6a8f020b39769a9cea4ebcb1da3817b01cf4b7c8d6146'],
    ['proposal.institution', (a) => { a.request._akoya_applicantid_value_formatted = 'Org B'; }, '72e2bc00a3af6387f0600bd4a4d0e66c5e908271d63ecfb35037a37b578419da'],
    ['proposal.coInvestigators (membership)', (a) => { a.coPINames = ['Dr. Alex Co']; }, '02c50726a484ef4a851bc08eff59dc6bfe596377f7ab6c210ee2ee97f37cdfb6'],
    ['proposal.coInvestigators (order only, same membership)', (a) => { a.coPINames = ['Dr. Bea Co', 'Dr. Alex Co']; }, '4488a0d5172094a6fa94cfc982c76d9baa388a13f2b31ee79cb88e93b165a667'],
    ['engagement.reviewDueDateOverride', (a) => { a.suggestion = { wmkf_reviewduedateoverride: '2099-03-01' }; }, '5ce815ee30b991f87c67791e26815944c3ad91ead92f73dd460608c65c9c8e1d'],
    ['request.reviewDueDate', (a) => { a.request.wmkf_reviewduedate = '2099-04-01'; }, '7c13922b44e9842198d8b8329ba07362e61d9c0184103ffe8270381f64e7d6e1'],
    ['request.meetingDate', (a) => { a.request.wmkf_meetingdate = '2099-07-01'; }, 'd662ace4a1c0e08e2069a8226b214af490e141483af750f57bb94066a2d34211'],
    ['cycle.programName', (a) => { a.cycle.program_name = 'Different Program'; }, 'fe5c5505d2662080950fa4856ba5c5e4c95dd6b32ed1a27323960f7f32d6422c'],
    ['cycle.reviewDeadline', (a) => { a.cycle.review_deadline = '2099-05-01'; }, '7250b11d4ddf9ffffbf991d802a164aada1a6f2637e5cdec542aa09cb8328066'],
    ['cycle.customFields', (a) => { a.cycle.custom_fields = { foo: 'baz' }; }, '3cb071eed0185799d1011f19c3d66746553c2a602cd0f876dcff836d8c82b34f'],
    ['honorariumAmount', (a) => { a.honorariumAmount = 999; }, '2a1833e0f88629ba232db3127b95a669deccbfb778d412713eacbe35d522e3af'],
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

test('D48: a fingerprint computed under the previous contract versions never matches the current one', () => {
  // A preview rendered before deploy carried v2 (invitation) / v1 (others) and
  // could embed a composer due date; send must refuse it as stale.
  for (const templateType of ['invitation', 'materials']) {
    const current = buildDraftFingerprintInputs({ ...baseArgs(), templateType });
    const previous = { ...current, v: templateType === 'invitation' ? 2 : 1 };
    expect(fingerprintDraft(previous)).not.toBe(fingerprintDraft(current));
  }
});
