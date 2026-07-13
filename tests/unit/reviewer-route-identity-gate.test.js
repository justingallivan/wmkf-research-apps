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
  getByEmail: jest.fn(async () => null),
  setContactLink: jest.fn(async () => ({ action: 'link' })),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getInstitutionById: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  getById: jest.fn(async () => null),
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
  DeduplicationService: {
    markInstitutionCOI: jest.fn((cands) => cands),
    institutionCOIDecision: jest.fn(() => null),
  },
}));
jest.mock('../../lib/services/contact-enrichment-service', () => ({
  ContactEnrichmentService: { enrichCandidates: jest.fn() },
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  recordSurfaced: jest.fn(async () => 1),
  stampSuggestionAnchor: jest.fn(async () => ({ updated: 1 })),
  findIdentityConfirmation: jest.fn(async () => null),
}));
jest.mock('../../lib/services/reviewer-candidate-attestation', () => ({
  verifyAutomatedIdentityAttestation: jest.fn(async () => ({ valid: true, source: 'automated_resolver' })),
}));
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: jest.fn(async () => ({ outcome: 'none' })),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadReviewerRequestContext: jest.fn(async () => ({})),
  loadCoiContext: jest.fn(async () => ({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  })),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const contactAdapter = require('../../lib/dataverse/adapters/contact');
