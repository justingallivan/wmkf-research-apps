/**
 * @jest-environment node
 *
 * Contract 5 precision guard: the COI path uses a stricter institution matcher
 * than the legacy generic matcher, so discovery hard drops do not over-match
 * distinct institutions that share common university tokens.
 */
const { DeduplicationService } = require('../../lib/services/deduplication-service');

describe('institutionsMatchForCOI — curated S321 precision suite', () => {
  const DISTINCT_PAIRS = [
    ['University of California, San Francisco', 'University of California, Berkeley'],
    ['University of Maryland', 'University of Maryland, Baltimore County'],
    ['University of Michigan', 'Michigan State University'],
    ['Indiana University', 'Indiana University of Pennsylvania'],
    ['California University of Pennsylvania', 'University of Pennsylvania'],
    ['Miami University', 'University of Miami'],
    ['University of Washington', 'Washington University in St. Louis'],
    ['New York University', 'City University of New York'],
    ['Columbia University', 'University of British Columbia'],
    ['University of Texas at Austin', 'University of Texas at Dallas'],
  ];

  const SAME_PAIRS = [
    ['MIT', 'Massachusetts Institute of Technology'],
    ['University of Michigan, Ann Arbor', 'University of Michigan'],
    ['Dept of Chemistry, Stanford University', 'Stanford University'],
  ];

  test.each(DISTINCT_PAIRS)('does not match distinct institutions: %s vs %s', (a, b) => {
    expect(DeduplicationService.institutionsMatchForCOI(a, b)).toBe(false);
  });

  test.each(SAME_PAIRS)('matches same-institution variants: %s vs %s', (a, b) => {
    expect(DeduplicationService.institutionsMatchForCOI(a, b)).toBe(true);
  });

  test('keeps campus-qualifier containment narrow', () => {
    expect(DeduplicationService.institutionsMatchForCOI(
      'University of Maryland, Baltimore County',
      'University of Maryland',
    )).toBe(false);
    expect(DeduplicationService.institutionsMatchForCOI(
      'University of California, Berkeley',
      'University of California',
    )).toBe(false);
  });
});

describe('institutionsMatchForCOI — institution ids first', () => {
  test('matches when both sides carry the same OpenAlex institution id despite name drift', () => {
    expect(DeduplicationService.institutionsMatchForCOI(
      { name: 'MIT', openAlexId: 'https://openalex.org/I63966007' },
      { name: 'Massachusetts Institute of Technology', openAlexInstitutionId: 'I63966007' },
    )).toBe(true);
  });

  test('does not match when both sides carry different OpenAlex ids even if names match', () => {
    expect(DeduplicationService.institutionsMatchForCOI(
      { name: 'University of Michigan', openAlexId: 'https://openalex.org/I1' },
      { name: 'University of Michigan', openAlexInstitutionId: 'https://openalex.org/I2' },
    )).toBe(false);
  });

  test('matches when both sides carry the same ROR id', () => {
    expect(DeduplicationService.institutionsMatchForCOI(
      { name: 'Princeton University', ror: 'https://ror.org/00hx57361' },
      { name: 'Princeton', institutionRor: '00hx57361' },
    )).toBe(true);
  });

  test('falls back to name precision when only one side has an id', () => {
    expect(DeduplicationService.institutionsMatchForCOI(
      { name: 'MIT', openAlexId: 'https://openalex.org/I63966007' },
      { name: 'Massachusetts Institute of Technology' },
    )).toBe(true);
  });
});

describe('partitionConflicts — ledger details', () => {
  test('returns kept rows plus COI-dropped rows with details', () => {
    const out = DeduplicationService.partitionConflicts(
      [
        { name: 'Same', affiliation: 'University of Michigan, Ann Arbor' },
        { name: 'Distinct', affiliation: 'University of Maryland, Baltimore County' },
      ],
      ['University of Michigan', 'University of Maryland'],
    );

    expect(out.filtered.map((c) => c.name)).toEqual(['Distinct']);
    expect(out.institutionConflicts).toHaveLength(1);
    expect(out.institutionConflicts[0]).toMatchObject({
      name: 'Same',
      hasInstitutionCOI: true,
      institutionCOIDetails: {
        piInstitution: 'University of Michigan',
        reviewerInstitution: 'University of Michigan, Ann Arbor',
      },
    });
  });
});
