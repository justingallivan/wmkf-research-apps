/**
 * @jest-environment node
 */

jest.mock('../../lib/services/pubmed-service', () => ({
  PubMedService: {
    search: jest.fn(),
  },
}));

jest.mock('../../lib/services/reviewer-identity-evidence', () => ({
  ReviewerIdentityEvidence: {
    evaluateSuggestion: jest.fn(),
  },
}));

const { DiscoveryService } = require('../../lib/services/discovery-service');
const { PubMedService } = require('../../lib/services/pubmed-service');
const { ReviewerIdentityEvidence } = require('../../lib/services/reviewer-identity-evidence');

// Default to a UNIQUE title per pmid: distinct real papers have distinct titles, and the
// discovery pipeline now title-dedups a candidate's article list (collapses a preprint +
// published version of the SAME paper) before the MIN_PUBLICATIONS gate. A shared default
// title would (correctly) collapse to one work and fall below the threshold.
const article = (pmid, authorName, title = `Relevant publication ${pmid}`) => ({
  pmid,
  title,
  year: new Date().getFullYear(),
  journal: 'Journal of Tests',
  abstract: '',
  authors: [{
    name: authorName,
    affiliation: 'University of North Carolina, Chapel Hill, NC',
  }],
});

const runVerification = (suggestion, articlesByQuery, options = {}) => {
  PubMedService.search.mockImplementation(async (query) => {
    for (const [needle, articles] of Object.entries(articlesByQuery)) {
      if (query.includes(needle)) return articles;
    }
    return [];
  });
  return DiscoveryService.verifyClaudeSuggestions([suggestion], () => {}, options);
};

