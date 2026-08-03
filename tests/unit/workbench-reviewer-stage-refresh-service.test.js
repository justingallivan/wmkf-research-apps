/** @jest-environment node */

import fs from 'fs';

const findCandidateByKey = jest.fn();
const startStageRefresh = jest.fn();
const completeStageRefreshWithEvidence = jest.fn();
const failStageRefresh = jest.fn();
const recoverExpiredStageRefresh = jest.fn();
const findById = jest.fn();
const hasApplicantProvenance = jest.fn();
const getById = jest.fn();
const buildApplicantAnchorRefreshReceipt = jest.fn();
const projectApplicantWarmInputs = jest.fn(() => ({ state: 'current' }));
const resolveReviewerProposalMetadata = jest.fn(async () => ({
  state: 'current', proposalContentVersion: 'a'.repeat(64),
}));
const enrichRecommended = jest.fn();
const downloadFileByPath = jest.fn();
const extractTextFromBuffer = jest.fn();
const analyzeProposal = jest.fn();

jest.mock('../../lib/services/reviewer-roster-store', () => ({
  findCandidateByKey: (...args) => findCandidateByKey(...args),
  startStageRefresh: (...args) => startStageRefresh(...args),
  completeStageRefreshWithEvidence: (...args) => completeStageRefreshWithEvidence(...args),
  failStageRefresh: (...args) => failStageRefresh(...args),
  recoverExpiredStageRefresh: (...args) => recoverExpiredStageRefresh(...args),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  hasApplicantProvenance: (...args) => hasApplicantProvenance(...args),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getById(...args),
}));
jest.mock('../../lib/services/workbench/reviewer-warm-validation-service', () => ({
  REQUEST_SELECT: 'akoya_requestid,_wmkf_potentialreviewer1_value',
  buildApplicantAnchorRefreshReceipt: (...args) => buildApplicantAnchorRefreshReceipt(...args),
  projectApplicantWarmInputs: (...args) => projectApplicantWarmInputs(...args),
  resolveReviewerProposalMetadata: (...args) => resolveReviewerProposalMetadata(...args),
}));
// The target service must not import or call the legacy full-batch repair path.
jest.mock('../../lib/services/workbench/enrich-recommended-service', () => ({
  enrichRecommended: (...args) => enrichRecommended(...args),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { downloadFileByPath: (...args) => downloadFileByPath(...args) },
}));
jest.mock('../../lib/utils/file-loader', () => ({
  extractTextFromBuffer: (...args) => extractTextFromBuffer(...args),
}));
jest.mock('../../lib/services/claude-reviewer-service', () => ({
  ClaudeReviewerService: { analyzeProposal: (...args) => analyzeProposal(...args) },
}));

import {
  EXECUTABLE_REVIEWER_REFRESH_STAGES,
  refreshReviewerCandidateStage,
  _internals,
} from '../../lib/services/workbench/reviewer-stage-refresh-service';
import {
  normalizeProposalAuthors,
  proposalAuthorFingerprint,
} from '../../lib/services/reviewer-proposal-author-fingerprint';
import {
  applicantAnchorSourceVersion,
  buildReviewerStageDependencySnapshot,
  expiredLeaseRecoverySourceVersion,
} from '../../lib/services/workbench/reviewer-stage-source-versions';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '22222222-2222-2222-2222-222222222222';
const PERSON_ID = '33333333-3333-3333-3333-333333333333';
const CANDIDATE_KEY = `suggestion:${SUGGESTION_ID}`;
const UPDATED_AT = '2026-08-02 12:00:00+00';
const STARTED_UPDATED_AT = '2026-08-02 12:00:01+00';
const APPLICANT_SOURCE = 'a'.repeat(64);
const ORIGINAL_CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

beforeAll(() => {
  process.env.CLAUDE_API_KEY = 'unit-test-key';
});

