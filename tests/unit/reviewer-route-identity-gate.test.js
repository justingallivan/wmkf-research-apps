/**
 * @jest-environment node
 *
 * Phase 2 post-impl (Codex round-2 MUST-FIX): the two ROUTE-OWNED write paths —
 * /api/reviewer-finder/save-candidates and /api/workbench/enrich-recommended —
 * each gate identity-bearing persistence on the resolver verdict and CLEAR stale
 * resolver-sourced fields on a below-`probable` downgrade. The email-keyed
 * saveToDatabase side path was already covered (save-to-database-identity-gate);
 * these two route handlers had no coverage for the downgrade branch, and a silent
 * regression would leave a wrong/stale ORCID/Scholar on the wmkf_potentialreviewer
 * person row (data-quality corruption). These tests drive each handler and assert
 * the block-and-clear behavior against mocked adapters.
 */

// ── shared adapter / infra mocks ──────────────────────────────────────────────
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 'P1', session: { user: { dynamicsSystemuserId: 'SYS-1' } } })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: {} }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  upsertByEmail: jest.fn(async () => ({ id: 'PID-1' })),
  getById: jest.fn(async () => ({ wmkf_primaryaffiliation: 'MIT' })),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(async () => ({ id: 'PID-1' })),
  writeIdentityDecision: jest.fn(async () => undefined),
  clearIdentityFields: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  upsert: jest.fn(async () => ({ id: 'S1' })),
  findByRequest: jest.fn(async () => []),
  findApplicantRecommendedByRequest: jest.fn(async () => []),
  setMatchReason: jest.fn(async () => undefined),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
}));

// ── enrich-recommended pipeline mocks (so the test reaches the writeback gate) ──
jest.mock('../../shared/api/middleware/rateLimiter', () => ({ nextRateLimiter: () => (async () => true) }));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: async () => ({}) }));
jest.mock('../../lib/services/claude-reviewer-service', () => ({ ClaudeReviewerService: { analyzeProposal: jest.fn() } }));
jest.mock('../../lib/services/discovery-service', () => ({
  DiscoveryService: {
    verifyClaudeSuggestions: jest.fn(async (sugs) => ({ verified: sugs.map((s) => ({ ...s, verified: true })), unverified: [] })),
    checkCoauthorshipsForCandidates: jest.fn(async (cands) => cands),
    pubMedVerificationContract: jest.fn(() => ({ enabled: true, reason: null })),
    isClearlyNonBiomedicalVerifierArea: jest.fn(() => false),
  },
}));
jest.mock('../../lib/services/deduplication-service', () => ({
  DeduplicationService: { markInstitutionCOI: jest.fn((cands) => cands) },
}));
jest.mock('../../lib/services/contact-enrichment-service', () => ({
  ContactEnrichmentService: { enrichCandidates: jest.fn() },
}));

const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const { RESOLVER_SOURCED_FIELDS } = require('../../lib/services/reviewer-identity-resolver');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.headers = {};
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  res.write = jest.fn();
  res.end = jest.fn();
  return res;
}

const enrichmentFor = (identity) => ({
  email: 'x@mit.edu', emailSource: 'orcid',
  orcidId: '0000-0001', orcidUrl: 'https://orcid.org/0000-0001',
  googleScholarId: 'ABC', googleScholarUrl: 'https://scholar.google.com/citations?user=ABC',
  hIndex: 40, i10Index: 30, totalCitations: 9000,
  tierResults: {}, identity,
});

