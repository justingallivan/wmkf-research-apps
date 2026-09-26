/**
 * Test Request Factory slice 6c-ii Stage B — CLI reservation-time reviewer
 * resolution (scripts/rehearse-test-request-sandbox.mjs
 * `resolveReviewerAssignments` / `assertSyntheticReviewerIsolationOnForReviews`).
 *
 * Fake sandbox transport (`deps`) + fake ledger (only the two methods this
 * resolution calls: findAnyPersonByEmail, listAssignmentsByDestinationPerson).
 * Importing the script is safe: it now guards `main()` behind an
 * import.meta.url === argv[1] check (mirrors
 * export-test-request-source-bundle.mjs's own guard).
 *
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveReviewerAssignments,
  defaultReviewerAddressFor,
  applyDefaultReviewerAddress,
  assertSyntheticReviewerIsolationOnForReviews,
  runReserve,
  runAdvance,
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

function fakeDeps({ findAnyPersonByEmail } = {}) {
  return { findAnyPersonByEmail: findAnyPersonByEmail || (async () => null) };
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
      wmkf_name: ' TEST · Jane Reviewer ', wmkf_firstname: 'TEST · Jane', wmkf_lastname: 'Reviewer',
      wmkf_emailaddress: 'throwaway@example.test',
      wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
      wmkf_organizationname: 'Example University',
      wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => existingRow });
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
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_name: ' TEST · X Y ', wmkf_firstname: 'TEST · X', wmkf_lastname: 'Y',
      wmkf_emailaddress: 'throwaway@example.test', wmkf_areaofexpertise: null, wmkf_primaryaffiliation: null,
      wmkf_academicrank: null, wmkf_primarydepartment: null, wmkf_maininstitution: null, wmkf_organizationname: null, wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => existingRow });
    // Prior assignment(s) name a DIFFERENT source than this reservation's SOURCE_B.
    const ledger = fakeLedger({ priorSources: [SOURCE_A] });
    await expect(resolveReviewerAssignments({
      deps, ledger, bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_B, address: 'throwaway@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_provenance_mismatch' });
  });

  it('a same-source reused row whose projection metadata drifted refuses (reviewer_person_projection_drift)', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const driftedRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_name: ' TEST · Jane Reviewer ', wmkf_firstname: 'TEST · Jane',
      wmkf_lastname: 'Reviewer', wmkf_emailaddress: 'throwaway@example.test',
      wmkf_areaofexpertise: 'DRIFTED', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University', wmkf_organizationname: 'Example University', wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => driftedRow });
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
    })).rejects.toThrow(/no --reviewer-address, no synthetic default address in the bundle, and no TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS/);
  });

  it('a synthetic bundle reviewer with an exported address defaults to it when no flag is given', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A, {
      personIsSynthetic: true,
      person: { wmkf_name: ' TEST · Z Z ', wmkf_firstname: 'TEST · Z', wmkf_lastname: 'Z', wmkf_emailaddress: 'default@example.test' },
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

  it('P2-4: refuses a real (non-synthetic) person already owning the address (reviewer_person_not_synthetic)', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const realPersonRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_emailaddress: 'real.reviewer@example.test',
      wmkf_issyntheticreviewer: false, statecode: 0,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => realPersonRow });
    await expect(resolveReviewerAssignments({
      deps, ledger: fakeLedger(), bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_A, address: 'real.reviewer@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_not_synthetic' });
  });

  it('P2-4: refuses an inactive (statecode != 0) row even if marker-true', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const inactiveRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_emailaddress: 'throwaway@example.test',
      wmkf_issyntheticreviewer: true, statecode: 1,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => inactiveRow });
    await expect(resolveReviewerAssignments({
      deps, ledger: fakeLedger(), bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_A, address: 'throwaway@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_not_synthetic' });
  });

  it('P2-4: refuses a Contact-linked row even if marker-true and active', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const contactLinkedRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_emailaddress: 'throwaway@example.test',
      wmkf_issyntheticreviewer: true, statecode: 0, _wmkf_contact_value: '99999999-9999-4999-8999-999999999999',
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => contactLinkedRow });
    await expect(resolveReviewerAssignments({
      deps, ledger: fakeLedger(), bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_A, address: 'throwaway@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_not_synthetic' });
  });

  it('mutation guard: proves a recycled address is refused rather than silently rebound to a new source', async () => {
    // Alice's old synthetic identity (recorded provenance: SOURCE_A) must not
    // be silently rebound to Bob (SOURCE_B) just because Bob's flag reuses
    // Alice's throwaway address.
    const bundle = bundleWith([reviewer(SOURCE_B)]);
    const aliceProjectedRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON, wmkf_name: ' TEST · Alice A ', wmkf_firstname: 'TEST · Alice', wmkf_lastname: 'A',
      wmkf_emailaddress: 'recycled@example.test', wmkf_areaofexpertise: null, wmkf_primaryaffiliation: null,
      wmkf_academicrank: null, wmkf_primarydepartment: null, wmkf_maininstitution: null, wmkf_organizationname: null, wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async () => aliceProjectedRow });
    const ledger = fakeLedger({ priorSources: [SOURCE_A] }); // "Alice" was the source
    await expect(resolveReviewerAssignments({
      deps, ledger, bundle, reviewerAddressFlags: [{ sourcePersonId: SOURCE_B, address: 'recycled@example.test' }],
    })).rejects.toMatchObject({ code: 'reviewer_person_provenance_mismatch' });
  });
});

describe('default reviewer address (owner decision 2026-09-26: no minting, plus-tagged default base)', () => {
  const BASE = 'Owner.Inbox@Example.test';

  it('plus-tags the normalized base with 12 hex of SHA-256(lowercase source GUID)', () => {
    const address = defaultReviewerAddressFor(BASE, SOURCE_A);
    expect(address).toMatch(/^owner\.inbox\+[0-9a-f]{12}@example\.test$/);
    expect(defaultReviewerAddressFor(BASE, SOURCE_A.toUpperCase())).toBe(address);
    expect(defaultReviewerAddressFor(BASE, SOURCE_B)).not.toBe(address);
  });

  it('refuses a base that is not an address, already carries a plus tag, or leaves no room for the tag', () => {
    expect(() => defaultReviewerAddressFor('not-an-address', SOURCE_A)).toThrow(/not a plausible email address/);
    expect(() => defaultReviewerAddressFor('owner+x@example.test', SOURCE_A)).toThrow(/already carry a plus tag/);
    expect(() => defaultReviewerAddressFor(`${'a'.repeat(52)}@example.test`, SOURCE_A)).toThrow(/too long for a plus tag/);
    expect(defaultReviewerAddressFor(`${'a'.repeat(51)}@example.test`, SOURCE_A)).toHaveLength(51 + 13 + 13);
  });

  describe('applyDefaultReviewerAddress (runs after loadEnvLocal in main)', () => {
    const reviewsArgs = (reviewerAddress = []) => ({
      reserve: true, recipe: 'reviews', reviewerAddress, defaultReviewerAddress: null,
    });

    it('takes the base from the supplied env, not a value captured earlier', () => {
      const args = reviewsArgs();
      applyDefaultReviewerAddress(args, { TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS: BASE });
      expect(args.defaultReviewerAddress).toBe(BASE);
    });

    it('refuses a flagless reviews reservation with no default', () => {
      expect(() => applyDefaultReviewerAddress(reviewsArgs(), {})).toThrow(/requires at least one --reviewer-address/);
    });

    it('accepts flags alone, and refuses a malformed base even when flags are present', () => {
      const args = reviewsArgs(['x']);
      applyDefaultReviewerAddress(args, {});
      expect(args.defaultReviewerAddress).toBeNull();
      expect(() => applyDefaultReviewerAddress(reviewsArgs(['x']), { TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS: 'a+b@example.test' }))
        .toThrow(/already carry a plus tag/);
    });

    it('ignores the env for any other mode or recipe', () => {
      const args = { reserve: true, recipe: 'basic', reviewerAddress: [], defaultReviewerAddress: null };
      applyDefaultReviewerAddress(args, { TEST_REQUEST_DEFAULT_REVIEWER_ADDRESS: 'a+b@example.test' });
      expect(args.defaultReviewerAddress).toBeNull();
    });
  });

  it('gives each flagless real reviewer a distinct default and leaves flagged reviewers alone', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A), reviewer(SOURCE_B)]);
    const assignments = await resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle,
      reviewerAddressFlags: [{ sourcePersonId: SOURCE_B, address: 'flagged@example.test' }],
      defaultReviewerAddress: BASE,
    });
    expect(assignments.map((a) => [a.sourcePersonId, a.address])).toEqual([
      [SOURCE_A, defaultReviewerAddressFor(BASE, SOURCE_A)],
      [SOURCE_B, 'flagged@example.test'],
    ]);
  });

  it('a synthetic bundle address still wins over the default', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A, {
      personIsSynthetic: true,
      person: { wmkf_name: ' TEST · Z Z ', wmkf_firstname: 'TEST · Z', wmkf_lastname: 'Z', wmkf_emailaddress: 'default@example.test' },
    })]);
    const [assignment] = await resolveReviewerAssignments({
      deps: fakeDeps(), ledger: fakeLedger(), bundle, reviewerAddressFlags: [], defaultReviewerAddress: BASE,
    });
    expect(assignment.address).toBe('default@example.test');
  });

  it('re-cloning the same source reuses the synthetic person created under its default address', async () => {
    const bundle = bundleWith([reviewer(SOURCE_A)]);
    const defaultAddress = defaultReviewerAddressFor(BASE, SOURCE_A);
    const lookedUp = [];
    const existingRow = {
      wmkf_potentialreviewersid: EXISTING_PERSON,
      wmkf_name: ' TEST · Jane Reviewer ', wmkf_firstname: 'TEST · Jane', wmkf_lastname: 'Reviewer',
      wmkf_emailaddress: defaultAddress,
      wmkf_areaofexpertise: 'Genomics', wmkf_primaryaffiliation: 'Example University', wmkf_academicrank: 'Professor',
      wmkf_primarydepartment: 'Biology', wmkf_maininstitution: 'Example University',
      wmkf_organizationname: 'Example University',
      wmkf_issyntheticreviewer: true,
    };
    const deps = fakeDeps({ findAnyPersonByEmail: async (address) => { lookedUp.push(address); return address === defaultAddress ? existingRow : null; } });
    const [assignment] = await resolveReviewerAssignments({
      deps, ledger: fakeLedger({ priorSources: [SOURCE_A] }), bundle, reviewerAddressFlags: [], defaultReviewerAddress: BASE,
    });
    expect(lookedUp).toEqual([defaultAddress]);
    expect(assignment.reused).toBe(true);
    expect(assignment.destinationPersonId).toBe(EXISTING_PERSON);
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

describe('F2 (Codex slice 6c-ii Stage C round 1): I4 -- reservation-time review-file validation runs before the manifest is written', () => {
  // runReserve is not unit-mockable at this depth (buildGraphContext ->
  // runPreflight -> resolveReviewerAssignments -> Postgres, all real
  // dependencies with no injection seam) -- this is a SOURCE-ORDER pin, not
  // a behavioral test: it proves `validateReviewFilePlan` is called
  // strictly before `writeNewJson(args.manifestOut, ...)` in the script's
  // own source, exactly as `runReserve`'s call graph in
  // lib/services/test-requests/review-file-copy.js and the module's own
  // comments describe. M3 (moving the call after writeNewJson) turns this
  // red.
  test('validateReviewFilePlan is called before writeNewJson(args.manifestOut, ...) in runReserve', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'scripts/rehearse-test-request-sandbox.mjs'), 'utf8');
    const validateIndex = source.indexOf('validateReviewFilePlan(bundle');
    const writeManifestIndex = source.indexOf('writeNewJson(args.manifestOut');
    expect(validateIndex).toBeGreaterThan(-1);
    expect(writeManifestIndex).toBeGreaterThan(-1);
    expect(validateIndex).toBeLessThan(writeManifestIndex);
  });
});

describe('P2-3: runReserve/runAdvance refuse before any Dataverse or ledger call when the switch is off', () => {
  const ENV_KEY = 'SYNTHETIC_REVIEWER_ISOLATION';
  let saved;
  beforeEach(() => { saved = process.env[ENV_KEY]; delete process.env[ENV_KEY]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved;
  });

  /** A client whose every method fails the test if invoked at all. */
  function neverCalledClient() {
    const fail = (name) => jest.fn(() => { throw new Error(`client.${name} must not be called`); });
    return { get: fail('get'), post: fail('post'), patch: fail('patch'), delete_: fail('delete_') };
  }

  it('runReserve refuses immediately for --recipe=reviews with zero client calls', async () => {
    const client = neverCalledClient();
    await expect(runReserve(client, { recipe: 'reviews' }, 'postgres://unused')).rejects.toThrow(/SYNTHETIC_REVIEWER_ISOLATION/);
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });

  it('runAdvance refuses immediately for a reviews-recipe manifest with zero client calls', async () => {
    const client = neverCalledClient();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reviews-manifest-'));
    const manifestPath = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ recipe: 'reviews' }));
    try {
      await expect(runAdvance(client, { manifest: manifestPath, bundle: undefined, steps: 1 }, 'postgres://unused'))
        .rejects.toThrow(/SYNTHETIC_REVIEWER_ISOLATION/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const fn of Object.values(client)) expect(fn).not.toHaveBeenCalled();
  });
});