afterAll(() => {
  if (ORIGINAL_CLAUDE_API_KEY === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = ORIGINAL_CLAUDE_API_KEY;
});

function target(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    candidateKey: CANDIDATE_KEY,
    stage: 'applicant_anchor',
    expectedUpdatedAt: UPDATED_AT,
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    candidateKey: CANDIDATE_KEY,
    suggestionId: SUGGESTION_ID,
    potentialReviewerId: PERSON_ID,
    rosterStatus: 'active',
    warmCacheVersion: 1,
    isApplicantRecommended: true,
    applicantInputVersion: APPLICANT_SOURCE,
    name: 'Server-only display value',
    ...overrides,
  };
}

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_sources: 'applicant',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findCandidateByKey.mockResolvedValue(candidate());
  findById.mockResolvedValue(suggestion());
  hasApplicantProvenance.mockReturnValue(true);
  startStageRefresh.mockResolvedValue({ outcome: 'recorded', updatedAt: STARTED_UPDATED_AT });
  completeStageRefreshWithEvidence.mockResolvedValue({ outcome: 'recorded' });
  failStageRefresh.mockResolvedValue({ outcome: 'failed_retryable' });
  recoverExpiredStageRefresh.mockResolvedValue({ outcome: 'failed_retryable', updatedAt: '2026-08-02 12:00:00.500+00' });
  getById.mockResolvedValue({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1000001' });
  buildApplicantAnchorRefreshReceipt.mockReturnValue({
    state: 'current',
    contractVersion: 1,
    sourceVersion: APPLICANT_SOURCE,
    completedAt: '2026-08-02T12:00:02.000Z',
  });
  downloadFileByPath.mockResolvedValue({ buffer: Buffer.from('proposal'.repeat(50)), mimeType: 'application/pdf' });
  extractTextFromBuffer.mockResolvedValue('Proposal text '.repeat(20));
  analyzeProposal.mockResolvedValue({ proposalInfo: { title: 'Server proposal', primaryResearchArea: 'Biochemistry' } });
});

