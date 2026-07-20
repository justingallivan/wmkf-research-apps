/**
 * @jest-environment node
 *
 * lib/services/workbench/enrich-recommended-service — logic-level tests with
 * a recording onEvent (Stage 4 series B extraction, 2s template). Pins:
 * happy-path event ordering, empty/no-candidates frames, mid-stream
 * per-candidate failure staying non-terminal, and terminal failures emitting
 * ONE error event and RESOLVING (never throwing). The route characterization
 * (tests/integration/enrich-recommended-route.test.js) pins framing + the
 * full card payload.
 */

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
jest.mock('../../lib/services/discovery-service', () => ({
  DiscoveryService: {
    pubMedVerificationContract: jest.fn(({ searchPubmed }) => ({ enabled: !!searchPubmed })),
    isClearlyNonBiomedicalVerifierArea: jest.fn(() => false),
    verifyClaudeSuggestions: (...a) => verifyClaudeSuggestions(...a),
    checkCoauthorshipsForCandidates: jest.fn(async (c) => c),
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

jest.mock('../../lib/services/openalex-service', () => ({
  OpenAlexService: { getWorksByAuthor: jest.fn(async () => ({ totalCount: 12 })) },
}));

jest.mock('../../lib/services/claude-reviewer-service', () => ({
  ClaudeReviewerService: { analyzeProposal: jest.fn() },
}));

jest.mock('../../lib/services/proposal-pi-identity', () => ({
  resolveProposalPI: jest.fn(async () => null),
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

jest.mock('../../lib/services/backprop-reviewer-orcid', () => ({
  backPropReviewerOrcidToContact: jest.fn(async () => {}),
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

const { ContactParser } = require('../../lib/utils/contact-parser');
import { enrichRecommended } from '../../lib/services/workbench/enrich-recommended-service';

const REQ = '11111111-1111-1111-1111-111111111111';
const PR = '22222222-2222-2222-2222-222222222222';
const SUG = '33333333-3333-3333-3333-333333333333';

function recorder() {
  const events = [];
  return { events, onEvent: (e) => events.push(e) };
}

const args = (over = {}) => ({
  requestId: REQ,
  blobUrl: undefined,
  analysisResult: { proposalInfo: { authorInstitution: 'PI University', proposalAuthors: 'Dr. PI', primaryResearchArea: 'Biology' } },
  proposalKey: 'key-1',
  apiKey: 'test-key',
  actingUserSystemId: 'u-1',
  userProfileId: 7,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  ContactParser.isNameConsistentEmail.mockReturnValue(true);
  getReviewerTimeBudgetSeconds.mockResolvedValue(600);
  findApplicantRecommendedByRequest.mockResolvedValue([
    { _wmkf_potentialreviewer_value: PR, _wmkf_potentialreviewer_value_formatted: 'Dr. Rec One', wmkf_appreviewersuggestionid: SUG },
  ]);
  getPersonById.mockResolvedValue({ wmkf_primaryaffiliation: 'Rec University' });
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({ ...s, verified: true, publications: [] })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      contactEnrichment: { identity: { status: 'probable' } },
    })),
  }));
  upsertByPotentialReviewer.mockResolvedValue({});
});

test('happy path: progress frames strictly precede one terminal complete; never touches res', async () => {
  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);
  const names = events.map((e) => e.event);
  expect(names[names.length - 1]).toBe('complete');
  expect(names.slice(0, -1).every((n) => n === 'progress')).toBe(true);
  expect(names.filter((n) => n === 'complete')).toHaveLength(1);
  const complete = events[events.length - 1].data;
  expect(complete.recommended).toHaveLength(1);
  expect(complete.recommended[0]).toMatchObject({
    potentialReviewerId: PR,
    suggestionId: SUG,
    enrichedProposalKey: 'key-1',
    name: 'Dr. Rec One',
    isApplicantRecommended: true,
  });
  expect(recordSurfaced).toHaveBeenCalledTimes(1);
});

test('empty frames: no junction rows, and rows yielding no valid suggestions → complete { recommended: [] }', async () => {
  findApplicantRecommendedByRequest.mockResolvedValue([]);
  let rec = recorder();
  await enrichRecommended(args(), rec.onEvent);
  expect(rec.events).toEqual([{ event: 'complete', data: { recommended: [] } }]);

  findApplicantRecommendedByRequest.mockResolvedValue([{ _wmkf_potentialreviewer_value: null }]);
  rec = recorder();
  await enrichRecommended(args(), rec.onEvent);
  expect(rec.events).toEqual([{ event: 'complete', data: { recommended: [] } }]);
});

test('pre-pipeline aborts emit exactly one error event and resolve', async () => {
  // no analysisResult + no apiKey
  let rec = recorder();
  await expect(enrichRecommended(args({ analysisResult: undefined, apiKey: undefined }), rec.onEvent)).resolves.toBeUndefined();
  expect(rec.events).toEqual([{ event: 'error', data: { message: 'Claude API key not configured on server' } }]);

  // proposalInfo without authors/institution
  rec = recorder();
  await enrichRecommended(args({ analysisResult: { proposalInfo: {} } }), rec.onEvent);
  expect(rec.events).toHaveLength(1);
  expect(rec.events[0].event).toBe('error');
});

test('mid-stream per-candidate writeback failure is a NON-terminal progress frame; complete still terminal', async () => {
  upsertByPotentialReviewer.mockRejectedValue(new Error('sidecar down'));
  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);
  expect(events.some((e) => e.event === 'progress' && /Could not save metrics for Dr\. Rec One: sidecar down/.test(e.data.message))).toBe(true);
  expect(events[events.length - 1].event).toBe('complete');
});

test('structured author-affiliation evidence preserves an opaque scholarly email local part', async () => {
  ContactParser.isNameConsistentEmail.mockReturnValue(false);
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      email: 'lab-director@stanford.edu',
      contactEnrichment: {
        email: 'lab-director@stanford.edu',
        emailSource: 'scholarly_multi',
        identity: { status: 'probable' },
      },
    })),
  }));

  const { onEvent } = recorder();
  await enrichRecommended(args(), onEvent);
  expect(upsertByPotentialReviewer).toHaveBeenCalledWith(
    PR,
    expect.objectContaining({
      email: 'lab-director@stanford.edu',
      emailSource: 'scholarly_multi',
    }),
    expect.anything(),
  );
});

