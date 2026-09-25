/**
 * Test Request Factory slice 6c-ii Stage B — CLI reservation-time reviewer
 * resolution (scripts/rehearse-test-request-sandbox.mjs
 * `resolveReviewerAssignments` / `assertSyntheticReviewerIsolationOnForReviews`).
 *
 * Fake sandbox transport (`deps`) + fake ledger (only the two methods this
 * resolution calls: findSyntheticByEmail, listAssignmentsByDestinationPerson).
 * Importing the script is safe: it now guards `main()` behind an
 * import.meta.url === argv[1] check (mirrors
 * export-test-request-source-bundle.mjs's own guard).
 *
 * @jest-environment node
 */
import {
  resolveReviewerAssignments,
  assertSyntheticReviewerIsolationOnForReviews,
} from '../../scripts/rehearse-test-request-sandbox.mjs';

const SOURCE_A = '77777777-7777-4777-8777-777777777771';
const SOURCE_B = '77777777-7777-4777-8777-777777777772';
const EXISTING_PERSON = '88888888-8888-4888-8888-888888888881';

function bundleWith(reviewers) {
  return { reviewers };
}

function reviewer(personId, overrides = {}) {
  return {
    suggestionId: `sug-${personId}`,
    personId,
    person: {
      wmkf_name: 'Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer',
      wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University',
      wmkf_academicrank: 'Professor', wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
    },
    personIsSynthetic: false,
    suggestion: {},
    answers: [],
    reviewForm: 'unreceived',
    files: [],
    ...overrides,
  };
}

function fakeDeps({ findSyntheticByEmail } = {}) {
  return { findSyntheticByEmail: findSyntheticByEmail || (async () => null) };
}

function fakeLedger({ priorSources = [] } = {}) {
  return { listAssignmentsByDestinationPerson: async () => priorSources };
}

