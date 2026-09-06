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
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => {
  // updateLifecycle stays mocked directly (nothing in this suite calls the
  // real 3J op's implementation); deselectLegacyDeclinedSuggestion forwards
  // to it so the existing updateLifecycle-shaped assertions below (repeat
  // decline repairs a legacy row) stay byte-unchanged while a new pin also
  // asserts the op itself was invoked and updateLifecycle was not called
  // directly by the service.
  const updateLifecycle = jest.fn(async () => ({}));
  return {
    applyStage2aResponse: jest.fn(async () => ({})),
    updateLifecycle,
    deselectLegacyDeclinedSuggestion: jest.fn((id, opts) => updateLifecycle(id, { selected: false }, opts)),
    getForEtagRefresh: jest.fn(async () => ({ _etag: 'W/"2"' })),
    stampProposalFirstAccessed: jest.fn(async () => ({})),
    getForSubmitFinalityCheck: jest.fn(async () => ({ _etag: 'W/"fresh"', wmkf_reviewreceivedat: null })),
    ENTITY_SET_NAME: 'wmkf_appreviewersuggestions',
  };
});
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getByIdWithSelect: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
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
    // Context/draft read the cached set; submit re-resolves authoritatively.
    getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    getAuthoritativeQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    questionSetVersion: jest.fn(() => 'testver'),
  };
});
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  readRatingsBySuggestion: jest.fn(async () => ({ riskLevel: null, overallAssessment: null })),
}));
jest.mock('../../lib/services/capture-self-reported-orcid', () => ({
  captureSelfReportedReviewerOrcid: jest.fn(async () => ({})),
}));
jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  enqueueReviewerAcceptanceJob: jest.fn(async () => ({ id: 101, status: 'accept_pending' })),
  markReviewerAcceptanceJobQueued: jest.fn(async () => ({ id: 101, status: 'queued' })),
  cancelReviewerAcceptanceJob: jest.fn(async () => ({ id: 101, status: 'cancelled' })),
  cancelReviewerAcceptanceJobsForSuggestion: jest.fn(async () => [{ id: 101, status: 'cancelled' }]),
}));
jest.mock('../../lib/services/reviewer-withdrawal', () => ({
  deleteLateHonorariumForWithdrawnReviewer: jest.fn(async () => ({ deleted: false })),
  notifyProgramDirectorOfReviewerWithdrawal: jest.fn(async () => ({ id: 1 })),
}));
jest.mock('../../lib/services/review-draft-service', () => ({
  deleteBySuggestion: jest.fn(async () => 1),
}));