test('refreshes exactly one canonical applicant anchor and never calls batch enrichment', async () => {
  const result = await refreshReviewerCandidateStage(target());

  expect(EXECUTABLE_REVIEWER_REFRESH_STAGES).toEqual(expect.arrayContaining(['applicant_anchor', 'contact', 'roster_persistence']));
  expect(result).toMatchObject({ outcome: 'recorded', requestId: REQUEST_ID, candidateKey: CANDIDATE_KEY, stage: 'applicant_anchor' });
  // The service has only the pre-write plan here. The client reloads the
  // canonical roster after success, so a response must not expose it as the
  // post-write plan.
  expect(result).not.toHaveProperty('candidatePlan');
  expect(findCandidateByKey).toHaveBeenCalledWith(REQUEST_ID, CANDIDATE_KEY);
  expect(findById).toHaveBeenCalledWith(SUGGESTION_ID);
  expect(startStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'applicant_anchor',
    expect.objectContaining({ reason: 'manual_refresh', attemptId: expect.any(String) }),
  );
  expect(completeStageRefreshWithEvidence).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    STARTED_UPDATED_AT,
    'applicant_anchor',
    expect.any(String),
    expect.objectContaining({
      outcome: 'current',
      receipt: expect.objectContaining({ state: 'current', contractVersion: 1, resultVersion: expect.any(String) }),
    }),
  );
  expect(enrichRecommended).not.toHaveBeenCalled();
  const source = fs.readFileSync(require.resolve('../../lib/services/workbench/reviewer-stage-refresh-service'), 'utf8');
  expect(source).not.toMatch(/from ['"][^'"]*enrich-recommended-service/);
  expect(source).not.toMatch(/findApplicantRecommendedByRequest/);
});

test('a stale identity plan is a one-stage refresh, while current ambiguous identity remains a staff-confirmation decision', () => {
  expect(_internals.safePlan({
    cacheOutcome: 'miss', currentStages: [], pendingStages: ['identity'],
    refreshes: [{ stage: 'identity', reason: 'stage_missing' }], promotionAuthority: 'blocked_refresh_required',
  }).refreshes).toEqual([{ stage: 'identity', reason: 'stage_missing', action: 'refresh_stage' }]);
  expect(_internals.safePlan({
    cacheOutcome: 'hit', currentStages: ['identity'], pendingStages: [], refreshes: [], promotionAuthority: 'blocked_identity_review',
  }).refreshes).toEqual([]);
});

test('forged roster proposal evidence cannot make manual identity current', async () => {
  const sourceVersion = 'c'.repeat(64);
  downloadFileByPath.mockRejectedValueOnce(new Error('Graph unavailable'));
  const envelope = await _internals.executeStage('identity', {
    request: { akoya_requestid: REQUEST_ID, akoya_requestnum: '1000001' },
    proposal: {
      state: 'current', proposalContentVersion: 'a'.repeat(64),
      bindingKey: 'akoya_request::R-1000001/Reviewer Materials::Proposal_1000001.pdf',
    },
    snapshot: {
      applicantInputVersion: APPLICANT_SOURCE,
      proposalContentVersion: 'a'.repeat(64),
      stageInputVersions: { identity: sourceVersion },
    },
    candidate: candidate({
      affiliation: 'Server Institution',
      proposalEvidence: { boundedIdentityContext: { title: 'Forged browser prose', primaryResearchArea: 'Unrelated field' } },
    }),
  });

  expect(envelope).toMatchObject({
    outcome: 'incomplete',
    receipt: { state: 'incomplete', sourceVersion, completedAt: null, failureCode: 'missing_required_input' },
  });
  expect(downloadFileByPath).toHaveBeenCalledWith(
    'akoya_request', 'R-1000001/Reviewer Materials', 'Proposal_1000001.pdf',
  );
  expect(analyzeProposal).not.toHaveBeenCalled();
});

test('manual coauthor authority derives bounded authors from the exact Graph-bound proposal, not roster prose', async () => {
  resolveReviewerProposalMetadata.mockResolvedValue({
    state: 'current',
    proposalContentVersion: 'a'.repeat(64),
    bindingKey: 'akoya_request::R-1000001/Reviewer Materials::Proposal_1000001.pdf',
  });
  analyzeProposal.mockResolvedValue({
    proposalInfo: {
      proposalAuthors: 'Dr. Alice Author, Bob Writer',
      coInvestigators: 'Carol Scientist',
      primaryResearchArea: 'Biochemistry',
    },
  });
  const analysis = await _internals.loadServerBoundProposalAnalysis({
    request: { akoya_requestid: REQUEST_ID, akoya_requestnum: '1000001' },
    proposal: {
      state: 'current', proposalContentVersion: 'a'.repeat(64),
      bindingKey: 'akoya_request::R-1000001/Reviewer Materials::Proposal_1000001.pdf',
    },
  });

  expect(analysis).toMatchObject({
    proposalAuthors: ['Alice Author', 'Bob Writer', 'Carol Scientist'],
    proposalAuthorVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(analyzeProposal).toHaveBeenCalledWith(
    expect.any(String),
    'unit-test-key',
    expect.objectContaining({ analysisPurpose: 'proposal_info', reviewerCount: 1 }),
  );
  expect(analysis.proposalInfo).not.toHaveProperty('proposalAuthors');
});

test('manual Graph analysis has the same proposal-author authority as applicant cold evidence and an attestation', async () => {
  const version = 'a'.repeat(64);
  const tail = Array.from({ length: 50 }, (_, index) => `Researcher ${index + 1}`);
  const proposalAuthors = ['Dr. Ada Lovelace', 'ada lovelace', 'Professor Grace Hopper', ...tail];
  const coInvestigators = ['Prof. Grace Hopper', 'Late Coauthor'];
  resolveReviewerProposalMetadata.mockResolvedValue({
    state: 'current',
    proposalContentVersion: version,
    bindingKey: 'akoya_request::R-1000001/Reviewer Materials::Proposal_1000001.pdf',
  });
  analyzeProposal.mockResolvedValue({
    proposalInfo: {
      proposalAuthors: proposalAuthors.join(', '),
      coInvestigators: coInvestigators.join(', '),
    },
  });

  const analysis = await _internals.loadServerBoundProposalAnalysis({
    request: { akoya_requestid: REQUEST_ID, akoya_requestnum: '1000001' },
    proposal: {
      state: 'current', proposalContentVersion: version,
      bindingKey: 'akoya_request::R-1000001/Reviewer Materials::Proposal_1000001.pdf',
    },
  });
  // Applicant cold evidence and the signed Find attestation use this helper,
  // so this equality is the manual-vs-other-producer authority contract.
  const normalized = normalizeProposalAuthors([...proposalAuthors, ...coInvestigators]);
  const applicantOrAttestationFingerprint = proposalAuthorFingerprint(version, normalized);

  expect(analysis.proposalAuthors).toEqual(normalized);
  expect(analysis.proposalAuthors).toHaveLength(48);
  expect(analysis.proposalAuthors).toEqual(expect.arrayContaining(['Ada Lovelace', 'Grace Hopper']));
  expect(analysis.proposalAuthors).not.toContain('Late Coauthor');
  expect(analysis.proposalAuthorVersion).toBe(applicantOrAttestationFingerprint);
  expect(analysis.proposalAuthorVersion).not.toBe(
    proposalAuthorFingerprint('b'.repeat(64), normalized),
  );
});

test('rejects unknown stages and a name-only identity before any roster or Dataverse read', async () => {
  await expect(refreshReviewerCandidateStage(target({ stage: 'not_a_stage' }))).resolves.toMatchObject({
    outcome: 'rejected',
    code: 'stage_not_executable',
  });
  await expect(refreshReviewerCandidateStage({
    requestId: REQUEST_ID,
    name: 'Same Name, Different Person',
    stage: 'applicant_anchor',
    expectedUpdatedAt: UPDATED_AT,
  })).resolves.toMatchObject({
    outcome: 'rejected',
    code: 'invalid_refresh_target',
  });
  expect(findCandidateByKey).not.toHaveBeenCalled();
  expect(findById).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('rejects legacy generic candidate-key namespaces before any roster read', async () => {
  for (const candidateKey of ['candidate:legacy-row', 'client:browser-row']) {
    await expect(refreshReviewerCandidateStage(target({ candidateKey }))).resolves.toMatchObject({
      outcome: 'rejected',
      code: 'invalid_refresh_target',
    });
  }
  expect(findCandidateByKey).not.toHaveBeenCalled();
});

test('rejects a suggestion from a different request without starting a stage write', async () => {
  findById.mockResolvedValueOnce(suggestion({ _wmkf_request_value: '44444444-4444-4444-4444-444444444444' }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'rejected',
    code: 'suggestion_anchor_mismatch',
  });
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('returns skipped_stale when the initial candidate-key CAS loses', async () => {
  startStageRefresh.mockResolvedValueOnce({ outcome: 'skipped_stale' });

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({ outcome: 'skipped_stale' });
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
  expect(failStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('does not acquire a lease or re-stamp an already current exact applicant anchor', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageFreshness: {
      applicant_anchor: {
        state: 'current', contractVersion: 1,
        sourceVersion: APPLICANT_SOURCE,
        resultVersion: APPLICANT_SOURCE,
        completedAt: '2026-08-02T12:00:00.000Z',
      },
    },
  }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'not_required', stageState: 'current', reasonCode: 'refresh_not_required',
  });
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('reports a live server lease without starting a duplicate provider path', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageRefresh: {
      applicant_anchor: {
        refreshAttemptId: 'live-attempt',
        refreshStartedAt: new Date().toISOString(),
      },
    },
  }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'refresh_in_progress', stageState: 'refreshing', reasonCode: 'refresh_in_progress',
  });
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('a live lease owned by another stage blocks before authority or provider work begins', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageRefresh: {
      contact: {
        refreshAttemptId: 'live-contact-attempt',
        refreshStartedAt: '2099-08-02T12:00:00.000Z',
      },
    },
  }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'refresh_in_progress',
    code: 'candidate_refresh_in_progress',
    stageState: 'refreshing',
    reasonCode: 'refresh_in_progress',
    leaseStage: 'contact',
  });
  expect(getById).not.toHaveBeenCalled();
  expect(recoverExpiredStageRefresh).not.toHaveBeenCalled();
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
});

test('an expired lease owned by another stage returns named recovery-required without overwriting it', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageRefresh: {
      contact: {
        refreshAttemptId: 'expired-contact-attempt',
        refreshStartedAt: '2020-08-02T12:00:00.000Z',
      },
    },
  }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'lease_recovery_required',
    code: 'lease_recovery_required',
    stageState: 'stale',
    reasonCode: 'lease_recovery_required',
    leaseStage: 'contact',
  });
  expect(recoverExpiredStageRefresh).not.toHaveBeenCalled();
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
});