describe('resolveReviewerAssignments', () => {
  it('a fresh reviewer with no existing synthetic person preallocates a fresh GUID (reused: false)', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const [assignment] = await resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle,
      reviewerAddressFlags: [{ sourcePersonId: SOURCE_A, address: 'throwaway@example.test' }],
    });
    expect(assignment.reused).toBe(false);
    expect(assignment.sourcePersonId).toBe(SOURCE_A);
    expect(assignment.destinationPersonId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('two reservations with the same address and source resolve to the same existing GUID (reused: true)', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const existingRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON,
      wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane', wmkf_lastname: 'Reviewer',
      wmkf_emailaddress: 'throwaway@example.test',
      wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
      wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findSyntheticByEmail: async () => existingRow });
    const ledger = fakeLedger({ priorSources: [SOURCE_A] });
    const [assignment] = await resolveReviewerAssignments({
      deps, ledger, bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_A, address: 'throwaway@example.test' }],
    });
    expect(assignment.reused).toBe(true);
    expect(assignment.destinationPersonId).toBe(EXISTING_PERSON);
  });

  it('the same address for a DIFFERENT source than a prior assignment refuses (reviewer_person_provenance_mismatch)', async () => {
    const bundle = bundleWith([reviewer(SOURCE_B)]);
    const existingRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_name: 'TEST · X', wmkf_firstname: 'X', wmkf_lastname: 'Y',
      wmkf_emailaddress: 'throwaway@example.test', wmkf_areaofexpertise: null, wmkf_primaryaffiliation: null,
      wmkf_academicrank: null, wmkf_primarydepartment: null, wmkf_maininstitution: null, wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findSyntheticByEmail: async () => existingRow });
    // Prior assignment(s) name a DIFFERENT source than this reservation's SOURCE_B.
    const ledger = fakeLedger({ priorSources: [SOURCE_A] });
    await expect(resolveReviewerAssignments({
      deps, ledger, bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_B, address: 'throwaway@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_provenance_mismatch' });
  });

  it('a same-source reused row whose projection metadata drifted refuses (reviewer_person_projection_drift)', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const driftedRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_name: 'TEST · Jane Reviewer', wmkf_firstname: 'Jane',
      wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test',
      wmkf_areaofexpertise: 'DRIFTED', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University', wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findSyntheticByEmail: async () => driftedRow });
    const ledger = fakeLedger({ priorSources: [SOURCE_A] });
    await expect(resolveReviewerAssignments({
      deps, ledger, bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_A, address: 'throwaway@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_projection_drift' });
  });

  it('refuses a --reviewer-address naming a source GUID not in the bundle', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    await expect(resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle,
      reviewerAddressFlags: [{ sourcePersonId: SOURCE_B, address: 'throwaway@example.test' }],
    })).rejects.toThrow(/not a reviewer in the bundle/);
  });

  it('a bundle reviewer with no flag and no synthetic default address refuses', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]); // personIsSynthetic: false, no address
    await expect(resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle, reviewerAddressFlags: [],
    })).rejects.toThrow(/no --reviewer-address and no synthetic default address/);
  });

  it('a synthetic bundle reviewer with an exported address defaults to it when no flag is given', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A, {
      personIsSynthetic: true,
      person: { wmkf_name: 'TEST · Z', wmkf_firstname: 'Z', wmkf_lastname: 'Z', wmkf_emailaddress: 'default@example.test' },
    })]);
    const [assignment] = await resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle, reviewerAddressFlags: [],
    });
    expect(assignment.address).toBe('default@example.test');
    expect(assignment.reused).toBe(false);
  });

  it('two reviewers assigned the same normalized address refuse', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A), reviewer(SOURCE_B)]);
    await expect(resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle,
      reviewerAddressFlags: [
        { sourcePersonId: SOURCE_A, address: 'Same@Example.test' },
        { sourcePersonId: SOURCE_B, address: 'same@example.test' },
      ],
    })).rejects.toThrow(/assigned to more than one source reviewer/);
  });

  it('mutation guard: proves a recycled address is refused rather than silently rebound to a new source', async () => {
    // Alice's old synthetic identity (recorded provenance: SOURCE_A) must not
    // be silently rebound to Bob (SOURCE_B) just because Bob's flag reuses
    // Alice's throwaway address.
    const bundle = bundleWith([reviewer(SOURCE_B)]);
    const aliceProjectedRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_name: 'TEST · Alice', wmkf_firstname: 'Alice', wmkf_lastname: 'A',
      wmkf_emailaddress: 'recycled@example.test', wmkf_areaofexpertise: null, wmkf_primaryaffiliation: null,
      wmkf_academicrank: null, wmkf_primarydepartment: null, wmkf_maininstitution: null, wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findSyntheticByEmail: async () => aliceProjectedRow });
    const ledger = fakeLedger({ priorSources: [SOURCE_A] }); // "Alice" was the source
    await expect(resolveReviewerAssignments({
      deps, ledger, bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_B, address: 'recycled@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_provenance_mismatch' });
  });
});

describe('assertSyntheticReviewerIsolationOnForReviews', () => {
  const ENV_KEY = 'SYNTHETIC_REVIEWER_ISOLATION';
  let saved;
  beforeEach(() => { saved = process.env[ENV_KEY]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved;
  });

  it('is a no-op for a non-reviews recipe regardless of the switch', () => {
    delete process.env[ENV_KEY];
    expect(() => assertSyntheticReviewerIsolationOnForReviews('basic')).not.toThrow();
    expect(() => assertSyntheticReviewerIsolationOnForReviews('initial_assessment')).not.toThrow();
  });

  it('refuses a reviews recipe when the switch is unset', () => {
    delete process.env[ENV_KEY];
    expect(() => assertSyntheticReviewerIsolationOnForReviews('reviews')).toThrow(/SYNTHETIC_REVIEWER_ISOLATION/);
  });

  it('refuses a reviews recipe when the switch is any value other than the literal "on"', () => {
    process.env[ENV_KEY] = 'true';
    expect(() => assertSyntheticReviewerIsolationOnForReviews('reviews')).toThrow(/SYNTHETIC_REVIEWER_ISOLATION/);
  });

  it('allows a reviews recipe when the switch is "on"', () => {
    process.env[ENV_KEY] = 'on';
    expect(() => assertSyntheticReviewerIsolationOnForReviews('reviews')).not.toThrow();
  });
});