import { withDalContext } from '../../lib/dataverse/core/context';
import {
  applyStage2aResponse,
  getForSubmitFinalityCheck,
  updateLifecycle,
  deselectLegacyDeclinedSuggestion,
} from '../../lib/dataverse/adapters/reviewer-suggestion';
import { getByIdWithSelect as getSystemUserByIdWithSelect } from '../../lib/dataverse/adapters/system-user';
import { runChangeset } from '../../lib/dataverse/core/changeset';
import { getActivePolicies } from '../../lib/external/policy-fetcher';
import {
  enqueueReviewerAcceptanceJob,
  markReviewerAcceptanceJobQueued,
  cancelReviewerAcceptanceJob,
} from '../../lib/services/reviewer-acceptance-job-service';
import {
  deleteLateHonorariumForWithdrawnReviewer,
} from '../../lib/services/reviewer-withdrawal';
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
  it('hides only server-recognized generated filenames from the reviewer receipt', async () => {
    const generated = await buildReviewContext({
      suggestion: baseSuggestion({
        wmkf_reviewreceivedat: '2026-09-03T12:00:00Z',
        wmkf_reviewfilename: 'Review-1002903-Dr. R.docx',
        wmkf_reviewsharepointfolder:
          '1002903_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/Reviews',
      }),
      request,
      reviewer,
    });
    expect(generated.submission.filename).toBeNull();

    const uploaded = await buildReviewContext({
      suggestion: baseSuggestion({
        wmkf_reviewreceivedat: '2026-09-03T12:00:00Z',
        wmkf_reviewfilename: 'review.pdf',
        wmkf_reviewsharepointfolder:
          '1002903_A/Reviewer_Uploads/Smith/attempt_11111111111141118111111111111111',
      }),
      request,
      reviewer,
    });
    expect(uploaded.submission.filename).toBe('review.pdf');
  });

  it('stage2a policy failure throws the explicit fail-closed body', async () => {
    getActivePolicies.mockRejectedValueOnce(new Error('slot missing'));
    await expect(buildReviewContext({ suggestion: baseSuggestion(), request, reviewer }))
      .rejects.toMatchObject({ httpStatus: 500, body: { ok: false, reason: 'policy_misconfigured' } });
  });

  it('preserves the historical branch-specific DAL scope labels (first-access + stage2a) plus the S333 Stage 4b read-ratings scope', async () => {
    await buildReviewContext({
      suggestion: baseSuggestion({ wmkf_proposalfirstaccessed: null }),
      request,
      reviewer: { ...reviewer, _wmkf_contact_value: 'contact-1' },
    });
    const labels = withDalContext.mock.calls.map(([l]) => l);
    // 'read-ratings-by-suggestion' was pushed up here from
    // lib/external/review-answer-snapshot.js (S333 Stage 4b trust-model
    // tightening, site 44) — a sixth narrow scope, same label, same
    // sibling-to-not-inside-the-others posture as before the move.
    expect(labels).toEqual([
      'external-first-access',
      'external-context-refetch-etag',
      'read-ratings-by-suggestion',
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

  it('returns the active assigned Program Director contact for accepted-pre-materials', async () => {
    getSystemUserByIdWithSelect.mockResolvedValueOnce({
      systemuserid: 'pd-1',
      fullname: 'Jane Director',
      internalemailaddress: 'jane.director@wmkeck.org',
      isdisabled: false,
    });

    const payload = await buildReviewContext({
      suggestion: baseSuggestion({ wmkf_accepted: true }),
      request: { ...request, _wmkf_programdirector_value: 'pd-1' },
      reviewer,
    });

    expect(withDalContext).toHaveBeenCalledWith(
      'external-context-program-director',
      expect.any(Function),
    );
    expect(getSystemUserByIdWithSelect).toHaveBeenCalledWith('pd-1', [
      'systemuserid', 'fullname', 'internalemailaddress', 'isdisabled',
    ]);
    expect(payload.programDirector).toEqual({
      name: 'Jane Director',
      email: 'jane.director@wmkeck.org',
    });
  });

  it.each([
    {
      label: 'disabled',
      staff: {
        fullname: 'Former Director',
        internalemailaddress: 'former@wmkeck.org',
        isdisabled: true,
      },
    },
    {
      label: 'missing email',
      staff: {
        fullname: 'Jane Director',
        internalemailaddress: '',
        isdisabled: false,
      },
    },
    {
      label: 'missing name',
      staff: {
        fullname: '',
        internalemailaddress: 'jane.director@wmkeck.org',
        isdisabled: false,
      },
    },
  ])('omits a $label Program Director contact without failing the page', async ({ staff }) => {
    getSystemUserByIdWithSelect.mockResolvedValueOnce(staff);

    const payload = await buildReviewContext({
      suggestion: baseSuggestion({ wmkf_accepted: true }),
      request: { ...request, _wmkf_programdirector_value: 'pd-1' },
      reviewer,
    });

    expect(payload.programDirector).toBeNull();
  });

  it('keeps the accepted page available when the Program Director lookup fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    getSystemUserByIdWithSelect.mockRejectedValueOnce(new Error('transient Dataverse failure'));

    const payload = await buildReviewContext({
      suggestion: baseSuggestion({ wmkf_accepted: true }),
      request: { ...request, _wmkf_programdirector_value: 'pd-1' },
      reviewer,
    });

    expect(payload.programDirector).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[external context] program director lookup failed:',
      'transient Dataverse failure',
    );
    errorSpy.mockRestore();
  });

  it('does not load Program Director contact for views that do not render the confirmation', async () => {
    await buildReviewContext({
      suggestion: baseSuggestion(),
      request: { ...request, _wmkf_programdirector_value: 'pd-1' },
      reviewer,
    });

    expect(getSystemUserByIdWithSelect).not.toHaveBeenCalled();
  });
});