test('a malformed candidate-wide lease is operator-repair-only and never enters recovery or provider work', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageRefresh: {
      contact: { refreshStartedAt: '2020-08-02T11:00:00.000Z' },
    },
  }));

  await expect(refreshReviewerCandidateStage(target({ stage: 'contact' }))).resolves.toMatchObject({
    outcome: 'lease_repair_required',
    code: 'lease_repair_required',
    stageState: 'stale',
    reasonCode: 'lease_repair_required',
    leaseStage: 'contact',
  });
  expect(getById).not.toHaveBeenCalled();
  expect(recoverExpiredStageRefresh).not.toHaveBeenCalled();
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('fails closed before leasing when the initial authoritative request read is unavailable', async () => {
  getById.mockRejectedValueOnce(new Error('Dataverse request read timed out'));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'rejected', code: 'request_authority_unavailable', reasonCode: 'authority_stale',
  });
  expect(failStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('fails closed before leasing when the server can no longer resolve request inputs', async () => {
  getById.mockResolvedValueOnce(null);

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'rejected', code: 'request_authority_unavailable', reasonCode: 'authority_stale',
  });
  expect(failStageRefresh).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
});

test('fails closed before leasing when an authoritative request read returns a different id', async () => {
  getById.mockResolvedValueOnce({ akoya_requestid: '44444444-4444-4444-4444-444444444444' });

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'rejected', code: 'request_authority_unavailable', reasonCode: 'authority_stale',
  });
  expect(buildApplicantAnchorRefreshReceipt).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
  expect(failStageRefresh).not.toHaveBeenCalled();
});