// ── /api/reviewer-finder/save-candidates ──────────────────────────────────────
describe('save-candidates route — identity gate + clear-on-downgrade', () => {
  let handler;
  beforeAll(() => { handler = require('../../pages/api/reviewer-finder/save-candidates').default; });
  beforeEach(() => {
    jest.clearAllMocks();
    reviewerSuggestionAdapter.upsert.mockResolvedValue({ id: 'S1' });
  });

  const run = (identity) => {
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr X', contactEnrichment: enrichmentFor(identity) }] } };
    const res = mockRes();
    return handler(req, res).then(() => res);
  };

  test('unresolved verdict → ORCID/Scholar nulled, decision written, stale fields CLEARED', async () => {
    await run({ status: 'unresolved' });
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBeNull();
    expect(payload.orcidUrl).toBeNull();
    expect(payload.googleScholarId).toBeNull();
    expect(payload.googleScholarUrl).toBeNull();
    expect(payload.hIndex).toBeNull();
    expect(payload.totalCitations).toBeNull();
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'unresolved' }), expect.any(Object));
    expect(researcherAdapter.clearIdentityFields).toHaveBeenCalledWith('PID-1', RESOLVER_SOURCED_FIELDS, expect.any(Object));
  });

  test('probable verdict → ORCID/Scholar persisted, NO clear', async () => {
    await run({ status: 'probable' });
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(payload.googleScholarId).toBe('ABC');
    expect(payload.hIndex).toBe(40);
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'probable' }), expect.any(Object));
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('0-100 relevance scores are passed to suggestion upsert unchanged', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [
          { name: 'Dr Forty One', relevanceScore: 41 },
          { name: 'Dr Eighty Seven', relevanceScore: 87 },
        ],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(reviewerSuggestionAdapter.upsert.mock.calls[0][0].relevanceScore).toBe(41);
    expect(reviewerSuggestionAdapter.upsert.mock.calls[1][0].relevanceScore).toBe(87);
  });

  test('no verdict (resolver absent) → fail-open persist, no decision/clear', async () => {
    await run(null);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('openalex_author skipped fallback (no verdict) → Scholar fields nulled, ORCID kept, no decision/clear', async () => {
    const ce = enrichmentFor(null);                                  // identity absent
    ce.tierResults = { openalex_author: { skipped: 'identity_gate_failed' } };
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr X', contactEnrichment: ce }] } };
    const res = mockRes();
    await handler(req, res);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.googleScholarId).toBeNull();
    expect(payload.hIndex).toBeNull();
    expect(payload.orcid).toBe('0000-0001');                          // ORCID NOT blocked (blockByIdentity false)
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('explicit contact persist flags false → confirmed identity still saves no sendable contact fields', async () => {
    const ce = {
      ...enrichmentFor({ status: 'confirmed' }),
      affiliation: 'Wrong Institution',
      website: 'https://wrong.example.edu',
      facultyPageUrl: 'https://wrong.example.edu/profile',
      emailPersistAllowed: false,
      websitePersistAllowed: false,
      affiliationPersistAllowed: false,
    };
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr X',
          email: 'x@mit.edu',
          affiliation: 'Wrong Institution',
          website: 'https://wrong.example.edu',
          facultyPageUrl: 'https://wrong.example.edu/profile',
          contactEnrichment: ce,
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0]).toEqual(expect.objectContaining({
      email: null,
      affiliation: null,
    }));
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.email).toBeNull();
    expect(payload.emailSource).toBeNull();
    expect(payload.affiliation).toBeNull();
    expect(payload.website).toBeNull();
    expect(payload.facultyPageUrl).toBeNull();
    expect(payload.orcid).toBe('0000-0001');
  });

  // S235 — a PI-named / cited candidate is SAVED even when identity is unresolved (the proposal
  // author vouched for this specific person), but ALL contact + identity-derived fields are
  // force-nulled at the boundary (Codex HIGH) — a selectable-but-unverified row can't carry a
  // wrong-person email/ORCID. System-discovered unresolved rows are still 422-rejected.
  test('PI-named row without resolver verdict ignores forged verified body claims and keeps only proposal-scoped reasoning', async () => {
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{
      name: 'Olga Smirnova', source: 'proposal_named',
      needsIdentification: true,
      verified: true, identityStatus: 'confirmed', verificationStatus: 'verified',
      email: 'maybe-namesake@example.edu', affiliation: 'Max-Born-Institute', website: 'https://example.edu',
      department: 'Plasma Physics',
      expertise: 'attosecond science',
      orcid: '0000-0002-9999-9999',
      reasoning: 'The PI named this reviewer in the proposal.',
      relevanceScore: 87,
      contactEnrichment: {
        email: 'maybe-namesake@example.edu', emailSource: 'serp_search',
        department: 'Laser Research',
        orcidId: '0000-0002-9999-9999',
        googleScholarId: 'NAMESAKE',
        hIndex: 25,
        totalCitations: 2500,
        emailPersistAllowed: true, websitePersistAllowed: true, affiliationPersistAllowed: true,
      },
    }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalled(); // the row IS saved (not rejected)
    const person = potentialReviewerAdapter.upsertByEmail.mock.calls[0][0];
    expect(person.email).toBeNull();
    expect(person.affiliation).toBeNull();
    expect(person.expertise).toBeNull();
    expect(person.whyChosen).toBe('The PI named this reviewer in the proposal.');
    const researcher = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(researcher.email).toBeNull();
    expect(researcher.orcid).toBeNull();
    expect(researcher.website).toBeNull();
    expect(researcher.facultyPageUrl).toBeNull();
    expect(researcher.googleScholarId).toBeNull();
    expect(researcher.department).toBeNull();
    expect(researcher.keywords).toBeNull();

    const suggestion = reviewerSuggestionAdapter.upsert.mock.calls[0][0];
    expect(suggestion.matchReason).toBe('The PI named this reviewer in the proposal.');
    expect(suggestion.relevanceScore).toBe(87);
    expect(suggestion.suggestionLabel).toBeNull();
  });

  test('a system-discovered (literature_retrieved) UNRESOLVED candidate is still 422-rejected', async () => {
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{
      name: 'Deferred Track-B', sources: ['openalex'], needsIdentification: true, identityStatus: 'unresolved',
    }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  });

  test('S240: a same-institution (hasInstitutionCOI) candidate is hard-rejected, not saved', async () => {
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{
      name: 'Same Institution PI-mate', identityStatus: 'confirmed', hasInstitutionCOI: true,
    }] } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ rejectedInstitutionCOI: 1 });
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  });

  test('S240: post-enrichment institution COI (contactEnrichment.coiRecomputed) is hard-rejected even if top-level flag absent', async () => {
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{
      name: 'Enriched Into COI', identityStatus: 'confirmed',
      contactEnrichment: { coiRecomputed: true, hasInstitutionCOI: true },
    }] } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  });

  test('all-failed non-identity save returns non-2xx with per-row errors', async () => {
    reviewerSuggestionAdapter.upsert.mockRejectedValueOnce(new Error('Dataverse range validation failed'));
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Range Bug', relevanceScore: 41 }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      savedCount: 0,
      totalRequested: 1,
      errors: [{ name: 'Range Bug', error: 'Dataverse range validation failed' }],
    });
  });

  test('partial-failure response includes failed candidate names and error text', async () => {
    reviewerSuggestionAdapter.upsert.mockImplementation(async ({ suggestionLabel }) => {
      if (suggestionLabel?.includes('Failing Candidate')) {
        throw new Error('Dataverse write failed');
      }
      return { id: 'S1' };
    });
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        proposalTitle: 'Proposal',
        candidates: [
          { name: 'Saved Candidate', relevanceScore: 41 },
          { name: 'Failing Candidate', relevanceScore: 87 },
        ],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      savedCount: 1,
      savedNames: ['Saved Candidate'],
      totalRequested: 2,
      errors: [{ name: 'Failing Candidate', error: 'Dataverse write failed' }],
    });
  });
});