const accountAdapter = require('../../lib/dataverse/adapters/account');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const rosterStore = require('../../lib/services/reviewer-roster-store');
const { verifyAutomatedIdentityAttestation } = require('../../lib/services/reviewer-candidate-attestation');
const { lookupReviewerIdentity } = require('../../lib/services/reviewer-identity-lookup');
const NotificationService = require('../../lib/services/notification-service').default;
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
    rosterStore.stampSuggestionAnchor.mockResolvedValue({ updated: 1 });
    contactAdapter.getInstitutionById.mockResolvedValue(null);
    accountAdapter.getById.mockResolvedValue(null);
    lookupReviewerIdentity.mockResolvedValue({ outcome: 'none' });
    NotificationService.notify.mockResolvedValue({ id: 'alert-1' });
    verifyAutomatedIdentityAttestation.mockResolvedValue({ valid: true, source: 'automated_resolver' });
    rosterStore.findIdentityConfirmation.mockResolvedValue(null);
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
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'unresolved' }), expect.objectContaining({ identityOrigin: 'automated' }));
    expect(researcherAdapter.clearIdentityFields).toHaveBeenCalledWith('PID-1', RESOLVER_SOURCED_FIELDS, expect.objectContaining({ identityOrigin: 'automated' }));
  });

  test('probable verdict → ORCID/Scholar persisted, NO clear', async () => {
    await run({ status: 'probable' });
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(payload.googleScholarId).toBe('ABC');
    expect(payload.hIndex).toBe(40);
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'probable' }), expect.objectContaining({ identityOrigin: 'automated' }));
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

  test('stamps the roster row with suggestion/person ids after save using the candidate name key', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{ name: 'Dr. Anchor Row', contactEnrichment: enrichmentFor({ status: 'probable' }) }],
      },
    };
    const res = mockRes();
    potentialReviewerAdapter.upsertByEmail.mockResolvedValueOnce({ id: 'PID-ANCHOR' });
    reviewerSuggestionAdapter.upsert.mockResolvedValueOnce({ id: 'SUG-ANCHOR' });

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(rosterStore.stampSuggestionAnchor).toHaveBeenCalledWith('REQ-1', 'Dr. Anchor Row', {
      suggestionId: 'SUG-ANCHOR',
      potentialReviewerId: 'PID-ANCHOR',
    });
  });

  test('validated referred seed anchor reuses the existing potential reviewer instead of email-upserting', async () => {
    potentialReviewerAdapter.getById.mockResolvedValueOnce({
      wmkf_potentialreviewersid: 'PID-SEED',
      wmkf_emailaddress: 'seed@example.edu',
      _wmkf_contact_value: 'CONTACT-SEED',
    });
    lookupReviewerIdentity.mockResolvedValueOnce({
      outcome: 'confident',
      match: {
        reviewerId: 'PID-SEED',
        contactId: 'CONTACT-SEED',
        matchKey: 'email',
        nameConsistent: true,
        context: { email: 'seed@example.edu' },
      },
    });
    reviewerSuggestionAdapter.upsert.mockResolvedValueOnce({ id: 'SUG-SEED' });

    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Seed Existing',
          email: 'seed@example.edu',
          source: 'referred',
          referredBy: 'Dr. Abby Doyle',
          reasoning: 'Referred by Dr. Abby Doyle.',
          seedResolvedPotentialReviewerId: 'PID-SEED',
          seedResolvedContactId: 'CONTACT-SEED',
          provenance: { kind: 'referred', seedRole: 'referred_by', sources: [], groundingWorkIds: [], referredBy: 'Dr. Abby Doyle' },
        }],
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(researcherAdapter.upsertByPotentialReviewer.mock.calls[0][0]).toBe('PID-SEED');
    expect(reviewerSuggestionAdapter.upsert.mock.calls[0][0]).toEqual(expect.objectContaining({
      potentialReviewerId: 'PID-SEED',
      matchReason: 'Referred by Dr. Abby Doyle.',
    }));
    expect(rosterStore.stampSuggestionAnchor).toHaveBeenCalledWith('REQ-1', 'Seed Existing', {
      suggestionId: 'SUG-SEED',
      potentialReviewerId: 'PID-SEED',
    });
  });

  test('roster anchor stamp failure is non-fatal after Dataverse save succeeds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    rosterStore.stampSuggestionAnchor.mockRejectedValueOnce(new Error('postgres down'));
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{ name: 'Dr. Non Fatal', contactEnrichment: enrichmentFor({ status: 'probable' }) }],
      },
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.savedCount).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      '[save-candidates] roster suggestion anchor stamp failed (non-fatal):',
      'postgres down',
    );
    warn.mockRestore();
  });

  test('institution-COI flagged rows are rejected at the save gate', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr Institution COI',
          email: 'coi@example.edu',
          hasInstitutionCOI: true,
          institutionCOIDetails: {
            piInstitution: 'MIT',
            reviewerInstitution: 'MIT',
            dropDecision: 'flagged',
          },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      savedCount: 0,
      rejectedInstitutionCOI: 1,
      errors: [{ name: 'Dr Institution COI', code: 'institution_coi' }],
    });
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  });

  test('no verdict (resolver absent) → fail-open persist, no decision/clear', async () => {
    await run(null);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('confident ORCID contact match → links the potential reviewer and does not notify', async () => {
    lookupReviewerIdentity.mockResolvedValueOnce({
      outcome: 'confident',
      match: { reviewerId: null, contactId: 'CONTACT-ORCID', matchKey: 'orcid', nameConsistent: true, context: {} },
    });
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr ORCID', email: 'orcid@example.edu', orcid: '0000-0002-1825-0097' }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(lookupReviewerIdentity).toHaveBeenCalledWith({
      name: 'Dr ORCID',
      email: 'orcid@example.edu',
      orcid: '0000-0002-1825-0097',
    });
    expect(potentialReviewerAdapter.setContactLink).toHaveBeenCalledWith('PID-1', 'CONTACT-ORCID', { actingUserSystemId: 'SYS-1' });
    expect(NotificationService.notify).not.toHaveBeenCalled();
  });

  test('confident email contact match → links the potential reviewer and does not notify', async () => {
    lookupReviewerIdentity.mockResolvedValueOnce({
      outcome: 'confident',
      match: { reviewerId: null, contactId: 'CONTACT-EMAIL', matchKey: 'email', nameConsistent: true, context: {} },
    });
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr Email', email: 'email@example.edu' }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.setContactLink).toHaveBeenCalledWith('PID-1', 'CONTACT-EMAIL', { actingUserSystemId: 'SYS-1' });
    expect(NotificationService.notify).not.toHaveBeenCalled();
  });

  test('name-only candidates outcome → saves unlinked and alerts staff review', async () => {
    const candidates = [{ source: 'reviewer', reviewerId: 'PID-EXISTING', contactId: null, matchKey: 'name', context: { name: 'Dr Name' } }];
    lookupReviewerIdentity.mockResolvedValueOnce({ outcome: 'candidates', candidates });
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr Name' }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reviewer_contact_match_needs_review',
      severity: 'warning',
      category: 'reviewers',
      autoResolveKey: 'reviewer-contact-match:PID-1:REQ-1',
      metadata: expect.objectContaining({
        requestId: 'REQ-1',
        potentialReviewerId: 'PID-1',
        candidateName: 'Dr Name',
        lookupOutcome: 'candidates',
        candidates,
        policyDecision: 'save_unlinked_staff_review',
      }),
    }));
  });

  test('conflict outcome → saves unlinked and alerts with conflict reason/details', async () => {
    const details = { emailContactId: 'C-EMAIL', orcidContactId: 'C-ORCID' };
    lookupReviewerIdentity.mockResolvedValueOnce({ outcome: 'conflict', reason: 'orcid_email_split', details });
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr Split', email: 'split@example.edu', orcid: '0000-0002-1825-0097' }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reviewer_contact_match_needs_review',
      message: expect.stringContaining('conflict (orcid_email_split)'),
      metadata: expect.objectContaining({
        lookupOutcome: 'conflict',
        conflictReason: 'orcid_email_split',
        conflictDetails: details,
        candidates: [],
      }),
    }));
  });

  test('lookup none → saves without link or alert', async () => {
    lookupReviewerIdentity.mockResolvedValueOnce({ outcome: 'none' });
    const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr None', email: 'none@example.edu' }] } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
    expect(NotificationService.notify).not.toHaveBeenCalled();
  });

  test('email lookup throws → rejects fail-closed before writes', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      lookupReviewerIdentity.mockRejectedValueOnce(new Error('lookup down'));
      const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr Lookup Down', email: 'down@example.edu' }] } };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(422);
      expect(res.body).toMatchObject({
        success: false,
        savedCount: 0,
        rejectedInstitutionCOI: 1,
        errors: [{
          name: 'Dr Lookup Down',
          code: 'institution_coi',
          serverRecomputed: true,
          decisionSource: 'reviewer_identity_lookup_failed',
        }],
      });
      expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
      expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
      expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
      expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
      expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('setContactLink linked-elsewhere conflict → still succeeds and keeps live link authoritative', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      lookupReviewerIdentity.mockResolvedValueOnce({
        outcome: 'confident',
        match: { reviewerId: null, contactId: 'CONTACT-EMAIL', matchKey: 'email', nameConsistent: true, context: {} },
      });
      potentialReviewerAdapter.setContactLink.mockRejectedValueOnce(Object.assign(new Error('linked'), {
        code: 'reviewer_linked_elsewhere',
        details: { existingContactId: 'CONTACT-LIVE' },
      }));
      const req = { method: 'POST', body: { requestId: 'REQ-1', candidates: [{ name: 'Dr Race', email: 'race@example.edu' }] } };
      const res = mockRes();
      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.savedCount).toBe(1);
      expect(res.body.errors).toBeUndefined();
      expect(potentialReviewerAdapter.setContactLink).toHaveBeenCalledWith('PID-1', 'CONTACT-EMAIL', { actingUserSystemId: 'SYS-1' });
    } finally {
      warn.mockRestore();
    }
  });

  test('partial batch still preserves saved rows when one later Dataverse write fails', async () => {
    lookupReviewerIdentity
      .mockResolvedValueOnce({
        outcome: 'confident',
        match: { reviewerId: null, contactId: 'CONTACT-SAVED', matchKey: 'email', nameConsistent: true, context: {} },
      })
      .mockResolvedValueOnce({ outcome: 'none' });
    reviewerSuggestionAdapter.upsert.mockImplementation(async ({ suggestionLabel }) => {
      if (suggestionLabel?.includes('Failing Candidate')) throw new Error('Dataverse write failed');
      return { id: 'S1' };
    });
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        proposalTitle: 'Proposal',
        candidates: [
          { name: 'Saved Candidate', email: 'saved@example.edu', relevanceScore: 41 },
          { name: 'Failing Candidate', email: 'fail@example.edu', relevanceScore: 87 },
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
      errors: [{ name: 'Failing Candidate', error: 'Dataverse write failed' }],
    });
    expect(potentialReviewerAdapter.setContactLink).toHaveBeenCalledWith('PID-1', 'CONTACT-SAVED', { actingUserSystemId: 'SYS-1' });
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

  // ── PD identity override (pdIdentityConfirmed) ──────────────────────────────
  const pdConfirmedReq = (extra = {}) => ({
    method: 'POST',
    body: {
      requestId: 'REQ-1',
      candidates: [{
        name: 'Dr Real Person',
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'confirm-1',
        needsIdentification: true,                 // would normally hard-reject
        email: 'correct@uni.edu', emailSource: 'manual', emailPersistAllowed: true,
        website: 'https://correct.uni.edu/faculty', websiteSource: 'manual', websitePersistAllowed: true,
        affiliation: 'Right University',
        contactEnrichment: enrichmentFor({ status: 'unresolved' }), // wrong ORCID/metrics present
        ...extra,
      }],
    },
  });

  test('bare client pdIdentityConfirmed flag is rejected before any write', async () => {
    const res = mockRes();
    const req = pdConfirmedReq({ pdIdentityConfirmationId: undefined });
    await handler(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ rejectedInvalid: 1 });
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  });

  test('mismatched server confirmation is rejected before any write', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'other@uni.edu',
      website: 'https://correct.uni.edu/faculty', affiliation: 'Right University',
    });
    const res = mockRes();
    await handler(pdConfirmedReq(), res);
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ rejectedInvalid: 1 });
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  });

  test('staff confirmation read failure fails closed before any write', async () => {
    rosterStore.findIdentityConfirmation.mockRejectedValueOnce(new Error('postgres unavailable'));
    const res = mockRes();
    await handler(pdConfirmedReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ success: false, savedCount: 0 });
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
    expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  });

  test('PD override: unresolved row is SAVED (not hard-rejected) with the manual email', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed',
      normalizedName: 'real person',
      email: 'correct@uni.edu',
      website: 'https://correct.uni.edu/faculty',
      affiliation: 'Right University',
    });
    const res = mockRes();
    await handler(pdConfirmedReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.savedCount).toBe(1);
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBe('correct@uni.edu');
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.email).toBe('correct@uni.edu');
    expect(payload.emailSource).toBe('manual');
  });

  test('PD override: contact lookup receives manual email but no ORCID', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'pd@example.edu',
      website: 'https://correct.uni.edu/faculty', affiliation: 'Right University',
    });
    const res = mockRes();
    await handler(pdConfirmedReq({ email: 'pd@example.edu', orcid: '0000-0002-1825-0097' }), res);

    expect(res.statusCode).toBe(200);
    expect(lookupReviewerIdentity).toHaveBeenCalledWith({
      name: 'Dr Real Person',
      email: 'pd@example.edu',
      orcid: null,
    });
  });

  test('PD override: emailSource is FORCED manual server-side (forged source ignored)', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'correct@uni.edu',
      website: 'https://correct.uni.edu/faculty', affiliation: 'Right University',
    });
    const res = mockRes();
    // A forged/stale payload claims a high-confidence source — must be overridden.
    await handler(pdConfirmedReq({ emailSource: 'orcid' }), res);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.email).toBe('correct@uni.edu');
    expect(payload.emailSource).toBe('manual');
  });

  test('PD override: auto-fetched ORCID / Scholar / metrics are NULLED (never blessed)', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'correct@uni.edu',
      website: 'https://correct.uni.edu/faculty', affiliation: 'Right University',
    });
    const res = mockRes();
    await handler(pdConfirmedReq(), res);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBeNull();
    expect(payload.orcidUrl).toBeNull();
    expect(payload.googleScholarId).toBeNull();
    expect(payload.googleScholarUrl).toBeNull();
    expect(payload.hIndex).toBeNull();
    expect(payload.totalCitations).toBeNull();
    // The resolver verdict is NOT written as a decision for a manual confirm.
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('PD override: a "[Identity confirmed by PD]" audit note is stamped on the suggestion', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'correct@uni.edu',
      website: 'https://correct.uni.edu/faculty', affiliation: 'Right University',
    });
    const res = mockRes();
    await handler(pdConfirmedReq(), res);
    expect(reviewerSuggestionAdapter.upsert.mock.calls[0][0].matchReason).toMatch(/Identity confirmed by PD/);
  });

  test('PD override: blanked website does NOT fall back to the wrong enrichment website', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'correct@uni.edu',
      website: '', affiliation: 'Right University',
    });
    const res = mockRes();
    // PD corrected the email but cleared the (wrong) website entirely.
    await handler(pdConfirmedReq({ website: '', websiteSource: 'manual', websitePersistAllowed: false }), res);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.website).toBeNull();           // NOT enrichment's https://...mit.edu
    expect(payload.email).toBe('correct@uni.edu'); // the kept correction still persists
  });

  test('PD override does NOT waive institution-COI (still hard-rejected)', async () => {
    rosterStore.findIdentityConfirmation.mockResolvedValueOnce({
      source: 'staff_confirmed', normalizedName: 'real person', email: 'correct@uni.edu',
      website: 'https://correct.uni.edu/faculty', affiliation: 'Right University',
    });
    const res = mockRes();
    await handler(pdConfirmedReq({ hasInstitutionCOI: true }), res);
    expect(res.statusCode).toBe(422);
    expect(res.body.savedCount).toBe(0);
    expect(res.body.rejectedInstitutionCOI).toBe(1);
    expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  });

  test('client confirmed status without a valid server receipt cannot persist automated identity fields', async () => {
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({ valid: false, reason: 'no_token' });
    const res = await run({ status: 'confirmed' });
    expect(res.statusCode).toBe(200);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBeNull();
    expect(payload.googleScholarId).toBeNull();
    expect(payload.hIndex).toBeNull();
    expect(researcherAdapter.writeIdentityDecision).not.toHaveBeenCalled();
    expect(researcherAdapter.clearIdentityFields).toHaveBeenCalled();
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

  test('document facultyPageUrl is nulled before save-candidates persistence', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr X',
          contactEnrichment: {
            ...enrichmentFor({ status: 'confirmed' }),
            facultyPageUrl: 'https://mit.edu/faculty/example-cv.pdf',
            websitePersistAllowed: true,
          },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.facultyPageUrl).toBeNull();
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

  // ── S317: Tier-0 affiliation-email rescue ──────────────────────────────────
  // When enrichment ran but did not capture an email (partial/timed-out run) and the
  // affiliation string embeds the reviewer's own address, save extracts it as
  // `affiliation`-sourced instead of orphaning it in the affiliation field.
  test('rescues an email embedded in the affiliation when none was captured', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Christopher Walsh',
          affiliation: "Division of Genetics and Genomics, Boston Children's Hospital, Boston, MA, USA. christopher.walsh@childrens.harvard.edu.",
          // enrichment ran but produced no email (mirrors the live req-1003020 rows)
          contactEnrichment: { emailPersistAllowed: false, affiliationPersistAllowed: true },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.savedCount).toBe(1);
    // Email is extracted from the affiliation and persisted...
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBe('christopher.walsh@childrens.harvard.edu');
    // ...stamped as affiliation-sourced (trusted; not 'manual'/paid-search).
    const researcherPayload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(researcherPayload.email).toBe('christopher.walsh@childrens.harvard.edu');
    expect(researcherPayload.emailSource).toBe('affiliation');
    // The identity lookup also sees the rescued email.
    expect(lookupReviewerIdentity).toHaveBeenCalledWith(expect.objectContaining({ email: 'christopher.walsh@childrens.harvard.edu' }));
  });

  test('does NOT override an email the normal path already captured', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr Both',
          email: 'primary@uni.edu',
          emailSource: 'pubmed',
          affiliation: 'Dept of Things, Uni. other@uni.edu.',
          contactEnrichment: { emailPersistAllowed: true, affiliationPersistAllowed: true },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBe('primary@uni.edu');
    expect(researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1].emailSource).toBe('pubmed');
  });

  test('no rescue when the affiliation has no email (email stays null)', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr NoEmail',
          affiliation: 'Department of Neuroscience, Stanford University, CA, USA',
          contactEnrichment: { emailPersistAllowed: false, affiliationPersistAllowed: true },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBeNull();
    expect(researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1].emailSource).toBeNull();
  });

  test('rejects an anti-scrape MUNGED email even when enrichment blessed it', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr Munged',
          email: 'pollina@nospam.wustl.edu',
          emailSource: 'serp_search',
          contactEnrichment: { emailPersistAllowed: true, affiliationPersistAllowed: true },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.savedCount).toBe(1); // row still saves, just without the junk email
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBeNull();
    expect(researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1].emailSource).toBeNull();
  });

  test('search_contested email persists only via explicit emailPersistAllowed flag', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr Contested',
          email: 'maybe@plausible.edu',
          emailSource: 'search_contested',
          contactEnrichment: {
            email: 'maybe@plausible.edu',
            emailSource: 'search_contested',
            emailPersistAllowed: true,
            affiliationPersistAllowed: true,
          },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBe('maybe@plausible.edu');
    expect(researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1]).toMatchObject({
      email: 'maybe@plausible.edu',
      emailSource: 'search_contested',
    });
  });

  test('search_contested source is default-denied when emailPersistAllowed is missing', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: 'REQ-1',
        candidates: [{
          name: 'Dr Contested Default Deny',
          email: 'maybe@plausible.edu',
          emailSource: 'search_contested',
          contactEnrichment: { affiliationPersistAllowed: true },
        }],
      },
    };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(potentialReviewerAdapter.upsertByEmail.mock.calls[0][0].email).toBeNull();
    expect(researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1].emailSource).toBeNull();
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

  const run = (identity, extraBody = {}) => {
    ContactEnrichmentService.enrichCandidates.mockResolvedValue({
      enriched: [{ potentialReviewerId: 'PID-1', suggestionId: 'SUG-1', name: 'Dr X', contactEnrichment: enrichmentFor(identity) }],
    });
    const req = { method: 'POST', body: { requestId: GUID, analysisResult: { proposalInfo: { authorInstitution: 'Stanford', proposalAuthors: 'Dr PI' } }, ...extraBody } };
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
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'unresolved' }), expect.objectContaining({ identityOrigin: 'automated' }));
    expect(researcherAdapter.clearIdentityFields).toHaveBeenCalledWith('PID-1', RESOLVER_SOURCED_FIELDS, expect.objectContaining({ identityOrigin: 'automated' }));
  });

  test('probable verdict → ORCID/Scholar persisted, decision written, NO clear', async () => {
    await run({ status: 'probable' });
    const payload = researcherAdapter.upsertByPotentialReviewer.mock.calls[0][1];
    expect(payload.orcid).toBe('0000-0001');
    expect(payload.hIndex).toBe(40);
    expect(researcherAdapter.writeIdentityDecision).toHaveBeenCalledWith('PID-1', expect.objectContaining({ status: 'probable' }), expect.objectContaining({ identityOrigin: 'automated' }));
    expect(researcherAdapter.clearIdentityFields).not.toHaveBeenCalled();
  });

  test('records enriched applicant candidates to roster before complete event', async () => {
    const res = await run({ status: 'probable' }, { proposalKey: 'Library::Folder::Proposal.pdf' });

    expect(rosterStore.recordSurfaced).toHaveBeenCalledWith(GUID, [
      expect.objectContaining({
        name: 'Dr X',
        suggestionId: 'SUG-1',
        enrichedProposalKey: 'Library::Folder::Proposal.pdf',
        isApplicantRecommended: true,
      }),
    ]);
    const completeCall = res.write.mock.calls.find((call) => call[0] === 'event: complete\n');
    expect(completeCall).toBeTruthy();
    expect(rosterStore.recordSurfaced.mock.invocationCallOrder[0])
      .toBeLessThan(res.write.mock.invocationCallOrder[res.write.mock.calls.indexOf(completeCall)]);
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
