/**
 * Unit tests for the Stage 5 external-review services
 * (lib/services/external-review/{context,respond,submit}-service.js).
 *
 * The route characterization suites (external-review-routes.test.js,
 * external-review-submit-route.test.js) drive these services end-to-end
 * through the byte-untouched token-boundary shells; this suite pins the
 * service-level contracts directly — explicit { ok:false, reason } error
 * bodies, drain-contract ordering, and the preserved narrow DAL scopes.
 *
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((label, fn) => fn()),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  applyStage2aResponse: jest.fn(async () => ({})),
  getForEtagRefresh: jest.fn(async () => ({ _etag: 'W/"2"' })),
  stampProposalFirstAccessed: jest.fn(async () => ({})),
  getForSubmitFinalityCheck: jest.fn(async () => ({ _etag: 'W/"fresh"', wmkf_reviewreceivedat: null })),
  ENTITY_SET_NAME: 'wmkf_appreviewersuggestions',
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getByIdWithSelect: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/review-answer', () => ({
  answerUpsertDescriptor: jest.fn((id, row) => ({ method: 'PATCH', url: `answers(${row.key})`, body: row })),
}));
jest.mock('../../lib/dataverse/core/changeset', () => ({
  runChangeset: jest.fn(async () => ({ ok: true })),
  atomicParentWithChildren: jest.fn(({ parent, children }) => [...children, parent]),
}));
jest.mock('../../lib/external/reviewer-materials', () => ({
  listReviewerMaterials: jest.fn(async () => []),
}));
jest.mock('../../lib/external/policy-fetcher', () => ({
  getActivePolicies: jest.fn(async (slots) => Object.fromEntries(slots.map((s) => [s, {
    slotCode: s, activeVersionId: `v-${s}`, versionLabel: '1.0', title: `T ${s}`, body: 'B',
  }]))),
}));
jest.mock('../../lib/services/proposal-participants', () => ({
  fetchCoPIs: jest.fn(async () => []),
}));
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = jest.requireActual('../../lib/external/review-form-schema');
  return {
    getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    questionSetVersion: jest.fn(() => 'testver'),
  };
});
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  readRatingsBySuggestion: jest.fn(async () => ({ impact: null, risk: null, overallRating: null })),
}));
jest.mock('../../lib/services/capture-self-reported-orcid', () => ({
  captureSelfReportedReviewerOrcid: jest.fn(async () => ({})),
}));
jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  enqueueReviewerAcceptanceJob: jest.fn(async () => ({ id: 101, status: 'accept_pending' })),
  markReviewerAcceptanceJobQueued: jest.fn(async () => ({ id: 101, status: 'queued' })),
  cancelReviewerAcceptanceJob: jest.fn(async () => ({ id: 101, status: 'cancelled' })),
}));
jest.mock('../../lib/services/review-draft-service', () => ({
  deleteBySuggestion: jest.fn(async () => 1),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import {
  applyStage2aResponse,
  getForSubmitFinalityCheck,
} from '../../lib/dataverse/adapters/reviewer-suggestion';
import { runChangeset } from '../../lib/dataverse/core/changeset';
import { getActivePolicies } from '../../lib/external/policy-fetcher';
import {
  enqueueReviewerAcceptanceJob,
  markReviewerAcceptanceJobQueued,
  cancelReviewerAcceptanceJob,
} from '../../lib/services/reviewer-acceptance-job-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { buildReviewContext } from '../../lib/services/external-review/context-service';
import { applyReviewerResponse } from '../../lib/services/external-review/respond-service';
import { submitReview } from '../../lib/services/external-review/submit-service';

const baseSuggestion = (over = {}) => ({
  wmkf_appreviewersuggestionid: 'suggestion-1',
  _etag: 'W/"1"',
  wmkf_reviewstatus: null,
  wmkf_responsetype: null,
  wmkf_accepted: false,
  wmkf_declined: false,
  wmkf_reviewreceivedat: null,
  wmkf_proposalfirstaccessed: '2026-05-01T00:00:00Z',
  ...over,
});
const request = { akoya_requestid: 'request-1', akoya_requestnum: 'REQ-001', akoya_title: 'T' };
const reviewer = { wmkf_name: 'Dr. R', wmkf_emailaddress: 'r@x.org' };

beforeEach(() => jest.clearAllMocks());

describe('buildReviewContext', () => {
  it('stage2a policy failure throws the explicit fail-closed body', async () => {
    getActivePolicies.mockRejectedValueOnce(new Error('slot missing'));
    await expect(buildReviewContext({ suggestion: baseSuggestion(), request, reviewer }))
      .rejects.toMatchObject({ httpStatus: 500, body: { ok: false, reason: 'policy_misconfigured' } });
  });

  it('preserves the historical branch-specific DAL scope labels (first-access + stage2a)', async () => {
    await buildReviewContext({
      suggestion: baseSuggestion({ wmkf_proposalfirstaccessed: null }),
      request,
      reviewer: { ...reviewer, _wmkf_contact_value: 'contact-1' },
    });
    const labels = withDalContext.mock.calls.map(([l]) => l);
    expect(labels).toEqual([
      'external-first-access',
      'external-context-refetch-etag',
      'external-context-copis',
      'external-context-contact',
    ]);
  });

  it('stage2b question-set failure propagates raw (shell maps to server_error 500)', async () => {
    const { getActiveQuestionSet } = require('../../lib/external/review-question-fetcher');
    getActiveQuestionSet.mockRejectedValueOnce(new Error('fetch cap'));
    await expect(buildReviewContext({
      suggestion: baseSuggestion({ wmkf_accepted: true, wmkf_reviewstatus: 100000001 }),
      request, reviewer,
    })).rejects.toThrow('fetch cap');
  });
});

describe('applyReviewerResponse', () => {
  const acceptBody = () => ({
    action: 'accept',
    policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true },
    boardIdentity: { academicRank: 'Prof', primaryDepartment: 'Chem', mainInstitution: 'MIT' },
    address: { line1: '1 St', city: 'Town', postalCode: '94000', country: 'US', phone: '+1 555 0100' },
  });

  it('drain contract: stages accept_pending BEFORE the PATCH, marks queued after, returns the job id', async () => {
    const r = await applyReviewerResponse({ suggestion: baseSuggestion(), request, reviewer, body: acceptBody(), ifMatch: 'W/"1"' });
    expect(enqueueReviewerAcceptanceJob.mock.invocationCallOrder[0])
      .toBeLessThan(applyStage2aResponse.mock.invocationCallOrder[0]);
    expect(applyStage2aResponse.mock.invocationCallOrder[0])
      .toBeLessThan(markReviewerAcceptanceJobQueued.mock.invocationCallOrder[0]);
    expect(enqueueReviewerAcceptanceJob.mock.calls[0][0].status).toBe('accept_pending');
    expect(r).toEqual({
      ok: true, idempotent: false, acceptanceJobId: 101,
      engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
    });
  });

  it('412 on the accept PATCH cancels the staged job and throws the concurrent_modification body', async () => {
    applyStage2aResponse.mockRejectedValueOnce(Object.assign(new Error('(412)'), { status: 412 }));
    await expect(applyReviewerResponse({ suggestion: baseSuggestion(), request, reviewer, body: acceptBody(), ifMatch: 'W/"stale"' }))
      .rejects.toMatchObject({ httpStatus: 412, body: { ok: false, reason: 'concurrent_modification' } });
    expect(cancelReviewerAcceptanceJob).toHaveBeenCalledWith(101, expect.any(String));
  });

  it('repeat accept skips the PATCH but stages a queued job (tail retry)', async () => {
    const r = await applyReviewerResponse({
      suggestion: baseSuggestion({ wmkf_accepted: true }), request, reviewer, body: { action: 'accept' }, ifMatch: undefined,
    });
    expect(applyStage2aResponse).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob.mock.calls[0][0].status).toBe('queued');
    expect(r.idempotent).toBe(true);
  });

  it('state-machine guards throw explicit bodies (withdrawn_sufficient / materials_sent_locked)', async () => {
    await expect(applyReviewerResponse({
      suggestion: baseSuggestion({ wmkf_responsetype: 100000003 }), request, reviewer, body: { action: 'decline' },
    })).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'withdrawn_sufficient' }) });
    await expect(applyReviewerResponse({
      suggestion: baseSuggestion({ wmkf_reviewstatus: 100000001 }), request, reviewer, body: { action: 'decline' },
    })).rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'materials_sent_locked' }) });
  });

  it('decline uses the preserved narrow scope label and 422s a missing payment address on fresh accept', async () => {
    await applyReviewerResponse({ suggestion: baseSuggestion(), request, reviewer, body: { action: 'decline', decline: {} }, ifMatch: 'W/"1"' });
    expect(withDalContext).toHaveBeenCalledWith('external-respond', expect.any(Function));
    const body = { ...acceptBody() };
    delete body.address;
    await expect(applyReviewerResponse({ suggestion: baseSuggestion(), request, reviewer, body }))
      .rejects.toMatchObject({ httpStatus: 422, body: expect.objectContaining({ reason: 'payment_contact_required' }) });
  });
});

describe('submitReview', () => {
  const { reviewFormSchema } = jest.requireActual('../../lib/external/review-form-schema');
  const validAnswers = () => ({
    affiliation: 'Professor of Physics, Example University',
    impact: 3, risk: 2, overallRating: 4,
    q2: '<p>a</p>', q4: '<p>a</p>', q5: '<p>a</p>', q6: '<p>a</p>',
    q7: '<p>a</p>', q8: '<p>a</p>', q9: '<p>a</p>', q11: '',
  });
  const stage2b = (over = {}) => baseSuggestion({ wmkf_accepted: true, wmkf_reviewstatus: 100000001, ...over });

  it('finality precheck throws review_received_locked with the exact message body', async () => {
    await expect(submitReview({ suggestion: stage2b({ wmkf_reviewreceivedat: '2026-07-01T00:00:00Z' }), body: {} }))
      .rejects.toMatchObject({
        httpStatus: 409,
        body: expect.objectContaining({ reason: 'review_received_locked', message: expect.stringContaining('already been submitted') }),
      });
    expect(runChangeset).not.toHaveBeenCalled();
  });

  it('happy path: changeset inside the preserved external-review-submit scope; returns { ok, receivedAt }', async () => {
    const r = await submitReview({ suggestion: stage2b(), body: { answers: validAnswers() } });
    expect(r).toEqual({ ok: true, receivedAt: expect.any(String) });
    expect(withDalContext).toHaveBeenCalledWith('external-review-submit', expect.any(Function));
    expect(runChangeset).toHaveBeenCalledTimes(1);
  });

  it('racing submit caught by the fallback finality re-read → review_received_locked, nothing written', async () => {
    getForSubmitFinalityCheck.mockResolvedValueOnce({ _etag: 'W/"x"', wmkf_reviewreceivedat: '2026-07-01T00:00:00Z' });
    await expect(submitReview({ suggestion: stage2b({ _etag: null }), body: { answers: validAnswers() } }))
      .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'review_received_locked' }) });
    expect(runChangeset).not.toHaveBeenCalled();
  });

  it('changeset 412 → 409 conflict; unexpected changeset failure → 500 server_error body', async () => {
    runChangeset.mockRejectedValueOnce(Object.assign(new Error('precondition'), { status: 412 }));
    await expect(submitReview({ suggestion: stage2b(), body: { answers: validAnswers() } }))
      .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'conflict' }) });
    runChangeset.mockRejectedValueOnce(new Error('batch down'));
    await expect(submitReview({ suggestion: stage2b(), body: { answers: validAnswers() } }))
      .rejects.toMatchObject({ httpStatus: 500, body: { ok: false, reason: 'server_error' } });
  });

  it('stale setVersion → set_changed body before any validation error', async () => {
    await expect(submitReview({ suggestion: stage2b(), body: { setVersion: 'old', answers: {} } }))
      .rejects.toMatchObject({ httpStatus: 409, body: expect.objectContaining({ reason: 'set_changed' }) });
  });
});
