/**
 * @jest-environment node
 *
 * C2's pre-extraction route oracle. Keep these assertions independent of the
 * extracted service: they exercise the real handler with controlled edges and
 * pin its response bodies, ordering, auth provenance, and failure boundaries.
 */
const mockTrace = [];
const mockRequireAppAccess = jest.fn();
const mockWithDalContext = jest.fn();
const mockMeasurementEnabled = jest.fn();
const mockRecordInstitutionMeasurement = jest.fn();
const mockVerifyIdentity = jest.fn();
const mockVerifyInstitution = jest.fn();
const mockReconcile = jest.fn();
const mockValidatePromotion = jest.fn();
const mockResolvePI = jest.fn();
const mockFetchCoPIs = jest.fn();
const mockListRepairRequests = jest.fn();

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: (...args) => mockRequireAppAccess(...args) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (...args) => mockWithDalContext(...args) }));
jest.mock('../../lib/services/reviewer-institution-measurement', () => ({
  measurementEnabled: (...args) => mockMeasurementEnabled(...args),
  recordInstitutionMeasurement: (...args) => mockRecordInstitutionMeasurement(...args),
}));
jest.mock('../../lib/services/reviewer-candidate-attestation', () => ({
  createServerIdentityDecisionReceipt: jest.fn(() => ({ version: 'identity-receipt' })),
  hasServerIdentityDecisionReceipt: jest.fn(() => false),
  verifyAutomatedIdentityAttestation: (...args) => mockVerifyIdentity(...args),
}));
jest.mock('../../lib/services/reviewer-institution-evidence-attestation', () => ({
  createServerInstitutionEvidenceReceipt: jest.fn(() => ({ version: 'institution-receipt' })),
  hasServerInstitutionEvidenceReceipt: jest.fn(() => false),
  institutionEvidenceProjection: jest.fn(() => ({ independentIdentity: null, affiliationAssertions: [] })),
  verifyInstitutionEvidenceAttestation: (...args) => mockVerifyInstitution(...args),
}));
jest.mock('../../lib/services/proposal-pi-identity', () => ({ resolveProposalPI: (...args) => mockResolvePI(...args) }));
jest.mock('../../lib/services/proposal-participants', () => ({ fetchCoPIs: (...args) => mockFetchCoPIs(...args) }));
jest.mock('../../lib/services/reviewer-address-trust-service', () => ({
  listOpenAddressRepairRequests: (...args) => mockListRepairRequests(...args),
}));
jest.mock('../../lib/services/workbench/reviewer-roster-projection-service', () => ({
  reconcileRosterEngagement: (...args) => mockReconcile(...args),
  validateRosterPromotionEngagement: (...args) => mockValidatePromotion(...args),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  listForRequest: jest.fn(),
  recordSurfaced: jest.fn(),
  setExcluded: jest.fn(),
  promote: jest.fn(),
  confirmIdentity: jest.fn(),
  updateContactDraft: jest.fn(),
  findCandidateBySuggestionAnchor: jest.fn(),
  findCandidatesByKeys: jest.fn(),
  removePreviousActiveSearchResults: jest.fn(),
}));

import handler from '../../pages/api/workbench/reviewer-roster';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import * as store from '../../lib/services/reviewer-roster-store';

