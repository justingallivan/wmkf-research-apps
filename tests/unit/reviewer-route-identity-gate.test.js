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
  },
}));
jest.mock('../../lib/services/deduplication-service', () => ({
  DeduplicationService: { markInstitutionCOI: jest.fn((cands) => cands) },
}));
jest.mock('../../lib/services/contact-enrichment-service', () => ({
  ContactEnrichmentService: { enrichCandidates: jest.fn() },
}));

const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
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
  beforeEach(() => jest.clearAllMocks());

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

  test('no verdict (resolver absent) → fail-open persist, no decision/clear', async () => {
    await run(null);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('scholarSkipped fallback (no verdict) → Scholar fields nulled, ORCID kept, no decision/clear', async () => {
    const ce = enrichmentFor(null);                                  // identity absent
    ce.tierResults = { scholar_profile: { skipped: 'name_mismatch' } };
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
    reviewerSuggestionAdapter.findByRequest.mockResolvedValue([{
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
