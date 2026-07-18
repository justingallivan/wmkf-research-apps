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
    ['Dana-Farber Cancer Institute', 'Massachusetts General Hospital'],
    ['Institute for Advanced Study', 'Princeton University'],
  ];

  const SAME_PAIRS = [
    ['MIT', 'Massachusetts Institute of Technology'],
    ['University of Michigan, Ann Arbor', 'University of Michigan'],
    ['Dept of Chemistry, Stanford University', 'Stanford University'],
    ['Dana-Farber Cancer Institute', 'Dana-Farber Cancer Institute'],
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

describe('institution COI exemptions and campus separation', () => {
  test.each([
    ['Broad Institute', 'The Broad Institute'],
    ['HHMI', 'Howard Hughes Medical Institute'],
  ])('%s shared alone is visible but is not a hard COI match', (a, b) => {
    expect(DeduplicationService.institutionsMatchForCOI(a, b)).toBe(false);

    const out = DeduplicationService.partitionConflicts(
      [{ name: 'Shared institute', affiliation: a, affiliationSource: 'manual' }],
      [b],
    );

    expect(out.institutionConflicts).toHaveLength(0);
    expect(out.institutionFlagged).toHaveLength(1);
    expect(out.filtered[0]).toMatchObject({
      name: 'Shared institute',
      hasInstitutionCOI: true,
      institutionCOIExempt: true,
      institutionCOIDetails: {
        dropDecision: 'exempt',
        corroborationReason: 'shared_exempt_institution',
      },
    });
  });

  test('Janelia is a distinct campus: self-match drops, while HHMI does not match Janelia', () => {
    expect(DeduplicationService.institutionsMatchForCOI(
      'Janelia Research Campus',
      'Janelia Research Campus',
    )).toBe(true);
    expect(DeduplicationService.institutionsMatchForCOI(
      'Howard Hughes Medical Institute',
      'Janelia Research Campus',
    )).toBe(false);
  });

  test('a direct shared parent/campus wins over an exempt Broad signal', () => {
    const decision = DeduplicationService.institutionCOIDecision(
      {
        name: 'Dual affiliated',
        affiliation: 'Broad Institute',
        affiliationSource: 'manual',
        contactEnrichment: {
          orcidAffiliation: 'Massachusetts Institute of Technology',
        },
      },
      [
        { identity: 'Broad Institute', display: 'Broad Institute' },
        { identity: 'MIT', display: 'MIT' },
      ],
    );

    expect(decision).toMatchObject({
      dropDecision: 'dropped',
      candidate: {
        institutionCOIDetails: {
          piInstitution: 'MIT',
          reviewerInstitution: 'Massachusetts Institute of Technology',
        },
      },
    });
  });
});

describe('partitionConflictsResolved — W0 can narrow but never widen hard drops', () => {
  test('does not resolve or hard-drop a lexical non-match even when a resolver could map both to one id', async () => {
    const resolver = {
      resolve: jest.fn(async () => ({
        openAlexId: 'https://openalex.org/I1',
        displayName: 'Shared Parent',
        associatedInstitutions: [],
      })),
    };

    const out = await DeduplicationService.partitionConflictsResolved(
      [{ name: 'Candidate', affiliation: 'Dana-Farber Cancer Institute' }],
      ['Massachusetts General Hospital'],
      [],
      { resolver },
    );

    expect(out.filtered).toHaveLength(1);
    expect(out.institutionConflicts).toHaveLength(0);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  test('different resolved ids refute a lexical same-name conflict', async () => {
    const resolver = {
      resolve: jest.fn()
        .mockResolvedValueOnce({
          openAlexId: 'https://openalex.org/I1',
          displayName: 'Example University',
          associatedInstitutions: [],
        })
        .mockResolvedValueOnce({
          openAlexId: 'https://openalex.org/I2',
          displayName: 'Example University',
          associatedInstitutions: [],
        }),
    };
    const candidate = {
      name: 'Candidate',
      affiliation: 'Example University',
    };

    const out = await DeduplicationService.partitionConflictsResolved(
      [candidate],
      ['Example University'],
      [],
      { resolver },
    );

    expect(out.filtered).toEqual([candidate]);
    expect(out.institutionConflicts).toHaveLength(0);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
  });

  test('provider abstention preserves the legacy lexical hard conflict', async () => {
    const resolver = { resolve: jest.fn(async () => null) };
    const out = await DeduplicationService.partitionConflictsResolved(
      [{ name: 'Candidate', affiliation: 'MIT', affiliationSource: 'manual' }],
      ['Massachusetts Institute of Technology'],
      [],
      { resolver },
    );

    expect(out.filtered).toHaveLength(0);
    expect(out.institutionConflicts).toHaveLength(1);
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
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

  test('corroborated institution id match stays hard-dropped', () => {
    const out = DeduplicationService.partitionConflicts(
      [{
        name: 'ID Match',
        affiliation: 'MIT',
        affiliationSource: 'openalex_current',
        openAlexInstitutionId: 'https://openalex.org/I63966007',
      }],
      [{ name: 'Massachusetts Institute of Technology', openAlexId: 'I63966007' }],
    );

    expect(out.filtered).toHaveLength(0);
    expect(out.institutionFlagged).toHaveLength(0);
    expect(out.institutionConflicts[0].institutionCOIDetails).toMatchObject({
      dropDecision: 'dropped',
      corroborationReason: 'matching_institution_id',
      matchedAffiliationSource: 'openalex_current',
    });
  });

  test('high-trust current affiliation match stays hard-dropped', () => {
    const out = DeduplicationService.partitionConflicts(
      [{
        name: 'ORCID Current',
        affiliation: 'Massachusetts Institute of Technology',
        affiliationSource: 'orcid_current',
      }],
      ['MIT'],
    );

    expect(out.filtered).toHaveLength(0);
    expect(out.institutionConflicts[0].institutionCOIDetails).toMatchObject({
      dropDecision: 'dropped',
      corroborationReason: 'high_trust_current_affiliation',
      matchedAffiliationSource: 'orcid_current',
    });
  });

  test('single low-trust match contradicted by current ORCID evidence is flagged, not dropped', () => {
    const out = DeduplicationService.partitionConflicts(
      [{
        name: 'Contradicted Low Trust',
        affiliation: 'Massachusetts Institute of Technology',
        affiliationSource: 'openalex_current',
        contactEnrichment: {
          orcidAffiliation: 'Stanford University',
        },
      }],
      ['MIT'],
    );

    expect(out.institutionConflicts).toHaveLength(0);
    expect(out.institutionFlagged).toHaveLength(1);
    expect(out.filtered).toHaveLength(1);
    expect(out.filtered[0]).toMatchObject({
      name: 'Contradicted Low Trust',
      hasInstitutionCOI: true,
      institutionCOIDetails: {
        dropDecision: 'flagged',
        corroborationReason: 'single_low_trust_affiliation_contradicted_by_current_affiliation',
        matchedAffiliationSource: 'openalex_current',
        contradictoryAffiliationSource: 'orcid_current',
      },
    });
  });

  test('single low-trust match without contradictory current evidence stays hard-dropped', () => {
    const out = DeduplicationService.partitionConflicts(
      [{
        name: 'Low Trust Only',
        affiliation: 'Massachusetts Institute of Technology',
        affiliationSource: 'pubmed_recency',
      }],
      ['MIT'],
    );

    expect(out.filtered).toHaveLength(0);
    expect(out.institutionFlagged).toHaveLength(0);
    expect(out.institutionConflicts[0].institutionCOIDetails).toMatchObject({
      dropDecision: 'dropped',
      corroborationReason: 'insufficient_contradictory_current_evidence',
      matchedAffiliationSource: 'pubmed_recency',
    });
  });
});