const REQ = '11111111-1111-1111-1111-111111111111';
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
async function waitFor(predicate) {
  for (let i = 0; i < 30 && !predicate(); i += 1) await Promise.resolve();
  if (!predicate()) throw new Error('condition did not settle');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTrace.length = 0;
  mockRequireAppAccess.mockResolvedValue({ profileId: 41, session: { user: { dynamicsSystemuserId: 'SYS-41' } } });
  mockWithDalContext.mockImplementation(async (label, callback) => {
    mockTrace.push(`dal:${label}:enter`);
    const result = await callback();
    mockTrace.push(`dal:${label}:exit`);
    return result;
  });
  mockMeasurementEnabled.mockReturnValue(false);
  mockRecordInstitutionMeasurement.mockResolvedValue(undefined);
  mockVerifyIdentity.mockResolvedValue({ valid: false, reason: 'no_token' });
  mockVerifyInstitution.mockResolvedValue({ valid: false, reason: 'no_token' });
  mockReconcile.mockImplementation(async ({ roster }) => roster);
  mockValidatePromotion.mockResolvedValue({ allowed: true });
  mockResolvePI.mockImplementation(async () => {
    mockTrace.push('author:resolve-pi');
    return { canonicalName: 'Patricia Investigator', contactName: 'Patricia Investigator' };
  });
  mockFetchCoPIs.mockImplementation(async () => {
    mockTrace.push('author:fetch-copis');
    return ['Casey Collaborator'];
  });
  mockListRepairRequests.mockResolvedValue([]);
  store.listForRequest.mockResolvedValue({ active: [], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [] });
  store.recordSurfaced.mockResolvedValue(0);
  store.setExcluded.mockResolvedValue(undefined);
  store.promote.mockResolvedValue({ name: 'Bob Roe', candidateKey: 'candidate:bob' });
  store.confirmIdentity.mockResolvedValue({ confirmationId: 'confirmation-41', candidate: { name: 'Morgan Analyst' } });
  store.updateContactDraft.mockResolvedValue({ name: 'Morgan Analyst', candidateKey: 'candidate:morgan' });
  store.findCandidateBySuggestionAnchor.mockResolvedValue(null);
  store.findCandidatesByKeys.mockResolvedValue([]);
  store.removePreviousActiveSearchResults.mockResolvedValue({ removed: 0, removedKeys: [], active: [], excluded: [], allNames: [] });
});

