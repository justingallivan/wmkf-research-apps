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
const BASE_HASH = '1f1ae1ba76ad71d86568887d7cb27a842e857acfd41252fb12f0badc16748832';

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
    expect(hash).toBe('b2b40d759ec58dc2d10b1650668d82067aa60a64f7d50b82a372833296a859c7');
    expect(hash).not.toBe(BASE_HASH);
  });

  // Table-driven: each fingerprinted input, changed alone, must flip the hash.
  // This is the coverage the plan asks for ("a table-driven case per input
  // field proving each flips the hash") plus the co-PI *order* sensitivity
  // case (order is part of the body — the plan documents this explicitly).
  test.each([
    ['templateType (invitation v3)', (a) => { a.templateType = 'invitation'; }, 'fc868fe3cfef0a30cbc0b8db8acf3bb72bc615d1217d7fa5ffbf532dc3319672'],
    ['suggestionId (a different GUID)', (a) => { a.suggestionId = '33333333-3333-4333-8333-333333333333'; }, '5c6c5a0cc41628e2424cedea50d2f901b275b73d6c3830dcc978bf06fea28cda'],
    ['candidate.name', (a) => { a.person.wmkf_name = 'Dr. Other Name'; }, 'cb5ace75a426a3f835f76ffe53bd8c196ee7d6d8f314e5ee4e06b7b301efa920'],
    ['candidate.affiliation', (a) => { a.person.wmkf_primaryaffiliation = 'Uni B'; }, '21407f7ff8b0a199ae04cf6151b435d2c76f2f393c78b199ec9c3feb55ec8b12'],
    ['proposal.title', (a) => { a.request.akoya_title = 'Different title'; }, 'a8bea9c05d817ed75d25b1878ff506ed632c411362596b8e1e75a7f8f032164b'],
    ['proposal.abstract', (a) => { a.request.wmkf_abstract = 'Different abstract'; }, '88ce8619680c7159007af696d2537eec5e5f6d1181cc7ae58da2363fd482b9cf'],
    ['proposal.authors', (a) => { a.request._wmkf_projectleader_value_formatted = 'Dr. Other PI'; }, '2d09150df0591efa1c04ce53f4492386519d11c873e124e9e0974f2fea6279f7'],
    ['proposal.institution', (a) => { a.request._akoya_applicantid_value_formatted = 'Org B'; }, '26af4c13358ebd265e31ce7b1221451ab4591620d95ac122ad7d4c902afa5ea3'],
    ['proposal.coInvestigators (membership)', (a) => { a.coPINames = ['Dr. Alex Co']; }, '8afb0df10a984215d4ee9ac22987af1782903a1da537ead9b45dca3fa637377f'],
    ['proposal.coInvestigators (order only, same membership)', (a) => { a.coPINames = ['Dr. Bea Co', 'Dr. Alex Co']; }, 'd86516fa65d6ef27924c3e6d51da6f2fa07043910e55a1f95c376b6d6fbd7e59'],
    ['engagement.reviewDueDateOverride', (a) => { a.suggestion = { wmkf_reviewduedateoverride: '2099-03-01' }; }, 'a0e37d188a5de1343c55dbbdb088688774b2849f928d0651ee8fc9808b2046f4'],
    ['request.reviewDueDate', (a) => { a.request.wmkf_reviewduedate = '2099-04-01'; }, 'ee16f62b9913dc63b4740aefb0a2d7d3532c10a8abe32908785d0985635a00ce'],
    ['request.grantCycleId', (a) => { a.request._wmkf_grantcycle_value = '26262626-2626-4626-8626-262626262626'; }, '74004440d6a62c6159218272e579400fc3b970923dab3537090cb0178276d9c1'],
    ['cycle.programName', (a) => { a.cycle.program_name = 'Different Program'; }, 'f2d20acc1d399afe334d1a3e192d81cb11cb4800fb41a98e98440103e38fc6f3'],
    ['cycle.customFields', (a) => { a.cycle.custom_fields = { foo: 'baz' }; }, '9cc55ec82e9a823af19f0a4f704ba21379463ea2ccd03431ff46d780db621b50'],
    ['honorariumAmount', (a) => { a.honorariumAmount = 999; }, '3b97f56c0a4514f8bfef02f06503da6e88fb55f3b47097f012dfe023b50eec0e'],
  ])('changing %s alone flips the hash away from the base golden value', (label, mutate, goldenForMutation) => {
    const args = baseArgs();
    mutate(args);
    const hash = fingerprintDraft(buildDraftFingerprintInputs(args));
    expect(hash).not.toBe(BASE_HASH);
    expect(hash).toBe(goldenForMutation);
  });
});

test('the retired cycle review deadline is not a fingerprint input (2026-11-01)', () => {
  const args = baseArgs();
  args.cycle.review_deadline = '2099-05-01';
  expect(fingerprintDraft(buildDraftFingerprintInputs(args))).toBe(BASE_HASH);
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