describe('applyReviewerResponse', () => {
  const acceptBody = () => ({
    action: 'accept',
    policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true },
    boardIdentity: { academicRank: 'Prof', primaryDepartment: 'Chem', mainInstitution: 'MIT' },
    address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' },
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

  it('validates and serializes structured decline referrals before the Dataverse write', async () => {
    await applyReviewerResponse({
      suggestion: baseSuggestion(),
      request,
      reviewer,
      body: {
        action: 'decline',
        decline: {
          reasonPicklist: 'too-busy',
          referrals: [{ name: 'Sarah Chen', institution: 'Stanford', email: 'chen@example.edu' }],
        },
      },
      ifMatch: 'W/"1"',
    });

    expect(applyStage2aResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        decline: expect.objectContaining({
          reasonPicklist: 'too-busy',
          referral: expect.stringMatching(/^wmkf-referrals:v1:/),
        }),
      }),
      expect.any(Object),
    );
    expect(applyStage2aResponse.mock.calls[0][1].decline).not.toHaveProperty('referrals');
  });

  it.each([
    { referrals: 'prose', reason: 'invalid_decline_referrals' },
    { referrals: [{ institution: 'MIT' }], reason: 'decline_referral_name_required' },
    { referrals: [{ name: 'Person', email: 'bad' }], reason: 'invalid_decline_referral_email' },
  ])('rejects malformed structured decline referrals before any write: $reason', async ({ referrals, reason }) => {
    await expect(applyReviewerResponse({
      suggestion: baseSuggestion(),
      request,
      reviewer,
      body: { action: 'decline', decline: { referrals } },
    })).rejects.toMatchObject({ httpStatus: 400, body: expect.objectContaining({ reason }) });
    expect(applyStage2aResponse).not.toHaveBeenCalled();
  });

  it('maps a racing late-honorarium cleanup on repeat decline to concurrent_modification', async () => {
    deleteLateHonorariumForWithdrawnReviewer.mockRejectedValueOnce(
      Object.assign(new Error('Dataverse returned 412'), { status: 412 }),
    );
    await expect(applyReviewerResponse({
      suggestion: baseSuggestion({
        wmkf_declined: true,
        _wmkf_honorariumrequest_value: 'honorarium-1',
      }),
      request,
      reviewer,
      body: { action: 'decline', decline: {} },
    })).rejects.toMatchObject({
      httpStatus: 412,
      body: { ok: false, reason: 'concurrent_modification' },
    });
  });

  it('repeat decline repairs a legacy row that is still selected', async () => {
    const result = await applyReviewerResponse({
      suggestion: baseSuggestion({
        wmkf_declined: true,
        wmkf_selected: true,
        _etag: 'W/"legacy"',
      }),
      request,
      reviewer,
      body: { action: 'decline', decline: {} },
    });

    expect(updateLifecycle).toHaveBeenCalledWith(
      expect.any(String),
      { selected: false },
      { ifMatch: 'W/"legacy"' },
    );
    expect(deselectLegacyDeclinedSuggestion).toHaveBeenCalledTimes(1);
    expect(deselectLegacyDeclinedSuggestion).toHaveBeenCalledWith(
      expect.any(String),
      { ifMatch: 'W/"legacy"' },
    );
    expect(result).toMatchObject({ ok: true, idempotent: true });
  });

  it('repeat-decline legacy repair calls the narrow op, not updateLifecycle directly', async () => {
    updateLifecycle.mockClear();
    deselectLegacyDeclinedSuggestion.mockClear();
    await applyReviewerResponse({
      suggestion: baseSuggestion({
        wmkf_declined: true,
        wmkf_selected: true,
        _etag: 'W/"legacy2"',
      }),
      request,
      reviewer,
      body: { action: 'decline', decline: {} },
    });

    expect(deselectLegacyDeclinedSuggestion).toHaveBeenCalledTimes(1);
    expect(deselectLegacyDeclinedSuggestion).toHaveBeenCalledWith(
      expect.any(String),
      { ifMatch: 'W/"legacy2"' },
    );
  });

  it('repeat-decline 412 from the legacy repair op maps to concurrent_modification', async () => {
    deselectLegacyDeclinedSuggestion.mockRejectedValueOnce(
      Object.assign(new Error('Dataverse returned 412'), { status: 412 }),
    );
    await expect(applyReviewerResponse({
      suggestion: baseSuggestion({
        wmkf_declined: true,
        wmkf_selected: true,
        _etag: 'W/"legacy3"',
      }),
      request,
      reviewer,
      body: { action: 'decline', decline: {} },
    })).rejects.toMatchObject({
      httpStatus: 412,
      body: { ok: false, reason: 'concurrent_modification' },
    });
  });

  it('already-deselected legacy row (wmkf_selected falsy) never calls the repair op', async () => {
    deselectLegacyDeclinedSuggestion.mockClear();
    updateLifecycle.mockClear();
    await applyReviewerResponse({
      suggestion: baseSuggestion({
        wmkf_declined: true,
        wmkf_selected: false,
        _etag: 'W/"already-clean"',
      }),
      request,
      reviewer,
      body: { action: 'decline', decline: {} },
    });

    expect(deselectLegacyDeclinedSuggestion).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
  });
});

describe('submitReview', () => {
  const { reviewFormSchema } = jest.requireActual('../../lib/external/review-form-schema');
  const validAnswers = () => ({
    affiliation: 'Professor of Physics, Example University',
    priorWork: '<p>a</p>',
    foreseenImpacts: '<p>a</p>',
    impactAreas: [1, 3],
    riskLevel: 2,
    riskDetail: '<p>a</p>',
    methodsAppropriate: '<p>a</p>',
    teamCapacity: '<p>a</p>',
    questionsForPi: '<p>a</p>',
    traditionalFunding: '<p>a</p>',
    overallAssessment: 4,
    additionalComments: '',
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
