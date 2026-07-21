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

const institutionDirectMatch = jest.fn((left, right) => {
  const normalize = (value) => String(value || '').trim().toLowerCase();
  const l = normalize(left);
  const r = normalize(right);
  return !!l && !!r && (l === r || l.includes(r) || r.includes(l));
});
jest.mock('../../lib/services/deduplication-service', () => ({
  DeduplicationService: {
    markInstitutionCOIResolved: jest.fn(async (c) => c),
    institutionDirectMatch: (...a) => institutionDirectMatch(...a),
  },
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

const areInstitutionsConsistent = jest.fn(async () => false);
jest.mock('../../lib/services/institution-affiliation-consistency', () => ({
  createInstitutionConsistencyChecker: jest.fn(() => ({
    areConsistent: (...a) => areInstitutionsConsistent(...a),
  })),
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

const recordSurfaced = jest.fn(async () => 1);
const findCandidateBySuggestion = jest.fn(async () => null);
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  recordSurfaced: (...a) => recordSurfaced(...a),
  findCandidateBySuggestion: (...a) => findCandidateBySuggestion(...a),
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
  areInstitutionsConsistent.mockResolvedValue(false);
  getReviewerTimeBudgetSeconds.mockResolvedValue(600);
  findCandidateBySuggestion.mockResolvedValue(null);
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

test('an enrichment write uses the pre-run roster token and leaves a concurrently changed row untouched', async () => {
  findCandidateBySuggestion.mockResolvedValueOnce({
    candidateKey: `suggestion:${SUG}`,
    suggestionId: SUG,
    name: 'Dr. Rec One',
    identityStatus: 'unresolved',
    rosterUpdatedAt: '2026-07-20 10:00:00+00',
  });
  recordSurfaced.mockResolvedValueOnce(0);

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(recordSurfaced).toHaveBeenCalledWith(
    REQ,
    [expect.objectContaining({ suggestionId: SUG })],
    { expectedUpdatedAt: '2026-07-20 10:00:00+00' },
  );
  expect(events).toContainEqual({
    event: 'progress',
    data: { message: '1 reviewer row(s) changed while enrichment was running and were left unchanged.' },
  });
  expect(events.at(-1).event).toBe('complete');
});

test('rerun preserves an authenticated staff-confirmed row without automated overwrite', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    candidateKey: 'suggestion:33333333-3333-3333-3333-333333333333',
    suggestionId: SUG,
    name: 'Dr. Rec One',
    email: 'staff-confirmed@example.edu',
    identityStatus: 'unresolved',
    needsIdentification: true,
    isApplicantRecommended: true,
    pdIdentityConfirmed: true,
    pdIdentityConfirmationId: 'confirm-1',
    staffIdentityConfirmation: { confirmationId: 'confirm-1', source: 'staff_confirmed' },
  });

  const { events, onEvent } = recorder();
  await enrichRecommended(args({ analysisResult: undefined, apiKey: undefined }), onEvent);

  expect(verifyClaudeSuggestions).not.toHaveBeenCalled();
  expect(enrichCandidates).not.toHaveBeenCalled();
  expect(events).toEqual([{
    event: 'complete',
    data: {
      recommended: [expect.objectContaining({
        candidateKey: 'suggestion:33333333-3333-3333-3333-333333333333',
        enrichedProposalKey: 'key-1',
        email: 'staff-confirmed@example.edu',
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'confirm-1',
      })],
    },
  }]);
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQ,
    [expect.objectContaining({
      email: 'staff-confirmed@example.edu',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
    })],
    { expectedUpdatedAt: null },
  );
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
    { expectedUpdatedAt: null },
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

test('a late namesake substitution is rejected even when PubMed matched the listed institution before enrichment', async () => {
  getPersonById.mockResolvedValue({
    wmkf_primaryaffiliation: 'University of Illinois Urbana-Champaign',
  });
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      verificationSource: 'pubmed',
      institutionMismatch: false,
      affiliation: 'University of Illinois Urbana-Champaign',
      affiliationHistory: ['University of Illinois Urbana-Champaign'],
      publications: [{ title: 'Illinois biomedical paper', year: 2025 }],
    })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      affiliation: 'York University',
      email: 'rbashir@illinois.edu',
      website: 'https://lassonde.yorku.ca/users/rashid-bashir',
      hIndex: 4,
      totalCitations: 69,
      contactEnrichment: {
        email: 'rbashir@illinois.edu',
        emailSource: 'pubmed',
        website: 'https://lassonde.yorku.ca/users/rashid-bashir',
        orcidId: '0000-0002-2089-7957',
        orcidUrl: 'https://orcid.org/0000-0002-2089-7957',
        orcidAffiliation: 'York University',
        identity: { status: 'probable' },
        tierResults: {
          orcid: {
            affiliations: [{ organization: 'York University', current: true }],
          },
        },
      },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(areInstitutionsConsistent).toHaveBeenCalledTimes(1);
  expect(areInstitutionsConsistent).toHaveBeenCalledWith(
    'University of Illinois Urbana-Champaign',
    'York University',
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(events.at(-1).data.recommended[0]).toMatchObject({
    name: 'Dr. Rec One',
    needsIdentification: true,
    identityStatus: 'unresolved',
    affiliation: null,
    email: null,
    website: null,
    orcidUrl: null,
    hIndex: null,
    totalCitations: null,
    publications: [],
  });
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(writeIdentityDecision).not.toHaveBeenCalled();
  expect(setMatchReason).not.toHaveBeenCalled();
});

test('current-run PubMed evidence prevents a previously contaminated affiliation from self-confirming on rerun', async () => {
  // Simulate the persisted shape after the original bad run: automated
  // enrichment filled primary affiliation with York, while PubMed still finds
  // the intended Illinois researcher during this run.
  getPersonById.mockResolvedValue({
    wmkf_primaryaffiliation: 'York University',
    wmkf_organizationname: 'University of Illinois Urbana-Champaign',
  });
  // The legacy final gate compared only the stored suggestion (York) with the
  // final affiliation (York), cleared the earlier PubMed mismatch, and accepted.
  // Pair-sensitive behavior makes this test fail if the new current-run PubMed
  // comparison is removed.
  areInstitutionsConsistent.mockImplementation(async (left, right) =>
    institutionDirectMatch(left, right));
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      verificationSource: 'pubmed',
      institutionMismatch: true,
      affiliation: 'University of Illinois Urbana-Champaign',
      affiliationHistory: ['University of Illinois Urbana-Champaign'],
      publications: [{ title: 'Illinois biomedical paper', year: 2025 }],
    })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      affiliation: 'York University',
      website: 'https://lassonde.yorku.ca/users/rashid-bashir',
      hIndex: 4,
      contactEnrichment: {
        website: 'https://lassonde.yorku.ca/users/rashid-bashir',
        orcidId: '0000-0002-2089-7957',
        orcidUrl: 'https://orcid.org/0000-0002-2089-7957',
        orcidAffiliation: 'York University',
        identity: { status: 'probable' },
        tierResults: {
          orcid: {
            affiliations: [{ organization: 'York University', current: true }],
          },
        },
      },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(events.at(-1).data.recommended[0]).toMatchObject({
    needsIdentification: true,
    identityStatus: 'unresolved',
    affiliation: null,
    website: null,
    orcidUrl: null,
    hIndex: null,
    publications: [],
  });
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(writeIdentityDecision).not.toHaveBeenCalled();
});

test('ORCID employment history connects a legitimate institutional move without a network reconciliation call', async () => {
  getPersonById.mockResolvedValue({ wmkf_primaryaffiliation: 'Northwestern University' });
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      verificationSource: 'pubmed',
      institutionMismatch: true,
      affiliation: 'Stanford University',
      affiliationHistory: ['Stanford University', 'Northwestern University'],
      publications: [{ title: 'Current Stanford paper', year: 2025 }],
    })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      affiliation: 'Stanford University',
      email: 'mover@stanford.edu',
      contactEnrichment: {
        email: 'mover@stanford.edu',
        emailSource: 'orcid',
        orcidAffiliation: 'Stanford University',
        identity: { status: 'probable' },
        tierResults: {
          orcid: {
            affiliations: [
              { organization: 'Stanford University', current: true },
              { organization: 'Northwestern University', current: false, endYear: 2023 },
            ],
          },
        },
      },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(areInstitutionsConsistent).not.toHaveBeenCalled();
  expect(events.at(-1).data.recommended[0]).toMatchObject({
    needsIdentification: false,
    identityStatus: 'probable',
    affiliation: 'Stanford University',
    email: 'mover@stanford.edu',
  });
  expect(upsertByPotentialReviewer).toHaveBeenCalled();
  expect(writeIdentityDecision).toHaveBeenCalled();
});