test('recovers an expired matching lease as its own explicit action before any replacement attempt', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageRefresh: {
      applicant_anchor: {
        refreshAttemptId: 'prior-attempt',
        refreshStartedAt: '2025-08-02T11:00:00.000Z',
      },
    },
  }));

  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'failed_retryable',
    stageState: 'incomplete',
    reasonCode: 'prior_refresh_incomplete',
  });
  expect(recoverExpiredStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'applicant_anchor',
    'prior-attempt',
    expect.objectContaining({ leaseMs: expect.any(Number) }),
  );
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
});

test('legacy multiple expired leases recover in deterministic owner order without deadlock', async () => {
  findCandidateByKey.mockResolvedValueOnce(candidate({
    stageRefresh: {
      applicant_anchor: {
        refreshAttemptId: 'prior-anchor-attempt',
        refreshStartedAt: '2020-08-02T11:00:00.000Z',
      },
      contact: {
        refreshAttemptId: 'prior-contact-attempt',
        refreshStartedAt: '2020-08-02T11:00:01.000Z',
      },
    },
  }));
  await expect(refreshReviewerCandidateStage(target())).resolves.toMatchObject({
    outcome: 'failed_retryable',
    reasonCode: 'prior_refresh_incomplete',
  });
  expect(recoverExpiredStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'applicant_anchor',
    'prior-anchor-attempt',
    expect.any(Object),
  );
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
});

