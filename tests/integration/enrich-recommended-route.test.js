/**
 * @jest-environment node
 *
 * POST /api/workbench/enrich-recommended — SSE characterization written BEFORE
 * the Stage 4 series B extraction (Decision 1a: pin the FULL conditional event
 * vocabulary — names, payload keys, ordering, terminal sequences, empty
 * frames, mid-stream failure behavior — before moving logic).
 *
 * Vocabulary (current behavior):
 *   pre-stream JSON: 405 + Allow, auth short-circuit, rate-limit after auth,
 *     model-override warm BEFORE the 400 GUID check;
 *   progress {message} (+ pass-through payloads) — non-terminal, including
 *     per-candidate writeback failures;
 *   complete {recommended: []} — empty frames (no rows / no valid suggestions);
 *   complete {recommended: [card…]} — terminal happy;
 *   error {message} — terminal aborts (missing key/blob, short text, no
 *     authors/institution, pipeline throw); error {message, timeout:true} on
 *     deadline abort. Exactly one terminal event; res.end() always.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } })),
}));

const limiter = jest.fn(async () => true);
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => (...a) => limiter(...a),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const loadModelOverrides = jest.fn(async () => {});
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: (...a) => loadModelOverrides(...a),
}));

const findApplicantRecommendedByRequest = jest.fn();
const setMatchReason = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findApplicantRecommendedByRequest: (...a) => findApplicantRecommendedByRequest(...a),
  setMatchReason: (...a) => setMatchReason(...a),
}));

const getPersonById = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: (...a) => getPersonById(...a),
}));

const upsertByPotentialReviewer = jest.fn(async () => ({}));
const writeIdentityDecision = jest.fn(async () => {});
const clearIdentityFields = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: (...a) => upsertByPotentialReviewer(...a),
  writeIdentityDecision: (...a) => writeIdentityDecision(...a),
  clearIdentityFields: (...a) => clearIdentityFields(...a),
}));

const verifyClaudeSuggestions = jest.fn();
const checkCoauthorshipsForCandidates = jest.fn(async (c) => c);
jest.mock('../../lib/services/discovery-service', () => ({
  DiscoveryService: {
    pubMedVerificationContract: jest.fn(({ searchPubmed }) => ({ enabled: !!searchPubmed })),
    isClearlyNonBiomedicalVerifierArea: jest.fn(() => false),
    verifyClaudeSuggestions: (...a) => verifyClaudeSuggestions(...a),
    checkCoauthorshipsForCandidates: (...a) => checkCoauthorshipsForCandidates(...a),
    YEARS_LOOKBACK: 5,
  },
}));

jest.mock('../../lib/services/deduplication-service', () => ({
  DeduplicationService: { markInstitutionCOIResolved: jest.fn(async (c) => c) },
}));

const enrichCandidates = jest.fn();
jest.mock('../../lib/services/contact-enrichment-service', () => ({
  ContactEnrichmentService: { enrichCandidates: (...a) => enrichCandidates(...a) },
}));

const getWorksByAuthor = jest.fn(async () => ({ totalCount: 12 }));
jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: { getWorksByAuthor: (...a) => getWorksByAuthor(...a) },
}));

jest.mock('../../lib/services/claude-reviewer-service', () => ({
  ClaudeReviewerService: { analyzeProposal: jest.fn() },
}));

const resolveProposalPI = jest.fn(async () => null);
jest.mock('../../lib/services/proposal-pi-identity', () => ({
  resolveProposalPI: (...a) => resolveProposalPI(...a),
  appendPiName: jest.fn((names) => names || []),
  piInstitutions: jest.fn(() => []),
}));

jest.mock('../../lib/utils/proposal-authors', () => ({
  deriveProposalAuthorNames: jest.fn(() => []),
}));

jest.mock('../../lib/services/reviewer-identity-resolver', () => ({
  mayPersistIdentity: jest.fn((s) => s === 'confirmed' || s === 'probable'),
  RESOLVER_SOURCED_FIELDS: ['wmkf_orcid'],
}));

const backPropReviewerOrcidToContact = jest.fn(async () => {});
jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({
  backPropReviewerOrcidToContact: (...a) => backPropReviewerOrcidToContact(...a),
}));

const getReviewerTimeBudgetSeconds = jest.fn(async () => 600);
jest.mock('../../lib/services/reviewer-time-budget', () => ({
  getReviewerTimeBudgetSeconds: (...a) => getReviewerTimeBudgetSeconds(...a),
}));

jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadReviewerRequestContext: jest.fn(async () => ({})),
}));

jest.mock('../../shared/components/reviewers/reviewer-search-logic', () => ({
  pruneCandidateForRoster: jest.fn((c) => c),
}));

const recordSurfaced = jest.fn(async () => {});
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  recordSurfaced: (...a) => recordSurfaced(...a),
}));

jest.mock('../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn() }));
jest.mock('../../lib/utils/contact-parser', () => ({
  ContactParser: { isNameConsistentEmail: jest.fn(() => true) },
}));
jest.mock('../../lib/utils/name-normalization', () => ({ normalizeName: (n) => String(n).toLowerCase() }));

import handler from '../../pages/api/workbench/enrich-recommended';
import { requireAppAccess } from '../../lib/utils/auth';

const REQ = '11111111-1111-1111-1111-111111111111';
const PR = '22222222-2222-2222-2222-222222222222';
const SUG = '33333333-3333-3333-3333-333333333333';

function sseRes() {
  const res = {
    statusCode: 200, headers: {}, jsonBody: null, chunks: [], ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.jsonBody = b; return this; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end() { this.ended = true; },
  };
  res.events = () => {
    const raw = res.chunks.join('');
    const events = [];
    const re = /event: (.+)\ndata: (.+)\n\n/g;
    let m;
    while ((m = re.exec(raw)) !== null) events.push({ event: m[1], data: JSON.parse(m[2]) });
    return events;
  };
  return res;
}

const post = (body) => ({ method: 'POST', body });
const baseBody = (over = {}) => ({
  requestId: REQ,
  proposalKey: 'blob-key-1',
  analysisResult: { proposalInfo: { authorInstitution: 'PI University', proposalAuthors: 'Dr. PI', primaryResearchArea: 'Biology' } },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CLAUDE_API_KEY = 'test-key';
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } });
  limiter.mockResolvedValue(true);
  getReviewerTimeBudgetSeconds.mockResolvedValue(600);
  findApplicantRecommendedByRequest.mockResolvedValue([
    { _wmkf_potentialreviewer_value: PR, _wmkf_potentialreviewer_value_formatted: 'Dr. Rec One', wmkf_appreviewersuggestionid: SUG },
  ]);
  getPersonById.mockResolvedValue({ wmkf_primaryaffiliation: 'Rec University' });
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({ ...s, verified: true, publications: [], verificationConfidence: 0.9 })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      email: 'rec.one@rec.edu',
      contactEnrichment: { emailSource: 'claude_search', website: 'https://rec.edu/one' },
    })),
  }));
  upsertByPotentialReviewer.mockResolvedValue({});
});

describe('pre-stream gates (JSON, not SSE)', () => {
  test('non-POST → 405 + Allow, nothing streamed', async () => {
    const res = sseRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(res.jsonBody).toEqual({ error: 'Method not allowed' });
    expect(res.chunks).toEqual([]);
  });

  test('auth short-circuit: limiter and pipeline never run', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = sseRes();
    await handler(post(baseBody()), res);
    expect(limiter).not.toHaveBeenCalled();
    expect(findApplicantRecommendedByRequest).not.toHaveBeenCalled();
    expect(res.chunks).toEqual([]);
  });

  test('rate limiter runs AFTER auth and short-circuits before the model warm', async () => {
    limiter.mockResolvedValueOnce(false);
    const res = sseRes();
    await handler(post(baseBody()), res);
    expect(requireAppAccess).toHaveBeenCalled();
    expect(loadModelOverrides).not.toHaveBeenCalled();
    expect(res.chunks).toEqual([]);
  });

  test('non-GUID requestId → 400 JSON (after the model-override warm), no SSE headers', async () => {
    const res = sseRes();
    await handler(post(baseBody({ requestId: 'nope' })), res);
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'requestId must be a GUID' });
    expect(loadModelOverrides).toHaveBeenCalledTimes(1); // historical order: warm precedes validation
    expect(res.headers['Content-Type']).toBeUndefined();
  });
});

describe('empty frames (terminal complete with recommended: [])', () => {
  test('no recommended junction rows → single complete frame, then end', async () => {
    findApplicantRecommendedByRequest.mockResolvedValue([]);
    const res = sseRes();
    await handler(post(baseBody()), res);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.events()).toEqual([{ event: 'complete', data: { recommended: [] } }]);
    expect(res.ended).toBe(true);
  });

  test('rows without person id/name yield no suggestions → complete { recommended: [] }', async () => {
    findApplicantRecommendedByRequest.mockResolvedValue([
      { _wmkf_potentialreviewer_value: null, wmkf_appreviewersuggestionid: SUG },
    ]);
    const res = sseRes();
    await handler(post(baseBody()), res);
    expect(res.events()).toEqual([{ event: 'complete', data: { recommended: [] } }]);
    expect(res.ended).toBe(true);
  });
});

describe('terminal error frames (single error event, resolve + end, never throw)', () => {
  test('no analysisResult and no API key → error frame', async () => {
    delete process.env.CLAUDE_API_KEY;
    const res = sseRes();
    await handler(post(baseBody({ analysisResult: undefined })), res);
    expect(res.events()).toEqual([
      { event: 'error', data: { message: 'Claude API key not configured on server' } },
    ]);
    expect(res.ended).toBe(true);
  });

  test('no analysisResult and no blobUrl → error frame with the reload guidance', async () => {
    const res = sseRes();
    await handler(post(baseBody({ analysisResult: undefined })), res);
    const events = res.events();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.message).toMatch(/No proposal loaded — cannot compute conflicts of interest/);
    expect(res.ended).toBe(true);
  });

  test('proposalInfo without authors/institution → abort error frame', async () => {
    const res = sseRes();
    await handler(post(baseBody({ analysisResult: { proposalInfo: {} } })), res);
    const events = res.events();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.message).toMatch(/Could not determine the proposal(’|')s authors\/institution/);
    expect(res.ended).toBe(true);
  });

  test('pipeline throw → generic error frame with the thrown message; ends cleanly', async () => {
    findApplicantRecommendedByRequest.mockRejectedValue(new Error('dataverse down'));
    const res = sseRes();
    await handler(post(baseBody()), res);
    expect(res.events()).toEqual([{ event: 'error', data: { message: 'dataverse down' } }]);
    expect(res.ended).toBe(true);
  });

  test('time-budget abort → error frame with timeout: true and the budget guidance', async () => {
    getReviewerTimeBudgetSeconds.mockResolvedValue(0); // deadline timer fires immediately
    findApplicantRecommendedByRequest.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('aborted mid-flight')), 25)),
    );
    const res = sseRes();
    await handler(post(baseBody()), res);
    const events = res.events();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.timeout).toBe(true);
    expect(events[0].data.message).toMatch(/time budget/);
    expect(res.ended).toBe(true);
  });
});

describe('happy path (progress ordering + full card payload)', () => {
  test('progress frames precede a single terminal complete; card pins the payload key set', async () => {
    const res = sseRes();
    await handler(post(baseBody()), res);
    const events = res.events();

    // Ordering: ≥2 progress frames (verify, enrich), exactly one terminal complete, nothing after it.
    const names = events.map((e) => e.event);
    expect(names.filter((n) => n === 'complete')).toHaveLength(1);
    expect(names.filter((n) => n === 'error')).toHaveLength(0);
    expect(names[names.length - 1]).toBe('complete');
    expect(names.slice(0, -1).every((n) => n === 'progress')).toBe(true);
    expect(events[0].data.message).toMatch(/Verifying 1 recommended reviewer\(s\) in PubMed/);
    expect(events.some((e) => e.event === 'progress' && /Finding contact info & citation metrics for 1 reviewer\(s\)/.test(e.data.message))).toBe(true);

    const { recommended } = events[events.length - 1].data;
    expect(recommended).toHaveLength(1);
    expect(recommended[0]).toEqual({
      potentialReviewerId: PR,
      suggestionId: SUG,
      enrichedProposalKey: 'blob-key-1',
      name: 'Dr. Rec One',
      affiliation: 'Rec University',
      seniorityEstimate: null,
      verified: true,
      unverified: false,
      verificationConfidence: 0.9,
      publications: [],
      publicationCount5yr: null,
      reasoning: null,
      hasInstitutionCOI: false,
      hasCoauthorCOI: false,
      institutionCOIDetails: null,
      coauthorships: [],
      institutionMismatch: false,
      suggestedInstitution: null,
      expertiseMismatch: false,
      expertiseAreas: [],
      email: 'rec.one@rec.edu',
      emailSource: 'claude_search',
      website: 'https://rec.edu/one',
      orcidUrl: null,
      googleScholarUrl: null,
      hIndex: null,
      totalCitations: null,
      isApplicantRecommended: true,
    });

    // Writeback + roster persistence happened (id-keyed, best-effort).
    expect(upsertByPotentialReviewer).toHaveBeenCalledWith(PR, expect.objectContaining({ email: 'rec.one@rec.edu' }), { actingUserSystemId: 'u-1' });
    expect(recordSurfaced).toHaveBeenCalledWith(REQ, [expect.objectContaining({ name: 'Dr. Rec One' })]);
    expect(res.ended).toBe(true);
  });

  test('mid-stream per-candidate writeback failure is a NON-terminal progress frame; complete still arrives', async () => {
    upsertByPotentialReviewer.mockRejectedValue(new Error('sidecar write failed'));
    const res = sseRes();
    await handler(post(baseBody()), res);
    const events = res.events();
    expect(events.some((e) => e.event === 'progress' && /Could not save metrics for Dr\. Rec One: sidecar write failed/.test(e.data.message))).toBe(true);
    expect(events[events.length - 1].event).toBe('complete');
    expect(events[events.length - 1].data.recommended).toHaveLength(1);
    expect(res.ended).toBe(true);
  });

  test('no COI → setMatchReason never called; COI flags → deterministic reason SET on the junction row', async () => {
    const res = sseRes();
    await handler(post(baseBody()), res);
    expect(setMatchReason).not.toHaveBeenCalled();

    enrichCandidates.mockImplementation(async (candidates) => ({
      enriched: candidates.map((c) => ({ ...c, hasInstitutionCOI: true, contactEnrichment: {} })),
    }));
    const res2 = sseRes();
    await handler(post(baseBody()), res2);
    expect(setMatchReason).toHaveBeenCalledWith(
      SUG,
      'Recommended by applicant (legacy reviewer slot). [Institution COI: Same institution as proposal PI]',
      { actingUserSystemId: 'u-1' },
    );
    expect(res2.events().pop().data.recommended[0].hasInstitutionCOI).toBe(true);
  });
});