test('a resolved co-affiliation suppresses the string mismatch instead of creating staff work', async () => {
  areInstitutionsConsistent.mockResolvedValue(true);
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      institutionMismatch: true,
      suggestedInstitution: 'Broad Institute',
      affiliation: 'Massachusetts Institute of Technology',
      publications: [],
    })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      email: 'reviewer@mit.edu',
      contactEnrichment: {
        email: 'reviewer@mit.edu',
        emailSource: 'affiliation',
        identity: { status: 'probable' },
      },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(areInstitutionsConsistent).toHaveBeenCalledWith(
    'Broad Institute',
    'Massachusetts Institute of Technology',
    expect.objectContaining({ signal: expect.anything() }),
  );
  expect(events.at(-1).data.recommended[0]).toMatchObject({
    needsIdentification: false,
    identityStatus: 'probable',
    email: 'reviewer@mit.edu',
  });
  expect(upsertByPotentialReviewer).toHaveBeenCalled();
});

test('a co-affiliation checker error keeps the contradiction gated and emits a retryable progress reason', async () => {
  areInstitutionsConsistent.mockRejectedValue(new Error('OpenAlex unavailable'));
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      institutionMismatch: true,
      suggestedInstitution: 'Broad Institute',
      affiliation: 'Massachusetts Institute of Technology',
      publications: [],
    })),
    unverified: [],
  }));
  enrichCandidates.mockImplementation(async (candidates) => ({
    enriched: candidates.map((c) => ({
      ...c,
      contactEnrichment: { identity: { status: 'probable' } },
    })),
  }));

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(events).toContainEqual({
    event: 'progress',
    data: { message: 'Could not reconcile institution affiliations for Dr. Rec One: OpenAlex unavailable' },
  });
  expect(events.at(-1).data.recommended[0]).toMatchObject({
    identityStatus: 'unresolved',
    needsIdentification: true,
    institutionMismatch: true,
  });
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(writeIdentityDecision).not.toHaveBeenCalled();
});

test('a deadline abort during co-affiliation checking remains a terminal timeout', async () => {
  getReviewerTimeBudgetSeconds.mockResolvedValue(0);
  verifyClaudeSuggestions.mockImplementation(async (suggestions) => ({
    verified: suggestions.map((s) => ({
      ...s,
      verified: true,
      institutionMismatch: true,
      suggestedInstitution: 'Broad Institute',
      affiliation: 'Massachusetts Institute of Technology',
      publications: [],
    })),
    unverified: [],
  }));
  areInstitutionsConsistent.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw new Error('checker aborted');
  });

  const { events, onEvent } = recorder();
  await enrichRecommended(args(), onEvent);

  expect(events.at(-1)).toMatchObject({
    event: 'error',
    data: { timeout: true },
  });
  expect(events.some((event) => event.event === 'complete')).toBe(false);
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
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
