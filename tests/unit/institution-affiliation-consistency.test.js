/**
 * @jest-environment node
 *
 * W1 contract: OpenAlex associated institutions are one-hop consistency
 * evidence for identity corroboration and mismatch alerts. They are not
 * transitive and are never COI hard-drop evidence.
 */

const {
  createInstitutionConsistencyChecker,
  institutionsConsistent,
} = require('../../lib/services/institution-affiliation-consistency');

const MIT = {
  openAlexId: 'https://openalex.org/I63966007',
  displayName: 'Massachusetts Institute of Technology',
  associatedInstitutions: [],
};
const BROAD = {
  openAlexId: 'https://openalex.org/I107606265',
  displayName: 'Broad Institute',
  associatedInstitutions: [{
    openAlexId: MIT.openAlexId,
    displayName: MIT.displayName,
    relationship: 'related',
  }],
};
const HARVARD = {
  openAlexId: 'https://openalex.org/I136199984',
  displayName: 'Harvard University',
  associatedInstitutions: [],
};
const DANA_FARBER = {
  openAlexId: 'https://openalex.org/I4210123880',
  displayName: 'Dana-Farber Cancer Institute',
  associatedInstitutions: [{
    openAlexId: HARVARD.openAlexId,
    displayName: HARVARD.displayName,
    relationship: 'related',
  }],
};
const MGH = {
  openAlexId: 'https://openalex.org/I129052547',
  displayName: 'Massachusetts General Hospital',
  associatedInstitutions: [{
    openAlexId: HARVARD.openAlexId,
    displayName: HARVARD.displayName,
    relationship: 'related',
  }],
};
const WHITEHEAD = {
  openAlexId: 'https://openalex.org/I4210155639',
  displayName: 'Whitehead Institute',
  associatedInstitutions: [{
    openAlexId: MIT.openAlexId,
    displayName: MIT.displayName,
    relationship: 'related',
  }],
};

describe('institutionsConsistent', () => {
  test.each([
    [BROAD, MIT],
    [MIT, BROAD],
    [WHITEHEAD, MIT],
    [DANA_FARBER, HARVARD],
  ])('accepts direct or one-hop associated identity', (left, right) => {
    expect(institutionsConsistent(left, right)).toBe(true);
  });

  test('does not infer consistency through a common associated parent', () => {
    expect(institutionsConsistent(DANA_FARBER, MGH)).toBe(false);
  });
});

describe('createInstitutionConsistencyChecker', () => {
  test('resolves labels and applies one-hop evidence', async () => {
    const records = new Map([
      ['Broad Institute', BROAD],
      ['MIT', MIT],
    ]);
    const resolver = {
      resolve: jest.fn(async (name) => records.get(name) || null),
    };
    const checker = createInstitutionConsistencyChecker({ resolver });

    await expect(checker.areConsistent('Broad Institute', 'MIT')).resolves.toBe(true);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  test('provider abstention preserves a mismatch', async () => {
    const checker = createInstitutionConsistencyChecker({
      resolver: { resolve: jest.fn(async () => null) },
    });

    await expect(checker.areConsistent(
      'Dana-Farber Cancer Institute',
      'Massachusetts General Hospital',
    )).resolves.toBe(false);
  });
});