// ── /api/workbench/enrich-recommended ─────────────────────────────────────────
describe('enrich-recommended route — identity gate + clear-on-downgrade', () => {
  const GUID = '11111111-1111-4111-8111-111111111111';
  let handler, reviewerSuggestionAdapter, ContactEnrichmentService;
  beforeAll(() => {
    handler = require('../../pages/api/workbench/enrich-recommended').default;
    reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
    ({ ContactEnrichmentService } = require('../../lib/services/contact-enrichment-service'));
  });
  beforeEach(() => {
    jest.clearAllMocks();
    // one applicant-recommended junction row pointing at PID-1
    reviewerSuggestionAdapter.findApplicantRecommendedByRequest.mockResolvedValue([{
      wmkf_applicantdisposition: 100000000,
      _wmkf_potentialreviewer_value: 'PID-1',
      _wmkf_potentialreviewer_value_formatted: 'Dr X',
      wmkf_appreviewersuggestionid: 'SUG-1',
    }]);
  });

  const run = (identity) => {
    ContactEnrichmentService.enrichCandidates.mockResolvedValue({
      enriched: [{ potentialReviewerId: 'PID-1', suggestionId: 'SUG-1', name: 'Dr X', contactEnrichment: enrichmentFor(identity) }],
    });
    const req = { method: 'POST', body: { requestId: GUID, analysisResult: { proposalInfo: { authorInstitution: 'Stanford', proposalAuthors: 'Dr PI' } } } };
    const res = mockRes();
    return handler(req, res).then(() => res);
  };

  test('unresolved verdict → ORCID/Scholar nulled in writeback, decision written, stale fields CLEARED', async () => {
    await run({ status: 'unresolved' });
    expect(researcherAdapter.upsertByPotentialReviewer).toHaveBeenCalled();
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBeNull();
    expect(payload.googleScholarId).toBeNull();
    expect(payload.hIndex).toBeNull();
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'unresolved' }), expect.any(Object));
    expect(researcherAdapter.clearIdentityFields).toHaveBeenCalledWith('PID-1', RESOLVER_SOURCED_FIELDS, expect.any(Object));
  });

  test('probable verdict → ORCID/Scholar persisted, decision written, NO clear', async () => {
    await run({ status: 'probable' });
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(payload.hIndex).toBe(40);
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'probable' }), expect.any(Object));
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  // Codex S221 Bug 1: the unconfirmed-match guard previously excluded
  // `verified === false` rows, so a PubMed-UNverified, no-affiliation candidate
  // took the normal write path and could leak a same-named stranger's
  // contact-enrichment data (website / faculty page / email) onto the person row.
  test('unverified + no-affiliation + below-probable → ALL match-derived fields withheld (no stranger leak)', async () => {
    ContactEnrichmentService.enrichCandidates.mockResolvedValue({
      enriched: [{
        potentialReviewerId: 'PID-1',
        suggestionId: 'SUG-1',
        name: 'Jordan Welles',
        verified: false,            // PubMed found nothing
        hadAffiliation: false,      // applicant gave no affiliation to disambiguate
        website: 'https://stranger-lab.edu',
        expertiseAreas: ['quantum optics'],
        email: 'welles@stranger.edu', // name-consistent → would have passed the email guard
        contactEnrichment: {
          email: 'welles@stranger.edu',
          facultyPageUrl: 'https://stranger.edu/welles',
          department: 'Physics',
          website: 'https://stranger-lab.edu',
          // A same-named STRANGER's identifiers the resolver considered but could
          // not confirm — must NOT be persisted onto this person (Codex S221).
          identity: {
            status: 'unresolved',
            anchors: [{ type: 'scholar', canonicalKey: 'scholar:STRANGER', sourceUrl: 'https://scholar.google.com/citations?user=STRANGER', verifier: 'serp' }],
            evidenceSummary: 'matched STRANGER on Google Scholar',
          },
          tierResults: {},
        },
      }],
    });
    const req = { method: 'POST', body: { requestId: GUID, analysisResult: { proposalInfo: { authorInstitution: 'Stanford', proposalAuthors: 'Dr PI' } } } };
    const res = mockRes();
    await handler(req, res);

    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.email).toBeNull();
    expect(payload.website).toBeNull();
    expect(payload.facultyPageUrl).toBeNull();
    expect(payload.department).toBeNull();
    expect(payload.affiliation).toBeNull();
    expect(payload.keywords).toBeNull();

    // Codex S221 Bug 1 residual: the resolver decision is still recorded (status),
    // but the stranger's anchors + evidence are stripped before persistence so
    // wmkf_identityverifiedanchorsjson can't leak their Scholar/ORCID URL.
    const decisionArg = researcherAdapter.writeIdentityDecision.mock.calls[0][1];
    expect(decisionArg.status).toBe('unresolved');
    expect(decisionArg.anchors).toEqual([]);
    expect(decisionArg.evidenceSummary).not.toMatch(/STRANGER/);
  });
});
