/**
 * @jest-environment node
 *
 * /api/workbench/reviewer-roster (S224) — auth gate, GUID validation, method
 * dispatch, and payload contracts. The store is mocked; `pruneCandidateForRoster`
 * runs for real (pure) so we also confirm the route prunes server-side.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 5 })) }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, operation) => operation()),
}));
jest.mock('../../lib/services/reviewer-candidate-attestation', () => {
  const actual = jest.requireActual('../../lib/services/reviewer-candidate-attestation');
  return {
    ...actual,
    verifyAutomatedIdentityAttestation: jest.fn(async () => ({ valid: false, reason: 'no_token' })),
  };
});
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  listForRequest: jest.fn(async () => ({ active: [], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [] })),
  recordSurfaced: jest.fn(async () => 0),
  setExcluded: jest.fn(async () => {}),
  promote: jest.fn(async () => ({ name: 'Bob Roe' })),
  confirmIdentity: jest.fn(async () => ({ confirmationId: 'confirm-1', candidate: { name: 'Ann Lee' } })),
  markSaved: jest.fn(async () => 1),
  findCandidateBySuggestion: jest.fn(async () => null),
  // S387: the roster route resolves an applicant row by its Dataverse ANCHOR, so an
  // anchor-stamped row still carrying a pre-anchor placeholder key can be excluded /
  // marked saved / identity-confirmed instead of 409-ing with no way forward.
  findCandidateBySuggestionAnchor: jest.fn(async () => null),
  findCandidatesByKeys: jest.fn(async () => []),
  removePreviousActiveSearchResults: jest.fn(async () => ({
    removed: 2,
    removedKeys: ['candidate:old-a', 'candidate:old-b'],
    active: [{ name: 'Applicant Person', provenance: { kind: 'applicant_suggested' } }],
    excluded: [{ name: 'Excluded Person' }],
    allNames: ['Applicant Person', 'Excluded Person', 'Saved Person'],
  })),
}));
const mockReconcileRosterEngagement = jest.fn(async ({ roster }) => roster);
const mockValidateRosterPromotionEngagement = jest.fn(async () => ({ allowed: true }));
jest.mock('../../lib/services/workbench/reviewer-roster-projection-service', () => ({
  reconcileRosterEngagement: (...args) => mockReconcileRosterEngagement(...args),
  validateRosterPromotionEngagement: (...args) => mockValidateRosterPromotionEngagement(...args),
}));
const mockReadReviewerWarmValidation = jest.fn(async () => ({
  state: 'current',
  reasonCode: null,
  proposalContentVersion: 'p'.repeat(64),
  applicantInputVersion: 'a'.repeat(64),
  inputSummary: {
    recommendationSlotCount: 0,
    hasExclusions: false,
    hasPi: false,
    hasApplicantOrganization: false,
  },
  candidatePlans: [],
}));
jest.mock('../../lib/services/workbench/reviewer-warm-validation-service', () => ({
  readReviewerWarmValidation: (...args) => mockReadReviewerWarmValidation(...args),
}));
const mockConfirmStructuredRosterIdentity = jest.fn(async () => ({
  success: true,
  confirmationId: 'confirm-1',
  candidate: { name: 'Ann Lee' },
  remediation: [],
}));
jest.mock('../../lib/services/reviewer-address-trust-service', () => ({
  confirmStructuredRosterIdentity: (...args) => mockConfirmStructuredRosterIdentity(...args),
}));

import handler from '../../pages/api/workbench/reviewer-roster';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  hasServerIdentityDecisionReceipt,
  verifyAutomatedIdentityAttestation,
} from '../../lib/services/reviewer-candidate-attestation';
import * as store from '../../lib/services/reviewer-roster-store';
import { reviewerCandidateKey } from '../../shared/components/reviewers/reviewer-search-logic';
import { OBSERVATION_HEADER } from '../../lib/services/workbench/reviewer-find-warm-observation';

const REQ = '11111111-1111-1111-1111-111111111111';
const OBSERVATION_ID = 'rfw_0123456789abcdef0123456789abcdef';
const SERVER_STAFF_IDENTITY_AUTHORITY = {
  state: 'confirmed',
  canonicalPersonId: '22222222-2222-4222-8222-222222222222',
  canonicalPersonEtag: 'W/"person-v1"',
  actorId: 'system-5',
  confirmedAt: '2026-08-02T00:00:00.000Z',
};

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 5 });
  verifyAutomatedIdentityAttestation.mockResolvedValue({ valid: false, reason: 'no_token' });
  store.findCandidateBySuggestion.mockResolvedValue(null);
  store.findCandidateBySuggestionAnchor.mockResolvedValue(null);
  store.findCandidatesByKeys.mockResolvedValue([]);
  mockConfirmStructuredRosterIdentity.mockResolvedValue({
    success: true,
    confirmationId: 'confirm-1',
    candidate: { name: 'Ann Lee' },
    remediation: [],
  });
  mockValidateRosterPromotionEngagement.mockResolvedValue({ allowed: true });
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('auth', () => {
  it('short-circuits without calling the store when access is denied', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);
    expect(store.listForRequest).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'cached' },
    { mode: 'reconciled', rosterVersion: 'a'.repeat(64) },
  ])('denies $mode requests before mode dispatch or roster reads', async (query) => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ, ...query } }, r);
    expect(store.listForRequest).not.toHaveBeenCalled();
    expect(mockReconcileRosterEngagement).not.toHaveBeenCalled();
    expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), r, 'reviewer-finder', 'reviewers');
  });

  it('does not establish an observation scope before app access succeeds', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler({
      method: 'GET',
      query: { requestId: REQ, mode: 'cached' },
      headers: { [OBSERVATION_HEADER]: OBSERVATION_ID },
    }, r);

    expect(store.listForRequest).not.toHaveBeenCalled();
    expect(console.info.mock.calls.some(([message]) => (
      typeof message === 'string' && message.includes('reviewer_find_warm_observation')
    ))).toBe(false);
  });
});

describe('GET', () => {
  it('400 on a non-GUID requestId', async () => {
    const r = res();
    await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.listForRequest).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'cached' },
    { mode: 'reconciled', rosterVersion: 'a'.repeat(64) },
  ])('validates request scope before dispatching $mode mode', async (query) => {
    const r = res();
    await handler({ method: 'GET', query: { requestId: 'not-a-guid', ...query } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.listForRequest).not.toHaveBeenCalled();
    expect(mockReconcileRosterEngagement).not.toHaveBeenCalled();
    expect(mockReadReviewerWarmValidation).not.toHaveBeenCalled();
    expect(withDalContext).not.toHaveBeenCalled();
  });

  it('lists the roster for a valid requestId', async () => {
    store.listForRequest.mockResolvedValueOnce({ active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] });
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.listForRequest).toHaveBeenCalledWith(REQ);
    expect(mockReconcileRosterEngagement).toHaveBeenCalledWith({
      requestId: REQ,
      roster: { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] },
    });
    expect(r.body.active).toEqual([{ name: 'Ann' }]);
  });

  it('keeps the missing-mode compatibility response on the reconciled path', async () => {
    store.listForRequest.mockResolvedValueOnce({ active: [{ name: 'Ann' }], excluded: [] });
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true, active: [{ name: 'Ann' }], excluded: [] });
    expect(mockReconcileRosterEngagement).toHaveBeenCalledTimes(1);
    expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-roster-get', expect.any(Function));
  });

  it('returns a Postgres-only cached snapshot and never enters Dataverse reconciliation', async () => {
    const roster = { active: [{ name: 'Ann', rosterUpdatedAt: '2026-08-01T00:00:00.000Z' }], excluded: [], allNames: ['Ann'] };
    store.listForRequest.mockResolvedValueOnce(roster);
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, r);

    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({
      success: true,
      authorityState: 'cached',
      rosterVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
      active: roster.active,
      warmTelemetry: expect.objectContaining({ mode: 'cached', reasonCode: 'cached_snapshot' }),
    });
    expect(r.body).not.toHaveProperty('observationAttestation');
    expect(mockReconcileRosterEngagement).not.toHaveBeenCalled();
    expect(withDalContext).not.toHaveBeenCalled();
  });

  it('emits a bounded route observation only for a valid warm GET correlation header', async () => {
    const r = res();
    await handler({
      method: 'GET',
      query: { requestId: REQ, mode: 'cached' },
      headers: { [OBSERVATION_HEADER]: OBSERVATION_ID },
    }, r);

    const events = console.info.mock.calls
      .map(([message]) => {
        try { return JSON.parse(message); } catch { return null; }
      })
      .filter((event) => event?.kind === 'reviewer_find_warm_observation');
    expect(events).toEqual([
      expect.objectContaining({
        observationId: OBSERVATION_ID,
        route: 'reviewer_roster',
        mode: 'cached',
        event: 'start',
      }),
      expect.objectContaining({
        observationId: OBSERVATION_ID,
        route: 'reviewer_roster',
        mode: 'cached',
        event: 'complete',
        reasonCode: 'warm_get_completed',
      }),
    ]);
    expect(r.body.observationAttestation).toEqual({
      scope: 'reviewer_roster_warm_read_only',
      deploymentClass: 'test',
      dataverseTargetClass: 'unknown',
      interlockMode: 'off',
    });
  });

  it('attests the actual deployment, Dataverse target registry class, and interlock mode without a hostname', async () => {
    const prior = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      DYNAMICS_URL: process.env.DYNAMICS_URL,
      DATAVERSE_TARGET_INTERLOCK: process.env.DATAVERSE_TARGET_INTERLOCK,
    };
    let body;
    try {
      process.env.VERCEL_ENV = 'preview';
      process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
      process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
      const r = res();
      await handler({
        method: 'GET',
        query: { requestId: REQ, mode: 'cached' },
        headers: { [OBSERVATION_HEADER]: OBSERVATION_ID },
      }, r);
      body = r.body;
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    expect(body.observationAttestation).toEqual({
      scope: 'reviewer_roster_warm_read_only',
      deploymentClass: 'preview',
      dataverseTargetClass: 'production',
      interlockMode: 'on',
    });
    expect(JSON.stringify(body.observationAttestation)).not.toContain('crm.dynamics.com');
  });

  it('uses the same opaque roster version for the same persisted snapshot', async () => {
    const roster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    store.listForRequest.mockResolvedValue(roster);
    const first = res();
    const second = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, first);
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, second);

    expect(first.body.rosterVersion).toBe(second.body.rosterVersion);
  });

  it('rejects unknown, repeated, and conflicting roster modes before reads', async () => {
    for (const mode of ['unknown', ['cached', 'cached'], ['cached', 'reconciled']]) {
      const r = res();
      await handler({ method: 'GET', query: { requestId: REQ, mode } }, r);
      expect(r.statusCode).toBe(400);
      expect(r.body.code).toBe('invalid_roster_mode');
    }
    expect(store.listForRequest).not.toHaveBeenCalled();
    expect(mockReconcileRosterEngagement).not.toHaveBeenCalled();
  });

  it('reconciles only the supplied cached snapshot inside the trusted DAL context', async () => {
    const roster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    store.listForRequest.mockResolvedValue(roster);
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.body).toMatchObject({
      success: true,
      authorityState: 'current',
      rosterVersion: cached.body.rosterVersion,
      active: roster.active,
      warmTelemetry: expect.objectContaining({ mode: 'reconciled', reasonCode: 'authority_current' }),
    });
    expect(mockReconcileRosterEngagement).toHaveBeenCalledWith({ requestId: REQ, roster });
    expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-roster-get', expect.any(Function));
    expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-roster-warm-validation', expect.any(Function));
    expect(mockReadReviewerWarmValidation).toHaveBeenCalledWith({ requestId: REQ, roster });
    expect(reconciled.body.warmValidation).toMatchObject({
      state: 'current',
      candidatePlans: [],
    });
  });

  it('never forwards a client navigation fileKey into metadata warm validation', async () => {
    const roster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    store.listForRequest.mockResolvedValue(roster);
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
      fileKey: 'akoya_request::Historical::Narrative.pdf',
    } }, reconciled);

    expect(reconciled.statusCode).toBe(200);
    expect(mockReadReviewerWarmValidation).toHaveBeenCalledWith({ requestId: REQ, roster });
    expect(mockReadReviewerWarmValidation.mock.calls[0][0]).not.toHaveProperty('fileKey');
  });

  it('keeps the roster displayable but stale when proposal/input warm validation is incomplete', async () => {
    const roster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    store.listForRequest.mockResolvedValue(roster);
    mockReadReviewerWarmValidation.mockResolvedValueOnce({
      state: 'stale',
      reasonCode: 'proposal_binding_changed',
      proposalContentVersion: null,
      applicantInputVersion: 'a'.repeat(64),
      inputSummary: { recommendationSlotCount: 1, hasExclusions: true, hasPi: true, hasApplicantOrganization: true },
      candidatePlans: [],
    });
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(200);
    expect(reconciled.body).toMatchObject({
      success: true,
      authorityState: 'stale',
      warmValidation: { state: 'stale', reasonCode: 'proposal_binding_changed' },
    });
  });

  it('fails closed when warm validation has an authoritative read error', async () => {
    const roster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    store.listForRequest.mockResolvedValue(roster);
    mockReadReviewerWarmValidation.mockResolvedValueOnce({
      state: 'error',
      reasonCode: 'authority_stale',
      proposalContentVersion: null,
      applicantInputVersion: null,
      inputSummary: null,
      candidatePlans: [],
    });
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(503);
    expect(reconciled.body).toMatchObject({
      success: false,
      authorityState: 'error',
      warmValidation: { state: 'error', reasonCode: 'authority_stale' },
    });
  });

  it('returns a fresh cached snapshot on roster-version conflict without Dataverse work', async () => {
    const cachedRoster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    const changedRoster = { active: [{ name: 'Beth' }], excluded: [], allNames: ['Beth'] };
    store.listForRequest.mockResolvedValueOnce(cachedRoster).mockResolvedValueOnce(changedRoster);
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(409);
    expect(reconciled.body).toMatchObject({
      success: false,
      code: 'roster_snapshot_changed',
      authorityState: 'cached',
      active: changedRoster.active,
      rosterVersion: expect.not.stringMatching(new RegExp(`^${cached.body.rosterVersion}$`)),
    });
    expect(mockReconcileRosterEngagement).not.toHaveBeenCalled();
    expect(withDalContext).not.toHaveBeenCalled();
  });

  it('fails closed when the roster changes during trusted reconciliation', async () => {
    const cachedRoster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    const changedRoster = { active: [{ name: 'Beth' }], excluded: [], allNames: ['Beth'] };
    // Cached request, reconciled preflight, then the post-Dataverse re-read.
    store.listForRequest
      .mockResolvedValueOnce(cachedRoster)
      .mockResolvedValueOnce(cachedRoster)
      .mockResolvedValueOnce(changedRoster);
    mockReconcileRosterEngagement.mockResolvedValueOnce({
      ...cachedRoster,
      handled: [{ candidateKey: 'suggestion:handled', stage: 'invited' }],
    });
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(409);
    expect(reconciled.body).toMatchObject({
      success: false,
      code: 'roster_snapshot_changed',
      authorityState: 'cached',
      active: changedRoster.active,
      rosterVersion: expect.not.stringMatching(new RegExp(`^${cached.body.rosterVersion}$`)),
      warmTelemetry: expect.objectContaining({ snapshotVerificationMs: expect.any(Number) }),
    });
    expect(reconciled.body.handled).toBeUndefined();
    expect(mockReconcileRosterEngagement).toHaveBeenCalledWith({ requestId: REQ, roster: cachedRoster });
    expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-roster-get', expect.any(Function));
    expect(store.listForRequest).toHaveBeenCalledTimes(3);
  });

  it('fails closed when the roster changes while metadata-only warm validation is in flight', async () => {
    const cachedRoster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    const changedRoster = { active: [{ name: 'Beth' }], excluded: [], allNames: ['Beth'] };
    // Cached request, reconciled preflight, then the final recheck after the
    // metadata/applicant reads. The validator is deliberately the mutation
    // window in this fixture.
    store.listForRequest
      .mockResolvedValueOnce(cachedRoster)
      .mockResolvedValueOnce(cachedRoster)
      .mockResolvedValueOnce(changedRoster);
    mockReadReviewerWarmValidation.mockImplementationOnce(async () => ({
      state: 'current',
      reasonCode: null,
      proposalContentVersion: 'p'.repeat(64),
      applicantInputVersion: 'a'.repeat(64),
      inputSummary: { recommendationSlotCount: 0, hasExclusions: false, hasPi: false, hasApplicantOrganization: false },
      candidatePlans: [],
    }));
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(409);
    expect(reconciled.body).toMatchObject({
      code: 'roster_snapshot_changed',
      authorityState: 'cached',
      active: changedRoster.active,
    });
    expect(mockReadReviewerWarmValidation).toHaveBeenCalledWith({ requestId: REQ, roster: cachedRoster });
    expect(store.listForRequest).toHaveBeenCalledTimes(3);
  });

  it('returns snapshot conflict over a Dataverse error when the roster changed concurrently', async () => {
    const cachedRoster = { active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] };
    const changedRoster = { active: [{ name: 'Beth' }], excluded: [], allNames: ['Beth'] };
    store.listForRequest
      .mockResolvedValueOnce(cachedRoster)
      .mockResolvedValueOnce(cachedRoster)
      .mockResolvedValueOnce(changedRoster);
    mockReconcileRosterEngagement.mockRejectedValueOnce(new Error('Dataverse unavailable'));
    const cached = res();
    await handler({ method: 'GET', query: { requestId: REQ, mode: 'cached' } }, cached);
    const reconciled = res();
    await handler({ method: 'GET', query: {
      requestId: REQ,
      mode: 'reconciled',
      rosterVersion: cached.body.rosterVersion,
    } }, reconciled);

    expect(reconciled.statusCode).toBe(409);
    expect(reconciled.body).toMatchObject({
      code: 'roster_snapshot_changed',
      authorityState: 'cached',
      active: changedRoster.active,
    });
    expect(reconciled.body.code).not.toBe('authority_reconciliation_failed');
    expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-roster-get', expect.any(Function));
    expect(store.listForRequest).toHaveBeenCalledTimes(3);
  });

  it('requires one well-formed roster version for reconciled mode', async () => {
    for (const rosterVersion of [undefined, 'not-a-token', ['a'.repeat(64), 'a'.repeat(64)]]) {
      const r = res();
      await handler({ method: 'GET', query: { requestId: REQ, mode: 'reconciled', rosterVersion } }, r);
      expect(r.statusCode).toBe(400);
      expect(r.body.code).toBe('invalid_roster_version');
    }
    // Version validation occurs after the scoped Postgres snapshot read, but
    // before any trusted Dataverse work.
    expect(mockReconcileRosterEngagement).not.toHaveBeenCalled();
    expect(withDalContext).not.toHaveBeenCalled();
  });
});

describe('POST recordSurfaced', () => {
  it('400 on a missing candidates array', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('400 when too many candidates', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `R${i}` }));
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: many } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.recordSurfaced).not.toHaveBeenCalled();
  });

  it('rejects browser attempts to mint server-managed applicant suggestion rows', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Applicant Reviewer',
      suggestionId: '33333333-3333-3333-3333-333333333333',
      candidateKey: 'suggestion:33333333-3333-3333-3333-333333333333',
      isApplicantRecommended: true,
      identityStatus: 'probable',
      email: 'forged@example.edu',
      emailPersistAllowed: true,
    }] } }, r);

    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ code: 'server_managed_applicant_candidate' });
    expect(store.recordSurfaced).not.toHaveBeenCalled();
  });

  it('re-derives an untrusted browser candidate key before writing the roster', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Mallory Example',
      candidateKey: 'candidate:existing-victim',
      email: 'mallory@example.edu',
      affiliation: 'Example University',
    }] } }, r);

    expect(r.statusCode).toBe(200);
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].candidateKey).toEqual(expect.any(String));
    expect(passed[0].candidateKey).not.toBe('candidate:existing-victim');
    expect(store.findCandidatesByKeys).toHaveBeenCalledWith(
      REQ,
      [passed[0].candidateKey],
    );
  });

  it('preserves a receipt-bound immutable roster candidate key', async () => {
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      rosterCandidateKey: 'candidate:receipt-bound',
      eligibilityEvidenceBound: false,
    });
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Receipt Bound',
      candidateKey: 'candidate:receipt-bound',
      automatedIdentityAttestation: 'signed',
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].candidateKey).toBe('candidate:receipt-bound');
  });

  it('stores identity-decision authority only from a valid server attestation', async () => {
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      rosterCandidateKey: 'candidate:receipt-bound',
      identityDecisionBound: true,
      eligibilityEvidenceBound: false,
    });
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Receipt Bound',
      candidateKey: 'candidate:receipt-bound',
      orcid: '0000-0002-1825-0097',
      automatedIdentityAttestation: 'signed',
      serverIdentityDecisionReceipt: { version: 1, source: 'forged', identityDigest: 'forged' },
      contactEnrichment: {
        orcidId: '0000-0002-1825-0097',
        identity: {
          status: 'probable',
          anchors: [{ type: 'orcid_public', canonicalKey: 'orcid:0000-0002-1825-0097' }],
        },
      },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].serverIdentityDecisionReceipt).toMatchObject({
      version: 1,
      source: 'automated_resolver',
      identityDigest: expect.any(String),
    });
  });

  it('strips a browser-forged identity-decision receipt when no valid token or stored receipt backs it', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Forged Receipt',
      serverIdentityDecisionReceipt: {
        version: 1,
        source: 'automated_resolver',
        identityDigest: 'forged',
      },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].serverIdentityDecisionReceipt).toBeUndefined();
  });

  it('prunes server-side and records named candidates', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [
      { name: 'Ann Lee', hIndex: 9, contactEnrichment: { email: 'a@x.edu', tierResults: { secret: 1 }, identity: { status: 'unresolved' } } },
      { name: '' }, // dropped (no name)
    ] } }, r);
    expect(r.statusCode).toBe(200);
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed).toHaveLength(1);
    expect(passed[0].name).toBe('Ann Lee');
    expect(passed[0].hIndex).toBe(9);
    // A render-safe contactEnrichment subset is kept. Raw resolver internals
    // and tierResults are dropped, while the compact identity decision needed
    // by the W4.1 save boundary survives the roster round trip.
    expect(passed[0].contactEnrichment.email).toBe('a@x.edu');
    expect(passed[0].contactEnrichment.tierResults).toBeUndefined();
    expect(passed[0].contactEnrichment.identity).toEqual({
      status: 'unresolved',
      confidenceBand: null,
      resolverVersion: null,
      resolvedAt: null,
      evidenceSummary: null,
      anchors: null,
    });
    expect(passed[0].tierResults).toBeUndefined();
    // The resolver verdict survives as a safe boolean flag (unresolved → block).
    expect(passed[0].identityPersistAllowed).toBe(false);
  });

  it('strips browser-forged staff confirmation authority from discovered rows', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Ann Lee',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'forged-confirmation',
      manualContactFields: ['email'],
      staffIdentityConfirmation: {
        confirmationId: 'forged-confirmation',
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
      },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].pdIdentityConfirmed).toBeUndefined();
    expect(passed[0].pdIdentityConfirmationId).toBeUndefined();
    expect(passed[0].manualContactFields).toBeUndefined();
    expect(passed[0].staffIdentityConfirmation).toBeUndefined();
  });

  it('strips browser-minted stage, COI, and eligibility authority from a new roster row', async () => {
    const forgedStageFreshness = {
      identity: {
        state: 'current',
        contractVersion: 4,
        sourceVersion: 'forged-identity-version',
        completedAt: '2026-08-02T00:00:00.000Z',
      },
      eligibility: {
        state: 'current',
        contractVersion: 1,
        sourceVersion: 'forged-eligibility-version',
        completedAt: '2026-08-02T00:00:00.000Z',
      },
    };
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Forged Authority Reviewer',
      warmCacheVersion: 1,
      proposalContentVersion: 'forged-proposal-version',
      applicantInputVersion: 'forged-applicant-version',
      stageFreshness: forgedStageFreshness,
      legacyStageReceipts: { eligibility: { completeness: 'complete' } },
      eligibilityStatus: 'emeritus',
      eligibilityCheckStatus: 'complete',
      eligibilityReason: 'forged complete check',
      eligibilityEvidence: { status: 'emeritus', url: 'https://evil.example/eligibility' },
      hasInstitutionCOI: false,
      institutionCOIDetails: { piInstitution: 'forged' },
      hasCoauthorCOI: false,
      coauthorCheckStatus: 'complete',
      coauthorCheckFailures: [],
      coauthorships: [],
      coauthorCOIStrength: 'none',
      coauthorSharedPaperTotal: 0,
      coauthorMaxWithOneAuthor: 0,
      addressTrustReceipt: { receiptId: 'forged', personConfirmed: true },
      contactEnrichment: {
        eligibilityStatus: 'emeritus',
        eligibilityCheckStatus: 'complete',
        eligibilityEvidence: { status: 'emeritus' },
        coauthorCheckStatus: 'complete',
        stageFreshness: forgedStageFreshness,
      },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      eligibilityStatus: 'unknown',
      eligibilityCheckStatus: null,
      eligibilityReason: null,
      eligibilityEvidence: null,
      contactEnrichment: {
        eligibilityStatus: 'unknown',
        eligibilityCheckStatus: null,
        eligibilityReason: null,
        eligibilityEvidence: null,
      },
    });
    for (const field of [
      'warmCacheVersion', 'proposalContentVersion', 'applicantInputVersion',
      'stageFreshness', 'legacyStageReceipts', 'hasInstitutionCOI',
      'institutionCOIDetails', 'hasCoauthorCOI', 'coauthorCheckStatus',
      'coauthorCheckFailures', 'coauthorships', 'coauthorCOIStrength',
      'coauthorSharedPaperTotal', 'coauthorMaxWithOneAuthor', 'addressTrustReceipt',
    ]) {
      expect(passed[0]).not.toHaveProperty(field);
      expect(passed[0].contactEnrichment).not.toHaveProperty(field);
    }
  });

  it('preserves a server-stored confirmation when a discovered row resurfaces', async () => {
    const resurfaced = {
      name: 'Ann Lee',
      email: 'automated@example.net',
    };
    const derivedCandidateKey = reviewerCandidateKey(resurfaced);
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Ann Lee',
      candidateKey: derivedCandidateKey,
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      manualContactFields: ['email', 'website', 'affiliation'],
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        ...SERVER_STAFF_IDENTITY_AUTHORITY,
        normalizedName: 'ann lee',
        email: 'verified@example.edu',
        website: 'https://example.edu/ann',
        affiliation: 'Example University',
        actorProfileId: 5,
      },
    }]);
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      ...resurfaced,
      candidateKey: derivedCandidateKey,
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      email: 'verified@example.edu',
      website: 'https://example.edu/ann',
      affiliation: 'Example University',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      staffIdentityConfirmation: expect.objectContaining({
        confirmationId: 'confirm-1',
        actorProfileId: 5,
      }),
    });
  });

  it('preserves stored address blocks without carrying email persistence authority to a resurfaced card', async () => {
    const resurfaced = {
      name: 'Blocked Reviewer',
      email: 'found@example.edu',
      emailPersistAllowed: false,
      contactEnrichment: {
        email: 'found@example.edu',
        emailPersistAllowed: false,
      },
    };
    const derivedCandidateKey = reviewerCandidateKey(resurfaced);
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      ...resurfaced,
      candidateKey: derivedCandidateKey,
      emailPersistAllowed: true,
      addressConflictPending: true,
      conflictRecordUnavailable: true,
      addressVerificationRequired: true,
      contactEnrichment: {
        ...resurfaced.contactEnrichment,
        emailPersistAllowed: true,
        addressConflictPending: true,
        conflictRecordUnavailable: true,
        addressVerificationRequired: true,
      },
    }]);
    const r = res();

    await handler({ method: 'POST', body: {
      requestId: REQ,
      candidates: [{ ...resurfaced, candidateKey: derivedCandidateKey }],
    } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      emailPersistAllowed: false,
      addressConflictPending: true,
      conflictRecordUnavailable: true,
      addressVerificationRequired: true,
      contactEnrichment: {
        emailPersistAllowed: false,
        addressConflictPending: true,
        conflictRecordUnavailable: true,
        addressVerificationRequired: true,
      },
    });
  });

  it('restores stored stage and COI evidence instead of accepting a resurfaced browser copy', async () => {
    const resurfaced = {
      name: 'Evidence-bound Reviewer',
      email: 'evidence@example.edu',
    };
    const candidateKey = reviewerCandidateKey(resurfaced);
    const storedStageFreshness = {
      identity: {
        state: 'current',
        contractVersion: 4,
        sourceVersion: 'stored-identity-version',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
      coauthor_coi: {
        state: 'incomplete',
        contractVersion: 1,
        sourceVersion: 'stored-coauthor-version',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      ...resurfaced,
      candidateKey,
      warmCacheVersion: 1,
      proposalContentVersion: 'stored-proposal-version',
      applicantInputVersion: 'stored-applicant-version',
      stageFreshness: storedStageFreshness,
      eligibilityStatus: 'unknown',
      eligibilityCheckStatus: 'incomplete',
      eligibilityReason: 'Stored check is incomplete',
      eligibilityEvidence: { status: 'unknown', url: 'https://example.edu/stored' },
      hasInstitutionCOI: true,
      institutionCOIDetails: { piInstitution: 'Stored University' },
      hasCoauthorCOI: true,
      coauthorCheckStatus: 'incomplete',
      coauthorCheckFailures: [{ reason: 'provider_timeout' }],
      coauthorships: [{ title: 'Stored paper' }],
      coauthorCOIStrength: 'likely',
      coauthorSharedPaperTotal: 2,
      coauthorMaxWithOneAuthor: 2,
      contactEnrichment: {
        eligibilityCheckStatus: 'incomplete',
        coauthorCheckStatus: 'incomplete',
      },
    }]);
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      ...resurfaced,
      candidateKey,
      warmCacheVersion: 1,
      proposalContentVersion: 'browser-proposal-version',
      applicantInputVersion: 'browser-applicant-version',
      stageFreshness: {
        coauthor_coi: {
          state: 'current', contractVersion: 1, sourceVersion: 'browser-version',
          completedAt: '2026-08-02T00:00:00.000Z',
        },
      },
      eligibilityCheckStatus: 'complete',
      hasInstitutionCOI: false,
      hasCoauthorCOI: false,
      coauthorCheckStatus: 'complete',
      coauthorCheckFailures: [],
      coauthorships: [],
      coauthorCOIStrength: 'none',
      contactEnrichment: {
        eligibilityCheckStatus: 'complete',
        coauthorCheckStatus: 'complete',
      },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      warmCacheVersion: 1,
      proposalContentVersion: 'stored-proposal-version',
      applicantInputVersion: 'stored-applicant-version',
      stageFreshness: storedStageFreshness,
      eligibilityCheckStatus: 'incomplete',
      eligibilityReason: 'Stored check is incomplete',
      eligibilityEvidence: { status: 'unknown', url: 'https://example.edu/stored' },
      hasInstitutionCOI: true,
      hasCoauthorCOI: true,
      coauthorCheckStatus: 'incomplete',
      coauthorCheckFailures: [{ reason: 'provider_timeout' }],
      coauthorCOIStrength: 'likely',
    });
    expect(passed[0].contactEnrichment).toMatchObject({
      eligibilityCheckStatus: 'incomplete',
      coauthorCheckStatus: 'incomplete',
      stageFreshness: storedStageFreshness,
    });
  });

  it('keeps the stored eligibility check status when an old v3 receipt returns through the v4 roster tab', async () => {
    const resurfaced = {
      name: 'Versioned Eligibility Reviewer',
      email: 'versioned@example.edu',
      emailSource: 'pubmed',
      emailPersistAllowed: true,
    };
    const candidateKey = reviewerCandidateKey(resurfaced);
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      projectionVersion: 3,
      eligibilityEvidenceBound: true,
      eligibilityStatus: 'emeritus',
      // v3 carried this claim but did not include it in its eligibility digest.
      eligibilityCheckStatus: 'complete',
    });
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      ...resurfaced,
      candidateKey,
      eligibilityStatus: 'unknown',
      eligibilityCheckStatus: 'incomplete',
      eligibilityReason: 'The prior server check was incomplete',
      eligibilityEvidence: { status: 'unknown', url: 'https://example.edu/prior-check' },
      contactEnrichment: {
        eligibilityStatus: 'unknown',
        eligibilityCheckStatus: 'incomplete',
        eligibilityReason: 'The prior server check was incomplete',
        eligibilityEvidence: { status: 'unknown', url: 'https://example.edu/prior-check' },
      },
    }]);
    const currentTabCandidate = {
      ...resurfaced,
      candidateKey,
      automatedIdentityAttestation: 'valid-v3-receipt',
      eligibilityStatus: 'emeritus',
      eligibilityCheckStatus: 'complete',
      eligibilityReason: 'Server-signed emeritus evidence',
      eligibilityEvidence: { status: 'emeritus', url: 'https://example.edu/emeritus' },
    };
    const r = res();

    await handler({ method: 'POST', body: { requestId: REQ, candidates: [currentTabCandidate] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      // The other v3-bound evidence remains server-controlled, but this field
      // is restored because only a v4 digest can bind it.
      eligibilityStatus: 'emeritus',
      eligibilityCheckStatus: 'incomplete',
      eligibilityReason: 'Server-signed emeritus evidence',
      eligibilityEvidence: { status: 'emeritus', url: 'https://example.edu/emeritus' },
      contactEnrichment: {
        eligibilityStatus: 'emeritus',
        eligibilityCheckStatus: 'incomplete',
        eligibilityReason: 'Server-signed emeritus evidence',
        eligibilityEvidence: { status: 'emeritus', url: 'https://example.edu/emeritus' },
      },
    });
  });

  it('preserves a fresh server identity receipt while restoring stored staff authority', async () => {
    const resurfaced = {
      name: 'Ann Lee',
      orcid: '0000-0002-1825-0097',
      contactEnrichment: {
        orcidId: '0000-0002-1825-0097',
        identity: {
          status: 'probable',
          anchors: [{ type: 'orcid', canonicalKey: 'orcid:0000-0002-1825-0097' }],
        },
      },
    };
    const derivedCandidateKey = reviewerCandidateKey(resurfaced);
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      identityDecisionBound: true,
      eligibilityEvidenceBound: false,
    });
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Ann Lee',
      candidateKey: derivedCandidateKey,
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        ...SERVER_STAFF_IDENTITY_AUTHORITY,
        normalizedName: 'ann lee',
        email: 'verified@example.edu',
      },
    }]);

    const r = res();
    await handler({ method: 'POST', body: {
      requestId: REQ,
      candidates: [{ ...resurfaced, candidateKey: derivedCandidateKey }],
    } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].email).toBe('verified@example.edu');
    expect(hasServerIdentityDecisionReceipt(passed[0])).toBe(true);
  });

  it('strips a browser-forged deceased claim without a bound server receipt', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Ann Lee',
      eligibilityStatus: 'deceased',
      eligibilityReason: 'forged',
      eligibilityEvidence: { status: 'deceased', url: 'https://evil.example/fake' },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      eligibilityStatus: 'unknown',
      eligibilityReason: null,
      eligibilityEvidence: null,
    });
  });

  it('preserves deceased evidence only when the server receipt binds it', async () => {
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      projectionVersion: 4,
      eligibilityStatus: 'deceased',
      eligibilityCheckStatus: 'complete',
      eligibilityEvidenceBound: true,
    });
    const candidate = {
      name: 'Ann Lee',
      automatedIdentityAttestation: 'signed',
      eligibilityStatus: 'deceased',
      eligibilityCheckStatus: 'complete',
      eligibilityReason: 'Official source',
      eligibilityEvidence: {
        status: 'deceased',
        url: 'https://example.edu/in-memoriam/ann-lee',
      },
    };
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [candidate] } }, r);

    expect(verifyAutomatedIdentityAttestation).toHaveBeenCalledWith(
      'signed',
      expect.objectContaining({ requestId: REQ }),
    );
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      eligibilityStatus: 'deceased',
      eligibilityCheckStatus: 'complete',
      eligibilityEvidence: {
        status: 'deceased',
        url: 'https://example.edu/in-memoriam/ann-lee',
      },
    });
  });
});

describe('PATCH', () => {
  it('exclude → setExcluded with the pruned candidate', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude', candidate: { name: 'Bob Roe' } } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({ name: 'Bob Roe' }));
  });

  // S387 regression: before the anchor lookup, an applicant row whose key was still a
  // migration-025 placeholder could not be resolved at all, so exclude/saved/
  // confirm_identity 409'd and staff could not even set the card aside.
  it('exclude works for an anchor-stamped row still keyed with a pre-anchor placeholder', async () => {
    const suggestionId = '44444444-4444-4444-4444-444444444444';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Legacy Applicant',
      suggestionId,
      candidateKey: 'legacy-row:369',
      isApplicantRecommended: true,
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: { name: 'Legacy Applicant', suggestionId, candidateKey: 'legacy-row:369' },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({
      name: 'Legacy Applicant',
      candidateKey: 'legacy-row:369',
    }));
  });

  // The anchor lookup widened WHICH row is found, not WHOSE claim is trusted: the client
  // must still be acting on the row the server actually stored.
  it('still refuses when the client key disagrees with the stored row', async () => {
    const suggestionId = '55555555-5555-5555-5555-555555555555';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Legacy Applicant',
      suggestionId,
      candidateKey: 'legacy-row:369',
      isApplicantRecommended: true,
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: { name: 'Legacy Applicant', suggestionId, candidateKey: `suggestion:${suggestionId}` },
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(store.setExcluded).not.toHaveBeenCalled();
  });

  it('exclude of an applicant row uses the existing server blob, not the browser blob', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      identityStatus: 'unresolved',
      needsIdentification: true,
      isApplicantRecommended: true,
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      manualContactFields: ['email'],
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        ...SERVER_STAFF_IDENTITY_AUTHORITY,
        normalizedName: 'applicant reviewer',
        email: 'verified@example.edu',
      },
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: {
        name: 'Applicant Reviewer',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        identityStatus: 'probable',
        email: 'forged@example.edu',
      },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(
      REQ,
      expect.objectContaining({
        identityStatus: 'unresolved',
        needsIdentification: true,
        email: null,
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'confirm-1',
        manualContactFields: ['email'],
        staffIdentityConfirmation: expect.objectContaining({ confirmationId: 'confirm-1' }),
      }),
    );
  });

  it('strips browser-forged confirmation and evidence authority from a non-applicant exclude', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: {
        name: 'Bob Roe',
        candidateKey: 'candidate:bob',
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'forged',
        manualContactFields: ['email'],
        staffIdentityConfirmation: { confirmationId: 'forged', source: 'staff_confirmed' },
        warmCacheVersion: 1,
        proposalContentVersion: 'forged-proposal-version',
        applicantInputVersion: 'forged-applicant-version',
        stageFreshness: {
          eligibility: {
            state: 'current', contractVersion: 1, sourceVersion: 'forged-version',
            completedAt: '2026-08-02T00:00:00.000Z',
          },
        },
        eligibilityCheckStatus: 'complete',
        coauthorCheckStatus: 'complete',
        hasCoauthorCOI: false,
        contactEnrichment: {
          eligibilityCheckStatus: 'complete',
          coauthorCheckStatus: 'complete',
          stageFreshness: { eligibility: { state: 'current' } },
        },
      },
    } }, r);
    const persisted = store.setExcluded.mock.calls[0][1];
    expect(persisted).not.toHaveProperty('pdIdentityConfirmed');
    expect(persisted).not.toHaveProperty('pdIdentityConfirmationId');
    expect(persisted).not.toHaveProperty('manualContactFields');
    expect(persisted).not.toHaveProperty('staffIdentityConfirmation');
    for (const field of [
      'warmCacheVersion', 'proposalContentVersion', 'applicantInputVersion',
      'stageFreshness', 'eligibilityCheckStatus', 'coauthorCheckStatus', 'hasCoauthorCOI',
    ]) {
      expect(persisted).not.toHaveProperty(field);
      expect(persisted.contactEnrichment).not.toHaveProperty(field);
    }
  });

  it('preserves the canonical server confirmation on a non-applicant exclude', async () => {
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Bob Roe',
      candidateKey: 'candidate:bob',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      manualContactFields: ['email'],
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        ...SERVER_STAFF_IDENTITY_AUTHORITY,
        normalizedName: 'bob roe',
        email: 'verified@example.edu',
        website: '',
        affiliation: 'Example University',
        actorSystemUserId: 'system-5',
      },
    }]);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: { name: 'Bob Roe', candidateKey: 'candidate:bob', email: 'forged@example.net' },
    } }, r);

    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({
      email: 'verified@example.edu',
      pdIdentityConfirmationId: 'confirm-1',
      staffIdentityConfirmation: expect.objectContaining({ actorSystemUserId: 'system-5' }),
    }));
  });

  it('exclude → 400 without a candidate', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude' } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('promote → returns the restored blob', async () => {
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Bob Roe',
      candidateKey: 'candidate:bob',
      rosterStatus: 'excluded',
    }]);
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:bob' } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.promote).toHaveBeenCalledWith(REQ, 'candidate:bob');
    expect(r.body.candidate).toEqual({ name: 'Bob Roe' });
  });

  it('promote → 409 when the candidate is no longer excluded', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:stale' } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({
      success: false,
      code: 'candidate_not_excluded',
    });
    expect(store.promote).not.toHaveBeenCalled();
  });

  it('promote → 409 when Dataverse says the anchored reviewer is handled', async () => {
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Handled Reviewer',
      candidateKey: `suggestion:${REQ}`,
      suggestionId: REQ,
      rosterStatus: 'excluded',
    }]);
    mockValidateRosterPromotionEngagement.mockResolvedValueOnce({
      allowed: false,
      code: 'reviewer_already_handled',
      stage: 'declined',
      error: 'This reviewer has already entered the engagement lifecycle.',
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'promote',
      candidateKey: `suggestion:${REQ}`,
    } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'reviewer_already_handled', stage: 'declined' });
    expect(store.promote).not.toHaveBeenCalled();
  });

  it('saved → 409 because promotion services own the roster transition', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{ name: 'Ann Lee', candidateKey: 'candidate:ann' }],
    } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'server_owned_transition' });
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('does not inspect or persist browser-forged authority on a saved request', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{
        name: 'Ann Lee',
        candidateKey: 'candidate:ann',
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'forged',
        manualContactFields: ['email'],
        staffIdentityConfirmation: { confirmationId: 'forged', source: 'staff_confirmed' },
      }],
    } }, r);
    expect(r.statusCode).toBe(409);
    expect(store.findCandidatesByKeys).not.toHaveBeenCalled();
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('rejects a stale applicant mark-saved payload instead of creating an authoritative row', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{
        name: 'Applicant Reviewer',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        isApplicantRecommended: true,
      }],
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('rejects even an applicant saved payload with a complete server confirmation', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{
        name: 'Applicant Reviewer',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        isApplicantRecommended: true,
        pdIdentityConfirmationId: 'forged',
      }],
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(store.findCandidateBySuggestionAnchor).not.toHaveBeenCalled();
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('confirm_identity records an actor-bound server confirmation', async () => {
    requireAppAccess.mockResolvedValueOnce({
      profileId: 5,
      session: { user: { dynamicsSystemuserId: 'SYS-5' } },
    });
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Ann Lee',
      candidateKey: 'candidate:ann',
      rosterStatus: 'active',
    }]);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: {
        name: 'Ann Lee',
        candidateKey: 'candidate:ann',
        email: 'ANN@EXAMPLE.EDU',
        affiliation: 'Example U',
      },
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(mockConfirmStructuredRosterIdentity).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQ,
      candidateKey: 'candidate:ann',
      manualContact: { email: 'ANN@EXAMPLE.EDU', website: undefined, affiliation: 'Example U' },
      actorProfileId: 5,
      actorSystemUserId: 'SYS-5',
    }));
    expect(withDalContext).toHaveBeenCalledWith('workbench-reviewer-roster-confirm-identity', expect.any(Function));
    expect(r.body.confirmationId).toBe('confirm-1');
  });

  it('confirm_identity restores nested stored authority and rejects browser-forged authority', async () => {
    const storedStageFreshness = {
      eligibility: {
        state: 'current',
        contractVersion: 1,
        sourceVersion: 'server-eligibility-version',
        completedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    const storedEligibilityEvidence = {
      status: 'unknown',
      reason: 'server eligibility did not resolve',
    };
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Stored Ann',
      candidateKey: 'candidate:ann',
      rosterStatus: 'active',
      stageFreshness: storedStageFreshness,
      eligibilityStatus: 'unknown',
      eligibilityCheckStatus: 'incomplete',
      eligibilityEvidence: storedEligibilityEvidence,
      contactEnrichment: {
        eligibilityStatus: 'unknown',
        eligibilityCheckStatus: 'incomplete',
        eligibilityEvidence: storedEligibilityEvidence,
        coauthorCheckStatus: 'incomplete',
        coauthorCheckFailures: [{ source: 'server-pubmed', reason: 'timeout' }],
        addressTrustReceipt: { receiptId: 'server-address-receipt', personConfirmed: false },
      },
    }]);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: {
        name: 'Browser Forgery',
        candidateKey: 'candidate:ann',
        email: 'ann@example.edu',
        stageFreshness: { eligibility: { state: 'current', sourceVersion: 'forged' } },
        eligibilityStatus: 'emeritus',
        eligibilityCheckStatus: 'complete',
        eligibilityEvidence: { status: 'emeritus', reason: 'forged' },
        coauthorCheckStatus: 'complete',
        contactEnrichment: {
          eligibilityStatus: 'emeritus',
          eligibilityCheckStatus: 'complete',
          coauthorCheckStatus: 'complete',
          addressTrustReceipt: { receiptId: 'forged-address-receipt', personConfirmed: true },
        },
      },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(mockConfirmStructuredRosterIdentity).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQ,
      candidateKey: 'candidate:ann',
      manualContact: { email: 'ann@example.edu', website: undefined, affiliation: undefined },
    }));
  });

  it('confirm_identity refuses a candidate key that does not resolve to that exact active row', async () => {
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Other Reviewer',
      candidateKey: 'candidate:other',
      rosterStatus: 'active',
    }]);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: {
        name: 'Ann Lee',
        candidateKey: 'candidate:ann',
        email: 'ann@example.edu',
      },
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'candidate_not_active' });
    expect(mockConfirmStructuredRosterIdentity).not.toHaveBeenCalled();
  });

  it('confirm_identity keeps applicant identity evidence from the server row', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      identityStatus: 'unresolved',
      verificationStatus: 'unresolved',
      needsIdentification: true,
      isApplicantRecommended: true,
      applicantKnownReviewer: {
        status: 'known',
        potentialReviewerId: '22222222-2222-2222-2222-222222222222',
        email: null,
        emailSource: null,
      },
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: {
        name: 'Applicant Reviewer',
        email: 'verified@example.edu',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        identityStatus: 'probable',
        needsIdentification: false,
      },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(mockConfirmStructuredRosterIdentity).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQ,
      candidateKey: `suggestion:${suggestionId}`,
      manualContact: { email: 'verified@example.edu', website: undefined, affiliation: undefined },
    }));
  });

  it('confirm_identity rejects an applicant row whose exact person hydration is unavailable', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      identityStatus: 'unresolved',
      needsIdentification: true,
      isApplicantRecommended: true,
      applicantKnownReviewer: {
        status: 'unavailable',
        code: 'person_unavailable',
        potentialReviewerId: '22222222-2222-2222-2222-222222222222',
      },
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: {
        name: 'Applicant Reviewer',
        email: 'verified@example.edu',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        isApplicantRecommended: true,
      },
    } }, r);

    expect(r.statusCode).toBe(422);
    expect(r.body).toMatchObject({ code: 'applicant_hydration_required' });
    expect(mockConfirmStructuredRosterIdentity).not.toHaveBeenCalled();
  });

  it('confirm_identity returns 409 when the active roster row is gone', async () => {
    mockConfirmStructuredRosterIdentity.mockResolvedValueOnce({
      success: false,
      code: 'candidate_stale',
      message: 'Candidate is no longer active; reload before confirming identity.',
      remediation: [],
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: { name: 'Ann Lee', candidateKey: 'candidate:ann', email: 'ann@example.edu' },
    } }, r);
    expect(r.statusCode).toBe(409);
  });

  it('remove_previous_results deletes only through the scoped store helper and returns the refreshed roster', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'remove_previous_results',
      candidateRefs: [
        { candidateKey: 'candidate:old-a', updatedAt: '2026-07-19T12:00:00.000Z' },
        { candidateKey: 'candidate:old-b', updatedAt: '2026-07-19T13:00:00.000Z' },
      ],
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.removePreviousActiveSearchResults).toHaveBeenCalledWith(
      REQ,
      [
        { candidateKey: 'candidate:old-a', updatedAt: '2026-07-19T12:00:00.000Z' },
        { candidateKey: 'candidate:old-b', updatedAt: '2026-07-19T13:00:00.000Z' },
      ],
    );
    expect(store.listForRequest).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({
      success: true,
      removed: 2,
      removedKeys: ['candidate:old-a', 'candidate:old-b'],
      active: [{ name: 'Applicant Person', provenance: { kind: 'applicant_suggested' } }],
      excluded: [{ name: 'Excluded Person' }],
      allNames: ['Applicant Person', 'Excluded Person', 'Saved Person'],
    });
  });

  it('remove_previous_results accepts bounded generated keys longer than 256 characters', async () => {
    const candidateKey = `candidate:${'a'.repeat(680)}`;
    const candidateRefs = [{
      candidateKey,
      updatedAt: '2026-07-19T12:00:00.000Z',
    }];
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'remove_previous_results',
      candidateRefs,
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.removePreviousActiveSearchResults).toHaveBeenCalledWith(REQ, candidateRefs);
  });

  it('remove_previous_results rejects a missing candidate-ref scope', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'remove_previous_results',
    } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.removePreviousActiveSearchResults).not.toHaveBeenCalled();
  });

  it('remove_previous_results rejects malformed or oversized candidate-ref scopes', async () => {
    for (const candidateRefs of [
      [{ candidateKey: 'candidate:valid', updatedAt: '' }],
      [{ candidateKey: 'candidate:valid', updatedAt: 12345 }],
      [{ candidateKey: '', updatedAt: '2026-07-19T12:00:00.000Z' }],
      Array.from({ length: 301 }, (_, i) => ({
        candidateKey: `candidate:${i}`,
        updatedAt: '2026-07-19T12:00:00.000Z',
      })),
    ]) {
      const r = res();
      await handler({ method: 'PATCH', body: {
        requestId: REQ,
        action: 'remove_previous_results',
        candidateRefs,
      } }, r);
      expect(r.statusCode).toBe(400);
    }
    expect(store.removePreviousActiveSearchResults).not.toHaveBeenCalled();
  });

  it('unknown action → 400', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'frobnicate' } }, r);
    expect(r.statusCode).toBe(400);
  });
});

describe('method', () => {
  it('405 on an unsupported method', async () => {
    const r = res();
    await handler({ method: 'PUT', body: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(405);
  });
});