describe('DiscoveryService.verifyClaudeSuggestions identity states', () => {
  let setTimeoutSpy;
  let originalMinPublications;

  beforeEach(() => {
    jest.clearAllMocks();
    ReviewerIdentityEvidence.evaluateSuggestion.mockResolvedValue({
      status: 'abstain',
      resolverStatus: 'unresolved',
      orcid: null,
      selectedRecord: null,
      anchors: [],
      sources: { openalex: 'error', orcid: 'not_run' },
      reason: 'openalex_outage',
      identity: { status: 'unresolved', anchors: [] },
    });
    originalMinPublications = DiscoveryService.MIN_PUBLICATIONS;
    DiscoveryService.MIN_PUBLICATIONS = 3;
    setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((cb) => {
      cb();
      return 0;
    });
  });

  afterEach(() => {
    DiscoveryService.MIN_PUBLICATIONS = originalMinPublications;
    setTimeoutSpy.mockRestore();
  });

  test('fabricated Alfred Laederach does not verify against Alain Laederach initial-only PubMed hits', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      { name: 'Dr. Alfred Laederach', expertiseAreas: [] },
      { 'A Laederach[Author]': alainArticles },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      // S266: the unverified honorific is stripped at ingestion
      // (normalizeSuggestionSource); the forename "Alfred" is untouched, so the
      // Alain-vs-Alfred non-match still holds.
      name: 'Alfred Laederach',
      verified: false,
      verificationStatus: 'unresolved',
      identityStatus: 'unresolved',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
      },
    });
    expect(result.unverified[0].reason).toMatch(/forename|initial/i);
  });

  test('correct full-name match is verified', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      { name: 'Alain Laederach', expertiseAreas: [] },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      name: 'Alain Laederach',
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
      },
    });
    expect(result.verified[0].nameEvidence.hasFullForenameMatch).toBe(true);
  });

  test('preprint + published duplicate does NOT satisfy the MIN_PUBLICATIONS gate (3 rows / 2 distinct works)', async () => {
    // Two of the three rows are the SAME paper (a bioRxiv preprint + the published version),
    // which title-dedup collapses to one. After dedup there are only 2 distinct works, below
    // MIN_PUBLICATIONS=3 — so the candidate must NOT verify on duplicate rows (Codex post-impl
    // HIGH: the dedup runs BEFORE the eligibility gate). Contrast with the 3-distinct-title
    // 'correct full-name match is verified' case above, which DOES verify.
    const samePaperTitle = 'Attosecond tunneling dynamics in strong fields';
    const articles = [
      article('1', 'Alain Laederach', samePaperTitle), // published (default journal)
      { ...article('2', 'Alain Laederach', samePaperTitle), journal: 'bioRxiv' }, // preprint of the SAME paper
      article('3', 'Alain Laederach'), // a genuinely distinct paper (unique default title)
    ];

    const result = await runVerification(
      { name: 'Alain Laederach', expertiseAreas: [] },
      { 'Alain Laederach[Author]': articles },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({ name: 'Alain Laederach', verified: false });
  });

  test('initial-only suggestion with no corroboration stays unresolved', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      { name: 'A Laederach', expertiseAreas: [] },
      { 'A Laederach[Author]': alainArticles },
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      verified: false,
      verificationStatus: 'unresolved',
      identityStatus: 'unresolved',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['pubmed'],
        seedRole: 'query_seed',
      },
    });
    expect(result.unverified[0].nameEvidence).toMatchObject({
      hasFullForenameMatch: false,
      hasInitialOnlyMatch: true,
    });
  });

  test('ungrounded parametric suggestion is marked barred_parametric', async () => {
    const result = await runVerification(
      { name: 'Imaginary Reviewer', expertiseAreas: [] },
      {},
    );

    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      verified: false,
      provenance: {
        kind: 'barred_parametric',
        sources: [],
        seedRole: 'query_seed',
      },
    });
  });

  test('PubMed-off verification runs OpenAlex/ORCID spine and can verify', async () => {
    ReviewerIdentityEvidence.evaluateSuggestion.mockResolvedValueOnce({
      status: 'confirmed',
      resolverStatus: 'confirmed',
      orcid: '0000-0002-1825-0097',
      selectedRecord: {
        openAlexId: 'https://openalex.org/A123',
        lastKnownInstitution: 'Griffith University',
      },
      anchors: [{ type: 'affiliation_match', weight: 'strong' }],
      sources: { openalex: 'ok', orcid: 'ok' },
      reason: 'confirmed by OpenAlex/ORCID',
      identity: { status: 'confirmed', anchors: [] },
    });

    const result = await runVerification(
      { name: 'Robert Sang', expertiseAreas: ['attosecond physics'] },
      { 'Robert Sang[Author]': [article('1', 'Robert Sang'), article('2', 'Robert Sang'), article('3', 'Robert Sang')] },
      { searchPubmed: false, proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(PubMedService.search).not.toHaveBeenCalled();
    expect(ReviewerIdentityEvidence.evaluateSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Robert Sang' }),
      expect.objectContaining({ proposalInfo: { primaryResearchArea: 'Physics' } }),
    );
    expect(result.verified).toHaveLength(1);
    expect(result.unverified).toHaveLength(0);
    expect(result.verified[0]).toMatchObject({
      name: 'Robert Sang',
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'confirmed',
      verificationSource: 'orcid',
      orcid: '0000-0002-1825-0097',
      provenance: {
        kind: 'literature_retrieved',
        sources: ['openalex', 'orcid'],
        seedRole: 'query_seed',
      },
    });
  });

  test('spine-verified candidate carries ORCID employment history as affiliationHistory (former-institution COI)', async () => {
    // Codex S236 post-impl CHECK 4: deduplication-service scans former-institution
    // COI only when affiliationHistory is an array. The spine path must supply it
    // (from ORCID employments) or non-biomedical reviewers silently skip that check.
    ReviewerIdentityEvidence.evaluateSuggestion.mockResolvedValueOnce({
      status: 'confirmed',
      resolverStatus: 'confirmed',
      orcid: '0000-0002-1825-0097',
      selectedRecord: { openAlexId: 'https://openalex.org/A1', lastKnownInstitution: 'ETH Zurich' },
      orcidAffiliations: ['ETH Zurich', 'Johns Hopkins University'], // former: JHU
      anchors: [{ type: 'affiliation_match', weight: 'strong' }],
      sources: { openalex: 'ok', orcid: 'ok' },
      reason: 'confirmed',
      identity: { status: 'confirmed', anchors: [] },
    });

    const result = await runVerification(
      { name: 'Robert Sang', expertiseAreas: ['attosecond physics'] },
      { 'Robert Sang[Author]': [article('1', 'Robert Sang'), article('2', 'Robert Sang'), article('3', 'Robert Sang')] },
      { searchPubmed: false, proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(result.verified).toHaveLength(1);
    expect(Array.isArray(result.verified[0].affiliationHistory)).toBe(true);
    expect(result.verified[0].affiliationHistory).toEqual(['ETH Zurich', 'Johns Hopkins University']);
  });

  test('spine-verified candidate with no ORCID history falls back to current institution array', async () => {
    ReviewerIdentityEvidence.evaluateSuggestion.mockResolvedValueOnce({
      status: 'confirmed',
      resolverStatus: 'confirmed',
      orcid: '0000-0002-1825-0097',
      selectedRecord: { openAlexId: 'https://openalex.org/A1', lastKnownInstitution: 'ETH Zurich' },
      orcidAffiliations: [],
      anchors: [{ type: 'affiliation_match', weight: 'strong' }],
      sources: { openalex: 'ok', orcid: 'ok' },
      reason: 'confirmed',
      identity: { status: 'confirmed', anchors: [] },
    });

    const result = await runVerification(
      { name: 'Robert Sang', expertiseAreas: ['attosecond physics'] },
      { 'Robert Sang[Author]': [article('1', 'Robert Sang'), article('2', 'Robert Sang'), article('3', 'Robert Sang')] },
      { searchPubmed: false, proposalInfo: { primaryResearchArea: 'Physics' } },
    );

    expect(result.verified[0].affiliationHistory).toEqual(['ETH Zurich']);
  });

  test('proposal-named source maps to proposal_named provenance while References stays parametric', async () => {
    const skipped = await DiscoveryService.verifyClaudeSuggestions([
      { name: 'Dr. Proposal Named', source: 'Mentioned in proposal', expertiseAreas: [] },
      { name: 'Dr. Reference Label', source: 'References', expertiseAreas: [] },
    ], () => {}, { searchPubmed: false });

    expect(skipped.verified).toHaveLength(0);
    expect(skipped.unverified[0]).toMatchObject({
      source: 'proposal_named',
      provenance: {
        kind: 'proposal_named',
        sources: ['proposal_text'],
        seedRole: 'peer_or_competitor',
      },
    });
    expect(skipped.unverified[1]).toMatchObject({
      source: 'claude_suggestion',
      provenance: {
        kind: 'barred_parametric',
        sources: [],
        seedRole: 'query_seed',
      },
    });
  });

  // S236 Change 1: a clearly-non-biomedical (physics) proposal now routes Track-A
  // verification to the OpenAlex/ORCID spine even with PubMed ON — PubMed is
  // biomedical-only and cannot confirm physicists. This SUPERSEDES the old PubMed
  // cross-field namesake guard (evaluateCrossFieldNamesakeGuard) for physical/eng
  // proposals: the spine abstains on an unconfirmable identity rather than the
  // PubMed path verifying-then-demoting a biomedical namesake. The safety property
  // (a same-name biomedical namesake is not falsely verified) is preserved by the
  // spine's abstention.
  test('clearly-non-biomedical proposal routes Track-A verification to the spine, not PubMed', async () => {
    const result = await runVerification(
      { name: 'Robert Sang', expertiseAreas: ['attosecond physics', 'quantum tunneling'] },
      { 'Robert Sang[Author]': [article('1', 'Robert Sang'), article('2', 'Robert Sang'), article('3', 'Robert Sang')] },
      { proposalInfo: { primaryResearchArea: 'Physics' } }, // PubMed ON (searchPubmed not false)
    );

    // PubMed is NOT consulted for a physics proposal; the spine is.
    expect(PubMedService.search).not.toHaveBeenCalled();
    expect(ReviewerIdentityEvidence.evaluateSuggestion).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Robert Sang' }),
      expect.objectContaining({ proposalInfo: { primaryResearchArea: 'Physics' } }),
    );
    // Default spine mock abstains → the same-name namesake is NOT falsely verified.
    expect(result.verified).toHaveLength(0);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]).toMatchObject({
      name: 'Robert Sang',
      verified: false,
      identityStatus: 'unresolved',
    });
  });

  test('institution mismatch stays verified for a full-name match and sets advisory flag', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach'),
      article('2', 'Alain Laederach'),
      article('3', 'Alain Laederach'),
    ];

    const result = await runVerification(
      {
        name: 'Alain Laederach',
        suggestedInstitution: 'Salk Institute',
        expertiseAreas: [],
      },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      institutionMismatch: true,
    });
  });

  test('expertise mismatch stays verified for a full-name match and sets advisory flag', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach', 'Cell mechanics'),
      article('2', 'Alain Laederach', 'RNA structure'),
      article('3', 'Alain Laederach', 'Molecular folding'),
    ];

    const result = await runVerification(
      {
        name: 'Alain Laederach',
        expertiseAreas: ['photosynthetic coral bleaching'],
      },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      expertiseMismatch: true,
    });
  });

  test('institution and expertise mismatch both stay verified for a full-name match', async () => {
    const alainArticles = [
      article('1', 'Alain Laederach', 'Cell mechanics'),
      article('2', 'Alain Laederach', 'RNA structure'),
      article('3', 'Alain Laederach', 'Molecular folding'),
    ];

    const result = await runVerification(
      {
        name: 'Alain Laederach',
        suggestedInstitution: 'Salk Institute',
        expertiseAreas: ['photosynthetic coral bleaching'],
      },
      { 'Alain Laederach[Author]': alainArticles },
    );

    expect(result.unverified).toHaveLength(0);
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toMatchObject({
      verified: true,
      verificationStatus: 'verified',
      identityStatus: 'verified',
      institutionMismatch: true,
      expertiseMismatch: true,
    });
  });
});