test('a top-level email cannot borrow the scholarly name-guard bypass for another address', async () => {
  ContactParser.isNameConsistentEmail.mockReturnValue(false);
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      email: 'unproven-address@stanford.edu',
      contactEnrichment: {
        email: 'proven-address@stanford.edu',
        emailSource: 'scholarly_multi',
        identity: { status: 'probable' },
      },
    })),
  }));

  const { onEvent } = recorder();
  await enrichRecommended(args(), onEvent);
  expect(upsertByPotentialReviewer).toHaveBeenCalledWith(
    PR,
    expect.objectContaining({
      email: null,
      emailSource: null,
    }),
    expect.anything(),
  );
});

test('a stored affiliation does not exempt an applicant reviewer from the identity gate', async () => {
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      email: 'namesake@wrong.edu',
      affiliation: 'Wrong University',
      hIndex: 99,
      expertiseAreas: ['wrong-person topic'],
      contactEnrichment: {
        email: 'namesake@wrong.edu',
        emailSource: 'claude_search',
        website: 'https://wrong.edu/namesake',
      },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  const candidate = events.at(-1).data.recommended[0];
  expect(candidate).toMatchObject({
    name: 'Dr. Rec One',
    needsIdentification: true,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
    affiliation: null,
    email: null,
    hIndex: null,
  });
  expect(candidate.reasoning).toMatch(/identity resolver did not establish a probable match/i);
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(writeIdentityDecision).not.toHaveBeenCalled();
  expect(clearIdentityFields).not.toHaveBeenCalled();
  expect(setMatchReason).not.toHaveBeenCalled();
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQ,
    [expect.objectContaining({ needsIdentification: true, identityStatus: 'unresolved', email: null })],
  );
});

test('an institution contradiction overrides a probable identity verdict and leaves Dataverse unchanged', async () => {
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      institutionMismatch: true,
      suggestedInstitution: 'Expected University',
      affiliation: 'Different University',
      publications: [{ title: 'Namesake paper', year: 2025 }],
    })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      email: 'namesake@different.edu',
      hasInstitutionCOI: true,
      contactEnrichment: {
        email: 'namesake@different.edu',
        emailSource: 'claude_search',
        identity: { status: 'probable' },
      },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  const candidate = events.at(-1).data.recommended[0];
  expect(candidate).toMatchObject({
    needsIdentification: true,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
    institutionMismatch: true,
    suggestedInstitution: 'Expected University',
    affiliation: null,
    email: null,
    hasInstitutionCOI: false,
  });
  expect(candidate.reasoning).toMatch(/contradict the listed institution/i);
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(writeIdentityDecision).not.toHaveBeenCalled();
  expect(setMatchReason).not.toHaveBeenCalled();
});

test('pipeline throw: resolves (never throws) with one generic terminal error', async () => {
  findApplicantRecommendedByRequest.mockRejectedValue(new Error('dataverse down'));
  const { events, onEvent } = recorder();
  await expect(enrichRecommended(args(), onEvent)).resolves.toBeUndefined();
  expect(events).toEqual([{ event: 'error', data: { message: 'dataverse down' } }]);
});

test('time-budget abort: resolves with the timeout error variant', async () => {
  getReviewerTimeBudgetSeconds.mockResolvedValue(0);
  findApplicantRecommendedByRequest.mockImplementation(
    () => new Promise((_, reject) => setTimeout(() => reject(new Error('aborted mid-flight')), 25)),
  );
  const { events, onEvent } = recorder();
  await expect(enrichRecommended(args(), onEvent)).resolves.toBeUndefined();
  expect(events).toHaveLength(1);
  expect(events[0].event).toBe('error');
  expect(events[0].data.timeout).toBe(true);
  expect(events[0].data.message).toMatch(/time budget/);
});