test('an expired contact owner is recovered before an earlier invalidated stage without cross-stage takeover', async () => {
  const leased = candidate({
    isApplicantRecommended: false,
    provenance: { kind: 'proposal_named' },
    affiliation: 'Example University',
    proposalContentVersion: 'f'.repeat(64),
    stageFreshness: {},
    stageRefresh: {
      contact: {
        refreshAttemptId: 'expired-contact-attempt',
        refreshStartedAt: '2020-08-02T11:00:00.000Z',
      },
    },
  });
  const anchorSource = applicantAnchorSourceVersion({ candidate: leased });
  leased.stageFreshness.applicant_anchor = {
    state: 'not_applicable', contractVersion: 1,
    sourceVersion: anchorSource, resultVersion: anchorSource,
    completedAt: '2026-08-02T10:00:00.000Z', reasonCode: 'server_not_applicable',
  };
  const identitySnapshot = buildReviewerStageDependencySnapshot({
    candidate: leased,
    requestId: REQUEST_ID,
    proposalContentVersion: 'a'.repeat(64),
  });
  leased.stageFreshness.identity = {
    state: 'current', contractVersion: 4,
    sourceVersion: identitySnapshot.stageInputVersions.identity,
    resultVersion: 'c'.repeat(64),
    completedAt: '2026-08-02T11:00:00.000Z',
  };
  findCandidateByKey.mockResolvedValue(leased);

  const result = await refreshReviewerCandidateStage(target({ stage: 'contact' }));

  expect(result).toMatchObject({
    outcome: 'failed_retryable',
    stage: 'contact',
    stageState: 'incomplete',
    reasonCode: 'prior_refresh_incomplete',
    candidatePlan: {
      refreshes: expect.arrayContaining([
        expect.objectContaining({ stage: 'institution_domains', reason: 'stage_missing' }),
        expect.objectContaining({ stage: 'contact', reason: 'prior_refresh_incomplete' }),
      ]),
    },
  });
  expect(result.candidatePlan.refreshes[0]).toMatchObject({
    stage: 'contact', reason: 'prior_refresh_incomplete', action: 'recover_expired_lease',
  });
  expect(recoverExpiredStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'contact',
    'expired-contact-attempt',
    expect.objectContaining({
      leaseMs: expect.any(Number),
      expectedSourceVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    }),
  );
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
});

test('clears only an expired same-stage contact lease with a server-derived incomplete marker when proposal invalidation makes normal inputs unavailable', async () => {
  const leased = candidate({
    isApplicantRecommended: false,
    provenance: { kind: 'proposal_named' },
    affiliation: 'Example University',
    stageRefresh: {
      contact: {
        refreshAttemptId: 'expired-contact-attempt',
        refreshStartedAt: '2020-08-02T11:00:00.000Z',
      },
    },
    stageFreshness: {},
  });
  const anchorSource = applicantAnchorSourceVersion({ candidate: leased });
  leased.stageFreshness.applicant_anchor = {
    state: 'not_applicable', contractVersion: 1,
    sourceVersion: anchorSource, resultVersion: anchorSource,
    completedAt: '2026-08-02T10:00:00.000Z', reasonCode: 'server_not_applicable', failureCode: null,
  };
  const beforeInvalidation = buildReviewerStageDependencySnapshot({
    candidate: leased,
    requestId: REQUEST_ID,
    proposalContentVersion: 'a'.repeat(64),
  });
  leased.stageFreshness.identity = {
    state: 'current', contractVersion: 4,
    sourceVersion: beforeInvalidation.stageInputVersions.identity,
    resultVersion: 'c'.repeat(64),
    completedAt: '2026-08-02T11:00:00.000Z', reasonCode: null, failureCode: null,
  };
  // The authoritative Graph metadata no longer binds a proposal.  The normal
  // contact source is therefore intentionally underivable; this must not
  // strand the old contact lease or invoke a provider to recover it.
  resolveReviewerProposalMetadata.mockResolvedValue({
    state: 'stale', reasonCode: 'proposal_binding_changed', proposalContentVersion: null,
  });
  findCandidateByKey.mockResolvedValue(leased);

  await expect(refreshReviewerCandidateStage(target({ stage: 'contact' }))).resolves.toMatchObject({
    outcome: 'failed_retryable',
    stage: 'contact',
    stageState: 'incomplete',
    reasonCode: 'prior_refresh_incomplete',
  });
  expect(recoverExpiredStageRefresh).toHaveBeenCalledWith(
    REQUEST_ID,
    CANDIDATE_KEY,
    UPDATED_AT,
    'contact',
    'expired-contact-attempt',
    expect.objectContaining({
      expectedSourceVersion: expiredLeaseRecoverySourceVersion({
        requestId: REQUEST_ID, candidateKey: CANDIDATE_KEY, stage: 'contact',
      }),
    }),
  );
  expect(startStageRefresh).not.toHaveBeenCalled();
  expect(completeStageRefreshWithEvidence).not.toHaveBeenCalled();
  expect(enrichRecommended).not.toHaveBeenCalled();
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(analyzeProposal).not.toHaveBeenCalled();
});
