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
      _wmkf_grantcycle_value: '27272727-2727-4727-8727-272727272727',
    },
    coPINames: ['Dr. Alex Co', 'Dr. Bea Co'],
    cycle: { program_name: 'Program', review_deadline: '2099-02-01', custom_fields: { foo: 'bar' } },
    honorariumAmount: 250,
  };
}

// Golden hash for baseArgs() above — the canonical fixture every other case
// in this file is diffed against.
// Re-pinned 2026-10-29 for the D48 version bump (v1→v2 for non-invitations).
const BASE_HASH = '6e6046357042f13def542f18bd63e91b70aec23a848a095f1a0bbc5ceeb731dd';

describe('fingerprintDraft golden hashes', () => {
  test('base fixture hashes to the pinned golden value', () => {
    expect(fingerprintDraft(buildDraftFingerprintInputs(baseArgs()))).toBe(BASE_HASH);
  });

  test('request.wmkf_organizationname is not a body input: changing it leaves the hash at the golden value', () => {
    const args = baseArgs();
    args.request.wmkf_organizationname = 'Some Other Org';
    expect(fingerprintDraft(buildDraftFingerprintInputs(args))).toBe(BASE_HASH);
  });

  test('the request meeting date is not an input: the Grant Cycle link names the cycle (owner, 2026-10-29)', () => {
    const args = baseArgs();
    args.request.wmkf_meetingdate = '2099-12-01';
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
    expect(hash).toBe('8a38843ee62f43d2ba3246e4875857c292eb0a610879e49c1e47ca1c1351fcfe');
    expect(hash).not.toBe(BASE_HASH);
  });

  // Table-driven: each fingerprinted input, changed alone, must flip the hash.
  // This is the coverage the plan asks for ("a table-driven case per input
  // field proving each flips the hash") plus the co-PI *order* sensitivity
  // case (order is part of the body — the plan documents this explicitly).
  test.each([
    ['templateType (invitation v3)', (a) => { a.templateType = 'invitation'; }, '9fcf671f349340e37809b698eace8549c82cf60985667d9ac37076c7bbda37d6'],
    ['suggestionId (a different GUID)', (a) => { a.suggestionId = '33333333-3333-4333-8333-333333333333'; }, 'a51b4746a7b5264259a659137b62ace3b61c42b12fb522ee75190cc9d4c289b4'],
    ['candidate.name', (a) => { a.person.wmkf_name = 'Dr. Other Name'; }, 'a4a0745081a9af4fa1484122778413f53e17705fec16f1b1d7d74cae58710c09'],
    ['candidate.affiliation', (a) => { a.person.wmkf_primaryaffiliation = 'Uni B'; }, '893c76ecb8897499ad01752bf6e649628cbb55774d8756dd5b0d536c6d0a3335'],
    ['proposal.title', (a) => { a.request.akoya_title = 'Different title'; }, '4aebfea6738a8e3350825cfddcc1ed035e32c999b1f8940c522ca45489cad7d8'],
    ['proposal.abstract', (a) => { a.request.wmkf_abstract = 'Different abstract'; }, 'b9082e97b05f738e4a11b4a7f2e0d2b725cd8022d03e73bec700d484be5a846e'],
    ['proposal.authors', (a) => { a.request._wmkf_projectleader_value_formatted = 'Dr. Other PI'; }, 'd88717c62811e436f1d921dd8ad621b4cc1eaa244b0c7fac961c6f6b421cb7f4'],
    ['proposal.institution', (a) => { a.request._akoya_applicantid_value_formatted = 'Org B'; }, 'd08635e2f6c328dbc711ca2f6b0bc3fde2b0a202b8735abb307124a39c951050'],
    ['proposal.coInvestigators (membership)', (a) => { a.coPINames = ['Dr. Alex Co']; }, '9c172d5e4f925bdf460d3c2984ce2dd614420984a014070be6a6ab22e7b4ba7c'],
    ['proposal.coInvestigators (order only, same membership)', (a) => { a.coPINames = ['Dr. Bea Co', 'Dr. Alex Co']; }, '1e0d9b02d57b36e584827a8241a66ed8151655f206d88e67f238fad85d2495e5'],
    ['engagement.reviewDueDateOverride', (a) => { a.suggestion = { wmkf_reviewduedateoverride: '2099-03-01' }; }, '63b3e6bd6539ce4199851705d41cbae4babd18067ec1d7edec21d54542b54133'],
    ['request.reviewDueDate', (a) => { a.request.wmkf_reviewduedate = '2099-04-01'; }, '0425ce1b221465ca444bd9549fcec2da216448e21c53e983cb07c8fc64fc7970'],
    ['request.grantCycleId', (a) => { a.request._wmkf_grantcycle_value = '26262626-2626-4626-8626-262626262626'; }, '2125c90d1c961c36c5ee92f6e2f87cd2674fb182f3c033d9f7614a24769a8097'],
    ['cycle.programName', (a) => { a.cycle.program_name = 'Different Program'; }, 'b03cd77074dc506b994fd8d3799c57326794ab6cbdaf37752bfe5f719ded5306'],
    ['cycle.reviewDeadline', (a) => { a.cycle.review_deadline = '2099-05-01'; }, '96b513107aaf83458fed9f7fcbf783d9627ba21cef55756103495d9609fe6c4f'],
    ['cycle.customFields', (a) => { a.cycle.custom_fields = { foo: 'baz' }; }, 'a344166133db98c20863426a1a00a38cbf902a9291f442695c94d4bbd0ee11a8'],
    ['honorariumAmount', (a) => { a.honorariumAmount = 999; }, '6f3744065a401a78788d2badf8489f847d0d0a10c12a3bed460f21cbcda618cb'],
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