describe('DiscoveryService.suggestionVerifierRouting (S236 Change 1)', () => {
  const route = (opts) => DiscoveryService.suggestionVerifierRouting(opts);

  test('biomedical proposal with PubMed on → pubmed', () => {
    expect(route({ proposalInfo: { primaryResearchArea: 'Cancer immunology' } }).verifier).toBe('pubmed');
  });

  test('clearly non-biomedical (physics) with PubMed on → spine', () => {
    expect(route({ proposalInfo: { primaryResearchArea: 'Physics' } }).verifier).toBe('spine');
  });

  test('ambiguous "Not specified" field with PubMed on → pubmed (conservative)', () => {
    expect(route({ proposalInfo: { primaryResearchArea: 'Not specified' } }).verifier).toBe('pubmed');
    expect(route({ proposalInfo: {} }).verifier).toBe('pubmed');
    expect(route({}).verifier).toBe('pubmed');
  });

  test('PubMed off → spine regardless of field (checkbox precedence)', () => {
    expect(route({ searchPubmed: false, proposalInfo: { primaryResearchArea: 'Cancer immunology' } }).verifier).toBe('spine');
  });
});

describe('DiscoveryService.pubMedVerificationContract is NOT field-aware (S236 E.2 guard)', () => {
  // The coauthorship-COI gate at discover.js reuses this contract. Field-aware
  // routing must NOT leak into it, or COI detection silently turns off for
  // non-biomedical proposals. This test fails if someone re-adds the field check.
  test('physics proposal with PubMed on stays enabled (so the COI gate still runs)', () => {
    const contract = DiscoveryService.pubMedVerificationContract({
      searchPubmed: true,
      proposalInfo: { primaryResearchArea: 'Physics' },
    });
    expect(contract.enabled).toBe(true);
  });

  test('only searchPubmed=false disables it', () => {
    expect(DiscoveryService.pubMedVerificationContract({ searchPubmed: false }).enabled).toBe(false);
  });
});