describe('pre-extraction shell contract', () => {
  it('keeps authentication before method dispatch, outside the catch, and returns the exact 405 body', async () => {
    const deniedResponse = response();
    mockRequireAppAccess.mockResolvedValueOnce(null);
    await handler({ method: 'GET', query: { requestId: REQ } }, deniedResponse);
    expect(store.listForRequest).not.toHaveBeenCalled();

    const thrownResponse = response();
    mockRequireAppAccess.mockRejectedValueOnce(new Error('auth unavailable'));
    await expect(handler({ method: 'GET', query: { requestId: REQ } }, thrownResponse)).rejects.toThrow('auth unavailable');
    expect(thrownResponse.body).toBeNull();

    const methodResponse = response();
    await handler({ method: 'PUT' }, methodResponse);
    expect(mockRequireAppAccess).toHaveBeenCalledTimes(3);
    expect(methodResponse.statusCode).toBe(405);
    expect(methodResponse.body).toEqual({ error: 'Method not allowed' });
  });

  it('pins GET spread precedence, the exact response body, and list/reconcile/repair order', async () => {
    const roster = { active: [{ name: 'Morgan', candidateKey: 'candidate:morgan' }], allNames: ['Morgan'] };
    store.listForRequest.mockImplementationOnce(async () => { mockTrace.push('store:list'); return roster; });
    mockReconcile.mockImplementationOnce(async () => {
      mockTrace.push('engagement:reconcile');
      return {
        success: false,
        active: ['reconciled'],
        allNames: ['Morgan'],
        handled: [],
        repairRequests: ['stale-repair'],
        repairRequestsUnavailable: true,
      };
    });
    mockListRepairRequests.mockImplementationOnce(async () => { mockTrace.push('repair:list'); return ['repair']; });
    const r = response();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({
      success: false,
      active: ['reconciled'],
      allNames: ['Morgan'],
      handled: [],
      repairRequests: ['repair'],
      repairRequestsUnavailable: false,
    });
    expect(Object.keys(r.body)).toEqual(['success', 'active', 'allNames', 'handled', 'repairRequests', 'repairRequestsUnavailable']);
    expect(mockTrace).toEqual([
      'store:list',
      'dal:workbench-reviewer-roster-get:enter',
      'engagement:reconcile',
      'dal:workbench-reviewer-roster-get:exit',
      'repair:list',
    ]);
  });

  it('distinguishes GET primary reconciliation failure from supplemental repair failure', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockReconcile.mockRejectedValueOnce(new Error('reconcile unavailable'));
      const primaryFailure = response();
      await handler({ method: 'GET', query: { requestId: REQ } }, primaryFailure);
      expect(primaryFailure.statusCode).toBe(500);
      expect(primaryFailure.body).toEqual({ error: 'Reviewer roster operation failed' });
      expect(errorLog).toHaveBeenCalledWith('reviewer-roster error:', 'reconcile unavailable');

      store.listForRequest.mockResolvedValueOnce({ active: ['roster-row'] });
      mockReconcile.mockResolvedValueOnce({ active: ['roster-row'], handled: [] });
      mockListRepairRequests.mockRejectedValueOnce(new Error('repair unavailable'));
      const supplementalFailure = response();
      await handler({ method: 'GET', query: { requestId: REQ } }, supplementalFailure);
      expect(supplementalFailure.statusCode).toBe(200);
      expect(supplementalFailure.body).toEqual({
        success: true,
        active: ['roster-row'],
        handled: [],
        repairRequests: [],
        repairRequestsUnavailable: true,
      });
      expect(errorLog).toHaveBeenCalledWith('reviewer-roster repair request lookup failed:', 'repair unavailable');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('pins POST validation bodies and validates scope before array and cap checks', async () => {
    const cases = [
      [{ requestId: 'bad', candidates: null }, 400, { error: 'Valid requestId (GUID) is required' }],
      [{ requestId: REQ }, 400, { error: 'candidates[] is required' }],
      [{ requestId: REQ, candidates: Array.from({ length: 101 }, () => ({ name: 'R' })) }, 400, { error: 'Too many candidates (max 100)' }],
      [{ requestId: REQ, candidates: [{ name: 'Applicant', suggestionId: REQ }] }, 400, {
        error: 'Applicant-recommended roster rows are server-managed',
        code: 'server_managed_applicant_candidate',
      }],
    ];
    for (const [body, status, expected] of cases) {
      const r = response();
      await handler({ method: 'POST', body }, r);
      expect(r.statusCode).toBe(status);
      expect(r.body).toEqual(expected);
    }
    expect(store.recordSurfaced).not.toHaveBeenCalled();
  });

  it('starts POST candidates concurrently, verifies receipts sequentially per candidate, and waits before recording', async () => {
    const alphaGate = deferred();
    const betaGate = deferred();
    mockVerifyIdentity.mockImplementation(async (_token, { candidate }) => {
      mockTrace.push(`identity:${candidate.name}`);
      await (candidate.name === 'Alpha Analyst' ? alphaGate.promise : betaGate.promise);
      return { valid: false, reason: 'no_token' };
    });
    mockVerifyInstitution.mockImplementation(async (_token, { candidate }) => {
      mockTrace.push(`institution:${candidate.name}`);
      return { valid: false, reason: 'no_token' };
    });
    store.recordSurfaced.mockImplementationOnce(async (_requestId, candidates, options) => {
      mockTrace.push('store:record');
      expect(options.includeOutcomes).toBe(true);
      return {
        recorded: candidates.length,
        outcomes: candidates.map((candidate, inputIndex) => ({
          inputIndex,
          candidateKey: candidate.candidateKey,
          status: 'recorded',
        })),
      };
    });
    const r = response();
    const pending = handler({ method: 'POST', body: { requestId: REQ, candidates: [
      { name: 'Alpha Analyst', affiliation: 'North University' },
      { name: 'Beta Analyst', affiliation: 'South University' },
    ] } }, r);

    await waitFor(() => mockTrace.includes('identity:Alpha Analyst') && mockTrace.includes('identity:Beta Analyst'));
    expect(store.recordSurfaced).not.toHaveBeenCalled();
    alphaGate.resolve();
    await waitFor(() => mockTrace.includes('institution:Alpha Analyst'));
    expect(mockTrace).not.toContain('institution:Beta Analyst');
    expect(store.recordSurfaced).not.toHaveBeenCalled();
    betaGate.resolve();
    await pending;

    expect(mockTrace.indexOf('identity:Alpha Analyst')).toBeLessThan(mockTrace.indexOf('institution:Alpha Analyst'));
    expect(mockTrace.indexOf('identity:Beta Analyst')).toBeLessThan(mockTrace.indexOf('institution:Beta Analyst'));
    expect(mockTrace.indexOf('institution:Alpha Analyst')).toBeLessThan(mockTrace.indexOf('store:record'));
    expect(mockTrace.indexOf('institution:Beta Analyst')).toBeLessThan(mockTrace.indexOf('store:record'));
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({
      success: true,
      recorded: 2,
      outcomes: [
        { inputIndex: 0, candidateKey: expect.any(String), status: 'recorded' },
        { inputIndex: 1, candidateKey: expect.any(String), status: 'recorded' },
      ],
    });
  });

  it.each([
    ['missing', undefined],
    ['padded', ' suggestion:66666666-6666-6666-6666-666666666666 '],
    ['mismatched', 'legacy-row:wrong'],
  ])('rejects an applicant exclude when its raw submitted candidateKey is %s', async (_label, candidateKey) => {
    const suggestionId = '66666666-6666-6666-6666-666666666666';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      isApplicantRecommended: true,
    });
    const candidate = { name: 'Applicant Reviewer', suggestionId, isApplicantRecommended: true };
    if (candidateKey !== undefined) candidate.candidateKey = candidateKey;
    const r = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude', candidate } }, r);

    expect(store.findCandidateBySuggestionAnchor).toHaveBeenCalledWith(REQ, suggestionId);
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'Applicant reviewer row is stale or missing; reload before excluding it.' });
    expect(store.setExcluded).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['padded', ' suggestion:66666666-6666-6666-6666-666666666666 '],
    ['mismatched', 'legacy-row:wrong'],
  ])('rejects applicant identity confirmation when the raw submitted candidateKey is %s', async (_label, candidateKey) => {
    const suggestionId = '66666666-6666-6666-6666-666666666666';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      isApplicantRecommended: true,
    });
    const candidate = { name: 'Applicant Reviewer', email: 'person@example.edu', suggestionId, isApplicantRecommended: true };
    if (candidateKey !== undefined) candidate.candidateKey = candidateKey;
    const r = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'confirm_identity', candidate } }, r);

    expect(store.findCandidateBySuggestionAnchor).toHaveBeenCalledWith(REQ, suggestionId);
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'Applicant reviewer row is stale or missing; reload before confirming identity.' });
    expect(store.confirmIdentity).not.toHaveBeenCalled();
  });

  it('pins exact PATCH validation and server-owned transition envelopes', async () => {
    const cases = [
      [{ requestId: 'bad', action: 'saved' }, 400, { error: 'Valid requestId (GUID) is required' }],
      [{ requestId: REQ, action: 'exclude' }, 400, { error: 'candidate (with name) is required to exclude' }],
      [{ requestId: REQ, action: 'promote' }, 400, { error: 'candidateKey is required to promote' }],
      [{ requestId: REQ, action: 'saved' }, 409, {
        error: 'Roster saved state is server-owned; use the reviewer promotion endpoint.',
        code: 'server_owned_transition',
      }],
      [{ requestId: REQ, action: 'confirm_identity', candidate: { name: 'Morgan Analyst' } }, 400, {
        error: 'candidate name and email are required to confirm identity',
      }],
      [{ requestId: REQ, action: 'update_contact_draft', candidateKey: 'candidate:morgan', updates: { email: 'x@example.edu' } }, 400, {
        error: 'updates must contain only website and/or affiliation',
        code: 'invalid_contact_draft',
      }],
      [{ requestId: REQ, action: 'update_contact_draft', candidateKey: 'candidate:morgan', updates: { website: 'javascript:alert(1)' } }, 400, {
        error: 'website must be an http(s) profile page, not a document link',
        code: 'invalid_contact_draft',
      }],
      [{ requestId: REQ, action: 'remove_previous_results' }, 400, {
        error: 'candidateRefs[] must contain 1-300 valid key/timestamp pairs',
      }],
      [{ requestId: REQ, action: 'not-a-real-action' }, 400, {
        error: 'Unknown action (expected exclude | promote | saved | confirm_identity | update_contact_draft | remove_previous_results)',
      }],
    ];
    for (const [body, status, expected] of cases) {
      const r = response();
      await handler({ method: 'PATCH', body }, r);
      expect(r.statusCode).toBe(status);
      expect(r.body).toEqual(expected);
    }
    expect(store.setExcluded).not.toHaveBeenCalled();
    expect(store.promote).not.toHaveBeenCalled();
    expect(store.confirmIdentity).not.toHaveBeenCalled();
    expect(store.updateContactDraft).not.toHaveBeenCalled();
    expect(store.removePreviousActiveSearchResults).not.toHaveBeenCalled();
  });

  it('pins promotion precheck, authority, and lost-race error bodies plus success shape', async () => {
    const stale = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:missing' } }, stale);
    expect(stale.statusCode).toBe(409);
    expect(stale.body).toEqual({
      success: false,
      error: 'Candidate is no longer excluded; reload the reviewer roster.',
      code: 'candidate_not_excluded',
    });

    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Handled Reviewer', candidateKey: 'suggestion:88888888-8888-8888-8888-888888888888',
      suggestionId: '88888888-8888-8888-8888-888888888888', rosterStatus: 'excluded',
    }]);
    mockValidatePromotion.mockResolvedValueOnce({
      allowed: false, code: 'reviewer_already_handled', stage: 'declined',
      error: 'This reviewer has already entered the engagement lifecycle.',
    });
    const denied = response();
    await handler({ method: 'PATCH', body: {
      requestId: REQ, action: 'promote', candidateKey: 'suggestion:88888888-8888-8888-8888-888888888888',
    } }, denied);
    expect(denied.statusCode).toBe(409);
    expect(denied.body).toEqual({
      success: false,
      allowed: false,
      code: 'reviewer_already_handled',
      stage: 'declined',
      error: 'This reviewer has already entered the engagement lifecycle.',
    });
    expect(store.promote).not.toHaveBeenCalled();

    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Excluded Analyst', candidateKey: 'candidate:excluded', rosterStatus: 'excluded',
    }]);
    store.promote.mockResolvedValueOnce(null);
    const lostRace = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:excluded' } }, lostRace);
    expect(lostRace.statusCode).toBe(409);
    expect(lostRace.body).toEqual({
      success: false,
      error: 'Candidate is no longer excluded; reload the reviewer roster.',
      code: 'candidate_not_excluded',
    });

    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Excluded Analyst', candidateKey: 'candidate:excluded', rosterStatus: 'excluded',
    }]);
    store.promote.mockResolvedValueOnce({ name: 'Excluded Analyst', candidateKey: 'candidate:excluded', rosterStatus: 'active' });
    const success = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:excluded' } }, success);
    expect(success.statusCode).toBe(200);
    expect(success.body).toEqual({
      success: true,
      candidate: { name: 'Excluded Analyst', candidateKey: 'candidate:excluded', rosterStatus: 'active' },
    });
  });

  it('pins exact responses for exclusion and previous-result removal', async () => {
    const excluded = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude', candidate: { name: 'Morgan Analyst' } } }, excluded);
    expect(excluded.statusCode).toBe(200);
    expect(excluded.body).toEqual({ success: true });

    const candidateRefs = [{ candidateKey: 'candidate:old', updatedAt: '2026-10-01T10:00:00Z' }];
    const removed = response();
    store.removePreviousActiveSearchResults.mockResolvedValueOnce({
      removed: 1, removedKeys: ['candidate:old'], active: [], excluded: [], allNames: [],
    });
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'remove_previous_results', candidateRefs } }, removed);
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({
      success: true, removed: 1, removedKeys: ['candidate:old'], active: [], excluded: [], allNames: [],
    });
    expect(store.removePreviousActiveSearchResults).toHaveBeenCalledWith(REQ, candidateRefs);
  });

  it('checks submitted and stored names against proposal authors and maps only authenticated actor IDs', async () => {
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Casey Collaborator',
      candidateKey: 'candidate:renamed',
    }]);
    const r = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'confirm_identity', candidate: {
      name: 'Renamed Person',
      email: 'renamed@example.edu',
      candidateKey: 'candidate:renamed',
    } } }, r);
    expect(mockResolvePI).toHaveBeenCalledWith(REQ);
    expect(mockFetchCoPIs).toHaveBeenCalledWith(REQ);
    expect(r.statusCode).toBe(422);
    expect(r.body).toEqual({
      success: false,
      error: 'Proposal authors cannot be added as reviewers for their own request.',
      code: 'proposal_author_candidate',
    });
    expect(store.confirmIdentity).not.toHaveBeenCalled();

    store.findCandidatesByKeys.mockResolvedValueOnce([]);
    const accepted = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'confirm_identity', candidate: {
      name: 'Morgan Analyst',
      email: 'morgan@example.edu',
      candidateKey: 'candidate:morgan',
    }, actor: { profileId: 999 }, actorProfileId: 999 } }, accepted);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toEqual({
      success: true,
      confirmationId: 'confirmation-41',
      candidate: { name: 'Morgan Analyst' },
    });
    expect(store.confirmIdentity).toHaveBeenCalledWith(
      REQ,
      expect.objectContaining({ name: 'Morgan Analyst', email: 'morgan@example.edu', emailSource: 'manual' }),
      { actorProfileId: 41, actorSystemUserId: 'SYS-41' },
    );
    expect(mockTrace.indexOf('author:resolve-pi')).toBeLessThan(mockTrace.indexOf('author:fetch-copis'));
  });

  it('keeps store work outside each narrow DAL callback and preserves PI-before-CoPI order', async () => {
    store.listForRequest.mockImplementationOnce(async () => {
      mockTrace.push('store:list');
      return { active: [], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [] };
    });
    mockReconcile.mockImplementationOnce(async () => { mockTrace.push('engagement:reconcile'); return { active: [], handled: [] }; });
    mockListRepairRequests.mockImplementationOnce(async () => { mockTrace.push('repair:list'); return []; });
    await handler({ method: 'GET', query: { requestId: REQ } }, response());
    expect(mockTrace).toEqual([
      'store:list',
      'dal:workbench-reviewer-roster-get:enter',
      'engagement:reconcile',
      'dal:workbench-reviewer-roster-get:exit',
      'repair:list',
    ]);

    mockTrace.length = 0;
    store.findCandidatesByKeys.mockImplementationOnce(async () => {
      mockTrace.push('store:find-promotion-row');
      return [{ name: 'Excluded Analyst', candidateKey: 'candidate:excluded', rosterStatus: 'excluded' }];
    });
    mockValidatePromotion.mockImplementationOnce(async () => {
      mockTrace.push('engagement:validate-promotion');
      return { allowed: true };
    });
    store.promote.mockImplementationOnce(async () => { mockTrace.push('store:promote'); return { name: 'Excluded Analyst' }; });
    mockMeasurementEnabled.mockImplementationOnce(() => { mockTrace.push('measurement:enabled'); return false; });
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:excluded' } }, response());
    expect(mockTrace).toEqual([
      'store:find-promotion-row',
      'dal:workbench-reviewer-roster-promote:enter',
      'engagement:validate-promotion',
      'dal:workbench-reviewer-roster-promote:exit',
      'store:promote',
      'measurement:enabled',
    ]);

    mockTrace.length = 0;
    store.findCandidatesByKeys.mockImplementationOnce(async () => {
      mockTrace.push('store:find-confirm-row');
      return [];
    });
    store.confirmIdentity.mockImplementationOnce(async () => {
      mockTrace.push('store:confirm');
      return { confirmationId: 'confirmation-41', candidate: { name: 'Morgan Analyst' } };
    });
    mockMeasurementEnabled.mockImplementationOnce(() => { mockTrace.push('measurement:enabled'); return false; });
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'confirm_identity', candidate: {
      name: 'Morgan Analyst', email: 'morgan@example.edu', candidateKey: 'candidate:morgan',
    } } }, response());
    expect(mockTrace).toEqual([
      'store:find-confirm-row',
      'dal:workbench-reviewer-roster-confirm-author-check:enter',
      'author:resolve-pi',
      'author:fetch-copis',
      'dal:workbench-reviewer-roster-confirm-author-check:exit',
      'store:confirm',
      'measurement:enabled',
    ]);
  });

  it('leaves unrelated ServiceHttpError dependencies on the generic 500 path', async () => {
    store.listForRequest.mockRejectedValueOnce(new ServiceHttpError('dependency says no', {
      httpStatus: 418,
      body: { error: 'dependency-specific body', code: 'dependency_error' },
    }));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = response();
      await handler({ method: 'GET', query: { requestId: REQ } }, r);
      expect(r.statusCode).toBe(500);
      expect(r.body).toEqual({ error: 'Reviewer roster operation failed' });
      expect(errorLog).toHaveBeenCalledWith('reviewer-roster error:', 'dependency says no');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('preserves the existing null-rejection catch failure instead of normalizing it', async () => {
    store.listForRequest.mockRejectedValueOnce(null);
    const r = response();
    await expect(handler({ method: 'GET', query: { requestId: REQ } }, r)).rejects.toThrow(TypeError);
    expect(r.body).toBeNull();
  });

  it('preserves the measurementEnabled throw boundary after the write', async () => {
    mockMeasurementEnabled.mockImplementationOnce(() => { throw new Error('measurement flag failed'); });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const r = response();
      await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude', candidate: { name: 'Morgan Analyst' } } }, r);
      expect(store.setExcluded).toHaveBeenCalledTimes(1);
      expect(r.statusCode).toBe(500);
      expect(r.body).toEqual({ error: 'Reviewer roster operation failed' });
      expect(errorLog).toHaveBeenCalledWith('reviewer-roster error:', 'measurement flag failed');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('awaits enabled exclusion measurement and preserves success when recording rejects', async () => {
    const stored = { name: 'Morgan Analyst', candidateKey: 'candidate:morgan', rosterStatus: 'excluded' };
    mockMeasurementEnabled.mockReturnValue(true);
    store.findCandidatesByKeys.mockResolvedValueOnce([]).mockResolvedValueOnce([stored]);
    const measurement = deferred();
    mockRecordInstitutionMeasurement.mockImplementationOnce(async () => {
      await measurement.promise;
      throw Object.assign(new Error('measurement unavailable'), { code: 'METRIC_FAILURE' });
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = response();
      const operation = handler({ method: 'PATCH', body: {
        requestId: REQ, action: 'exclude', candidate: { name: stored.name, candidateKey: stored.candidateKey },
      } }, r);
      await waitFor(() => mockRecordInstitutionMeasurement.mock.calls.length === 1);
      expect(store.setExcluded).toHaveBeenCalledTimes(1);
      expect(r.body).toBeNull();
      expect(mockRecordInstitutionMeasurement).toHaveBeenCalledWith({
        requestId: REQ, candidate: stored, eventType: 'staff_excluded', captureSource: 'stored_roster',
      });
      measurement.resolve();
      await operation;
      expect(warn).toHaveBeenCalledWith('[reviewer-roster] institution measurement unavailable:', 'METRIC_FAILURE');
      expect(r.statusCode).toBe(200);
      expect(r.body).toEqual({ success: true });
    } finally {
      measurement.resolve();
      warn.mockRestore();
    }
  });

  it('does not record enabled exclusion measurement when the stored status no longer matches', async () => {
    const stored = { name: 'Morgan Analyst', candidateKey: 'candidate:morgan', rosterStatus: 'active' };
    mockMeasurementEnabled.mockReturnValue(true);
    store.findCandidatesByKeys.mockResolvedValueOnce([]).mockResolvedValueOnce([stored]);
    const r = response();
    await handler({ method: 'PATCH', body: {
      requestId: REQ, action: 'exclude', candidate: { name: stored.name, candidateKey: stored.candidateKey },
    } }, r);
    expect(store.setExcluded).toHaveBeenCalledTimes(1);
    expect(store.findCandidatesByKeys).toHaveBeenCalledTimes(2);
    expect(store.findCandidatesByKeys).toHaveBeenLastCalledWith(REQ, [stored.candidateKey]);
    expect(mockRecordInstitutionMeasurement).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true });
  });

  it('preserves omitted versus explicit null contact-draft fields and exact rejection envelopes', async () => {
    const omitted = response();
    await handler({ method: 'PATCH', body: {
      requestId: REQ, action: 'update_contact_draft', candidateKey: 'candidate:morgan', updates: { website: null },
    } }, omitted);
    expect(omitted.statusCode).toBe(200);
    expect(store.updateContactDraft).toHaveBeenCalledWith(REQ, 'candidate:morgan', { website: null });

    const badScope = response();
    await handler({ method: 'PATCH', body: {
      requestId: 'invalid', action: 'not-a-real-action',
    } }, badScope);
    expect(badScope.statusCode).toBe(400);
    expect(badScope.body).toEqual({ error: 'Valid requestId (GUID) is required' });

    const badAction = response();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'not-a-real-action' } }, badAction);
    expect(badAction.statusCode).toBe(400);
    expect(badAction.body).toEqual({
      error: 'Unknown action (expected exclude | promote | saved | confirm_identity | update_contact_draft | remove_previous_results)',
    });
  });
});
