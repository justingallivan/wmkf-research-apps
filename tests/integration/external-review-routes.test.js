/**
 * Route-level regression tests for external reviewer magic-link endpoints.
 *
 * These routes are intentionally public, so the token verifier is the
 * authorization boundary. The tests here focus on fail-closed behavior and
 * file scoping at the route layer; token cryptography and row-state checks
 * live in tests/unit/verify-suggestion-token.test.js.
 */

import {
  createMockReq,
  createMockRes,
} from '../helpers/auth-mock';

import { verifySuggestionToken } from '../../lib/external/verify-suggestion-token';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { readRatingsBySuggestion } from '../../lib/external/review-answer-snapshot';
import { GraphService } from '../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets';
import { writeReviewFiles } from '../../lib/services/review-upload';
import { applyStage2aResponse } from '../../lib/dataverse/adapters/reviewer-suggestion';
import {
  enqueueReviewerAcceptanceJob,
  markReviewerAcceptanceJobQueued,
  cancelReviewerAcceptanceJob,
  cancelReviewerAcceptanceJobsForSuggestion,
} from '../../lib/services/reviewer-acceptance-job-service';

jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: jest.fn(),
  // Inline twin of the real tokenHasOp (fail-closed on missing/malformed ops).
  // Not jest.requireActual: loading the real module pulls in jose's ESM build,
  // which this jest environment cannot parse (see project-jsdom-serverless-esm-incompat).
  // The real predicate is unit-tested in tests/unit/verify-suggestion-token.test.js.
  tokenHasOp: (verified, op) =>
    Array.isArray(verified?.payload?.ops) && verified.payload.ops.includes(op),
}));

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    updateRecord: jest.fn(),
    queryRecords: jest.fn(async () => ({ records: [] })),
    getRecord: jest.fn(async () => null),
    createAndSendEmail: jest.fn(async () => ({ emailId: 'email-1' })),
  },
}));

// Stage 2a (S143) added a getActivePolicies call to the context handler when
// engagement view is 'stage2a'. The fetcher throws on missing slots, which
// would 500 the handler before its file-listing logic. Stub it to return
// minimal valid policy data — these file-listing tests don't assert on
// policy contents.
// Phase D: context prefill reads ratings from the answer snapshot. These
// file-listing/etag tests don't assert on ratings, so stub the read to nulls
// (a dedicated test asserts the snapshot→prefill mapping).
jest.mock('../../lib/external/review-answer-snapshot', () => ({
  readRatingsBySuggestion: jest.fn(async () => ({ impact: null, risk: null, overallRating: null })),
}));
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = jest.requireActual('../../lib/external/review-form-schema');
  return {
    getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields),
    questionSetVersion: jest.fn(() => 'testver'),
  };
});
jest.mock('../../lib/external/policy-fetcher', () => ({
  getActivePolicies: jest.fn(async (slotCodes) => {
    const out = {};
    for (const code of slotCodes) {
      out[code] = {
        slotCode: code,
        versionId: `test-version-${code}`,
        versionLabel: '1.0',
        title: `Test policy ${code}`,
        body: 'test policy body',
        effectiveDate: '2026-01-01',
      };
    }
    return out;
  }),
  getActivePolicy: jest.fn(),
  invalidate: jest.fn(),
}));

jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    listFiles: jest.fn(),
    getDriveId: jest.fn(),
    downloadFile: jest.fn(),
  },
}));

jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));

jest.mock('../../lib/services/review-upload', () => ({
  writeReviewFiles: jest.fn(),
}));

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => {
  // getForEtagRefresh / stampProposalFirstAccessed are thin DynamicsService
  // passthroughs (data-access-layer conversion, Stages 3-6) — forward through
  // the ALSO-mocked dynamics-service module so the existing assertions on
  // DynamicsService.getRecord/updateRecord below still see these calls.
  const { DynamicsService } = jest.requireMock('../../lib/services/dynamics-service');
  return {
    applyStage2aResponse: jest.fn(async () => ({})),
    getForEtagRefresh: (id) =>
      DynamicsService.getRecord('wmkf_appreviewersuggestions', id, { select: 'wmkf_appreviewersuggestionid' }),
    stampProposalFirstAccessed: (id) =>
      DynamicsService.updateRecord('wmkf_appreviewersuggestions', id, {
        wmkf_proposalfirstaccessed: new Date().toISOString(),
      }),
  };
});

jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  enqueueReviewerAcceptanceJob: jest.fn(async () => ({ id: 101, acceptance_key: 'acceptance-1', status: 'accept_pending' })),
  markReviewerAcceptanceJobQueued: jest.fn(async () => ({ id: 101, status: 'queued' })),
  cancelReviewerAcceptanceJob: jest.fn(async () => ({ id: 101, status: 'cancelled' })),
  cancelReviewerAcceptanceJobsForSuggestion: jest.fn(async () => [{ id: 101, status: 'cancelled' }]),
}));
jest.mock('../../lib/services/reviewer-withdrawal', () => ({
  deleteLateHonorariumForWithdrawnReviewer: jest.fn(async () => ({ deleted: false })),
  notifyProgramDirectorOfReviewerWithdrawal: jest.fn(async () => ({ id: 1 })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

// Honorarium onboarding is now drained from reviewer_acceptance_jobs; the route
// tests assert respond.js does not invoke the slow tail inline.
jest.mock('../../lib/bill/honorarium-onboard-orchestrator', () => ({
  ensureHonorariumOnboarding: jest.fn().mockResolvedValue({ honorariumRequestId: 'hon-1' }),
}));
jest.mock('../../lib/services/notification-service', () => ({
  notify: jest.fn().mockResolvedValue({ id: 1 }),
}));
// Acceptance confirmation is PD-voiced — resolve a known signature block so the
// rendered body carries the assigned-PD signature (matches reminder/withdraw flows).
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Dr. PD\nProgram Director\nW. M. Keck Foundation' })),
}));
jest.mock('../../lib/external/calendar-invite', () => ({
  buildReviewDueIcs: jest.fn(() => ({ filename: 'keck-review-due.ics', contentType: 'text/calendar', content: Buffer.from('ICS') })),
}));

const verifiedSuggestion = {
  ok: true,
  payload: { ops: ['download_proposal', 'upload_review'] },
  suggestion: {
    wmkf_appreviewersuggestionid: 'suggestion-1',
    _etag: 'W/"1001"',
    wmkf_externaltokenexpires: '2026-06-01T00:00:00.000Z',
    wmkf_proposalfirstaccessed: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewfilename: null,
    wmkf_revieweraffiliation: 'Reviewer Org',
    wmkf_reviewerimpact: 4,
    wmkf_reviewerrisk: 2,
    wmkf_revieweroverallrating: 5,
    // Stage 2b (materials sent). S143 gated file-listing on this view —
    // pre-materials views (stage2a / accepted-pre-materials / declined) no
    // longer call getRequestSharePointBuckets. The file-listing assertions
    // below need a stage2b/submitted view to fire.
    wmkf_accepted: true,
    wmkf_reviewstatus: 100000001,
  },
  request: {
    akoya_requestid: 'request-1',
    akoya_requestnum: 'REQ-001',
    akoya_title: 'Token Scoped Proposal',
    wmkf_meetingdate: '2026-07-01',
    wmkf_reviewduedate: '2026-08-15',
  },
  reviewer: {
    wmkf_name: 'Dr. External Reviewer',
    wmkf_emailaddress: 'reviewer@example.org',
    wmkf_organizationname: 'Reviewer Org',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NOTIFICATION_EMAIL_FROM = 'notifications@wmkeck.org';
});

describe('/api/external/review/[token]/context', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/external/review/[token]/context');
    handler = mod.default;
  });

  it('returns 401 and verifier reason when token is invalid', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'hash_mismatch' });
    const req = createMockReq({ method: 'GET', query: { token: 'bad-token' } });
    const res = createMockRes();

    await handler(req, res);

    expect(verifySuggestionToken).toHaveBeenCalledWith('bad-token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'hash_mismatch' });
    expect(GraphService.listFiles).not.toHaveBeenCalled();
  });

  it('returns 404 for verifier not_found', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'not_found' });
    const req = createMockReq({ method: 'GET', query: { token: 'missing-token' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'not_found' });
  });

  it('returns the assigned Program Director contact for accepted-pre-materials', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      suggestion: {
        ...verifiedSuggestion.suggestion,
        wmkf_accepted: true,
        wmkf_reviewstatus: null,
        wmkf_proposalfirstaccessed: '2026-05-01T00:00:00.000Z',
      },
      request: {
        ...verifiedSuggestion.request,
        _wmkf_programdirector_value: 'pd-1',
      },
    });
    DynamicsService.getRecord.mockImplementation(async (entitySet) => {
      if (entitySet === 'systemusers') {
        return {
          systemuserid: 'pd-1',
          fullname: 'Jane Director',
          internalemailaddress: 'jane.director@wmkeck.org',
          isdisabled: false,
        };
      }
      return null;
    });

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(DynamicsService.getRecord).toHaveBeenCalledWith('systemusers', 'pd-1', {
      select: 'systemuserid,fullname,internalemailaddress,isdisabled',
    });
    expect(res._data.programDirector).toEqual({
      name: 'Jane Director',
      email: 'jane.director@wmkeck.org',
    });
  });

  it('only returns files from reviewer-materials folders for the verified request', async () => {
    verifySuggestionToken.mockResolvedValue(verifiedSuggestion);
    getRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'REQ-001_request', source: 'active' },
    ]);
    GraphService.listFiles.mockResolvedValue([
      {
        id: 'allowed-file',
        name: 'proposal.pdf',
        size: 123,
        mimeType: 'application/pdf',
        folder: 'REQ-001_request/Reviewer_Downloads',
      },
      {
        id: 'blocked-file',
        name: 'internal-notes.pdf',
        size: 456,
        mimeType: 'application/pdf',
        folder: 'REQ-001_request/Internal',
      },
    ]);
    DynamicsService.updateRecord.mockResolvedValue({});

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();

    await handler(req, res);

    expect(getRequestSharePointBuckets).toHaveBeenCalledWith('request-1', 'REQ-001');
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      'suggestion-1',
      expect.objectContaining({ wmkf_proposalfirstaccessed: expect.any(String) }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._data.proposal.requestNumber).toBeUndefined();
    expect(res._data.files).toEqual([
      expect.objectContaining({
        id: 'allowed-file',
        library: 'akoya_request',
      }),
    ]);
    // stage2b authoring view: the live question set + version are attached for
    // the client to render from / echo back on submit.
    expect(Array.isArray(res._data.questions)).toBe(true);
    expect(res._data.questions.length).toBeGreaterThan(0);
    expect(res._data.questionSetVersion).toBe('testver');
  });

  it('surfaces the suggestion _etag (returning visitor, no first-access stamp) so the client can round-trip it as If-Match (eval #2)', async () => {
    // Already-accessed row → no stamp → the verify-time etag is returned as-is.
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      suggestion: { ...verifiedSuggestion.suggestion, wmkf_proposalfirstaccessed: '2026-05-01T00:00:00.000Z' },
    });
    getRequestSharePointBuckets.mockResolvedValue([]);

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._data.etag).toBe('W/"1001"');
    // No stamp on a returning visit.
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  it('first visit: returns the POST-stamp etag (re-read after first-access), not the stale pre-stamp one (Codex P1)', async () => {
    // verifiedSuggestion has wmkf_proposalfirstaccessed: null → stamp fires,
    // bumping the row etag. The handler must re-read and return the new etag,
    // not the stale 'W/"1001"' it read before stamping.
    verifySuggestionToken.mockResolvedValue(verifiedSuggestion);
    getRequestSharePointBuckets.mockResolvedValue([]);
    DynamicsService.updateRecord.mockResolvedValue({});
    DynamicsService.getRecord.mockResolvedValueOnce({
      wmkf_appreviewersuggestionid: 'suggestion-1',
      _etag: 'W/"2002"',
    });

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(DynamicsService.updateRecord).toHaveBeenCalled(); // stamp fired
    expect(res._data.etag).toBe('W/"2002"'); // post-stamp re-read, not 'W/"1001"'
  });

  it('first visit: a failed etag re-read returns null (disables the lock for this response) rather than a stale etag', async () => {
    verifySuggestionToken.mockResolvedValue(verifiedSuggestion);
    getRequestSharePointBuckets.mockResolvedValue([]);
    DynamicsService.updateRecord.mockResolvedValue({});
    DynamicsService.getRecord.mockRejectedValueOnce(new Error('transient'));

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._data.etag).toBeNull();
  });

  it('Phase D: prefill ratings come from the answer snapshot, not the suggestion row', async () => {
    verifySuggestionToken.mockResolvedValue(verifiedSuggestion);
    getRequestSharePointBuckets.mockResolvedValue([]);
    DynamicsService.updateRecord.mockResolvedValue({});
    // The snapshot read drives the prefill ratings.
    readRatingsBySuggestion.mockResolvedValueOnce({ impact: 4, risk: 2, overallRating: 5 });

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(readRatingsBySuggestion).toHaveBeenCalledWith('suggestion-1');
    expect(res._data.prefill).toMatchObject({ impact: 4, risk: 2, overallRating: 5 });
  });

  it('stage2a with a promoted-contact reviewer looks up the contact with the prefill select (contact.getByIdWithSelect passthrough)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      suggestion: {
        ...verifiedSuggestion.suggestion,
        wmkf_accepted: false,
        wmkf_declined: false,
        wmkf_reviewstatus: null,
        wmkf_reviewreceivedat: null,
      },
      reviewer: { ...verifiedSuggestion.reviewer, _wmkf_contact_value: 'contact-1' },
    });
    getRequestSharePointBuckets.mockResolvedValue([]);
    DynamicsService.getRecord.mockImplementation(async (entitySet) => {
      if (entitySet === 'contacts') {
        return { contactid: 'contact-1', firstname: 'Jane', lastname: 'Doe' };
      }
      return { wmkf_appreviewersuggestionid: 'suggestion-1', _etag: 'W/"1001"' };
    });

    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(DynamicsService.getRecord).toHaveBeenCalledWith('contacts', 'contact-1', {
      select: [
        'firstname', 'lastname', 'nickname', 'jobtitle', 'emailaddress1',
        'wmkf_orcid', 'adx_organizationname', '_parentcustomerid_value',
        'address1_line1', 'address1_line2', 'address1_city',
        'address1_stateorprovince', 'address1_postalcode', 'address1_country',
      ].join(','),
    });
  });

  // ── Stage 5 Phase A gap fill — envelope pins ──────────────────────────────
  it('405s a non-GET with Allow header and the { ok:false, reason } envelope', async () => {
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'method_not_allowed' });
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
    expect(verifySuggestionToken).not.toHaveBeenCalled();
  });

  it('stage2a: policy fetch failure is fail-closed → 500 policy_misconfigured (envelope pinned)', async () => {
    const { getActivePolicies } = require('../../lib/external/policy-fetcher');
    getActivePolicies.mockRejectedValueOnce(new Error('missing slot'));
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      suggestion: {
        ...verifiedSuggestion.suggestion,
        wmkf_proposalfirstaccessed: '2026-05-01T00:00:00.000Z',
        wmkf_accepted: false, wmkf_declined: false, wmkf_reviewstatus: null, wmkf_reviewreceivedat: null,
      },
    });
    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'policy_misconfigured' });
  });

  it('stage2a 200 envelope: full top-level key set pinned (files empty, questions null pre-materials)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      suggestion: {
        ...verifiedSuggestion.suggestion,
        wmkf_proposalfirstaccessed: '2026-05-01T00:00:00.000Z',
        wmkf_accepted: false, wmkf_declined: false, wmkf_reviewstatus: null, wmkf_reviewreceivedat: null,
      },
    });
    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Object.keys(res._data).sort()).toEqual([
      'engagementState', 'etag', 'files', 'ok', 'policies', 'prefill',
      'programDirector', 'proposal', 'questionSetVersion', 'questions', 'reviewer',
      'submission', 'tokenExpiresAt',
    ]);
    expect(res._data.ok).toBe(true);
    expect(res._data.engagementState.view).toBe('stage2a');
    expect(res._data.files).toEqual([]); // pre-materials: no Graph round trip
    expect(getRequestSharePointBuckets).not.toHaveBeenCalled();
    expect(res._data.questions).toBeNull();
    expect(res._data.questionSetVersion).toBeNull();
    expect(res._data.policies).toEqual(expect.objectContaining({ 'reviewer-coi': expect.any(Object) }));
    // Stage-2a prefill fields present (additive contract).
    expect(res._data.prefill).toEqual(expect.objectContaining({
      affiliation: expect.any(String), firstName: expect.any(String), address: expect.any(Object),
    }));
  });
});

describe('/api/external/review/[token]/proposal', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/external/review/[token]/proposal');
    handler = mod.default;
  });

  it('returns 401 and does not touch Graph when token is invalid', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'revoked' });
    const req = createMockReq({
      method: 'GET',
      query: { token: 'revoked-token', fileId: 'file-1', library: 'akoya_request' },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'revoked' });
    expect(GraphService.listFiles).not.toHaveBeenCalled();
    expect(GraphService.downloadFile).not.toHaveBeenCalled();
  });

  it('403s when the verified token ops does not include download_proposal', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      payload: { ops: ['upload_review'] },
    });
    const req = createMockReq({
      method: 'GET',
      query: { token: 'good-token', fileId: 'allowed-file', library: 'akoya_request' },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'op_not_permitted' });
    expect(GraphService.downloadFile).not.toHaveBeenCalled();
  });

  it('403s when the verified token has a missing/malformed ops array', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      payload: {},
    });
    const req = createMockReq({
      method: 'GET',
      query: { token: 'good-token', fileId: 'allowed-file', library: 'akoya_request' },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'op_not_permitted' });
    expect(GraphService.downloadFile).not.toHaveBeenCalled();
  });

  it('rejects a valid token when the requested file is outside reviewer materials', async () => {
    verifySuggestionToken.mockResolvedValue(verifiedSuggestion);
    getRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'REQ-001_request', source: 'active' },
    ]);
    GraphService.listFiles.mockResolvedValue([
      {
        id: 'blocked-file',
        name: 'internal-notes.pdf',
        folder: 'REQ-001_request/Internal',
      },
    ]);

    const req = createMockReq({
      method: 'GET',
      query: { token: 'good-token', fileId: 'blocked-file', library: 'akoya_request' },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'file_not_in_request_set' });
    expect(GraphService.downloadFile).not.toHaveBeenCalled();
  });

  it('downloads only a file that belongs to reviewer materials for the verified request', async () => {
    verifySuggestionToken.mockResolvedValue(verifiedSuggestion);
    getRequestSharePointBuckets.mockResolvedValue([
      { library: 'akoya_request', folder: 'REQ-001_request', source: 'active' },
    ]);
    GraphService.listFiles.mockResolvedValue([
      {
        id: 'allowed-file',
        name: 'proposal.pdf',
        folder: 'REQ-001_request/Reviewer_Downloads',
      },
    ]);
    GraphService.getDriveId.mockResolvedValue('drive-1');
    GraphService.downloadFile.mockResolvedValue({
      filename: 'proposal.pdf',
      mimeType: 'application/pdf',
      size: 10,
      buffer: Buffer.from('test-file'),
    });

    const req = createMockReq({
      method: 'GET',
      query: { token: 'good-token', fileId: 'allowed-file', library: 'akoya_request' },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(GraphService.getDriveId).toHaveBeenCalledWith('akoya_request');
    expect(GraphService.downloadFile).toHaveBeenCalledWith('drive-1', 'allowed-file');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('test-file'));
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
});

describe('/api/external/review/[token]/upload', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/external/review/[token]/upload');
    handler = mod.default;
  });

  it('returns 401 and does not parse/write files when token is expired', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const req = createMockReq({
      method: 'POST',
      query: { token: 'expired-token' },
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });
    req.pipe = jest.fn();
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'expired' });
    expect(req.pipe).not.toHaveBeenCalled();
    expect(writeReviewFiles).not.toHaveBeenCalled();
  });

  it('403s when the verified token ops does not include upload_review', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...verifiedSuggestion,
      payload: { ops: ['download_proposal'] },
    });
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });
    req.pipe = jest.fn();
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'op_not_permitted' });
    expect(req.pipe).not.toHaveBeenCalled();
    expect(writeReviewFiles).not.toHaveBeenCalled();
  });
});

describe('/api/external/review/[token]/respond', () => {
  let handler;

  beforeAll(async () => {
    const mod = await import('../../pages/api/external/review/[token]/respond');
    handler = mod.default;
  });

  // A fresh pre-materials engagement: accept/decline/flip all permitted.
  const fresh = {
    ok: true,
    suggestion: {
      wmkf_appreviewersuggestionid: 'suggestion-1',
      _etag: 'W/"1001"',
      wmkf_reviewstatus: null,
      wmkf_responsetype: null,
      wmkf_accepted: false,
      wmkf_declined: false,
    },
    request: { akoya_requestid: 'request-1', akoya_requestnum: 'REQ-001', akoya_title: 'Token Scoped Proposal', wmkf_reviewduedate: '2026-08-15' },
    reviewer: { wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'reviewer@example.org' },
  };

  it('forwards the client If-Match header to the adapter as the optimistic lock (eval #2)', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: { 'if-match': 'W/"1001"' },
      body: { action: 'decline', decline: {} },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(applyStage2aResponse).toHaveBeenCalledWith(
      'suggestion-1',
      expect.objectContaining({ action: 'decline' }),
      expect.objectContaining({ ifMatch: 'W/"1001"' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps a 412 from the adapter to a clean concurrent_modification response', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    applyStage2aResponse.mockRejectedValueOnce(Object.assign(new Error('Update failed (412)'), { status: 412 }));
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: { 'if-match': 'W/"stale"' },
      body: { action: 'decline', decline: {} },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(412);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'concurrent_modification' });
  });

  it('accept (fresh, not opted out) stages a durable acceptance job before returning', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({
      suggestion: fresh.suggestion,
      request: fresh.request,
      reviewer: fresh.reviewer,
      isAcceptRepeat: false,
      optedOut: false,
      status: 'accept_pending',
      acceptedSuggestion: expect.objectContaining({ wmkf_revieweremail: null }),
    }));
    const stagedAt = enqueueReviewerAcceptanceJob.mock.calls[0][0].acceptedAt;
    expect(applyStage2aResponse).toHaveBeenCalledWith(
      'suggestion-1',
      expect.objectContaining({ action: 'accept', responseReceivedAt: stagedAt }),
      expect.anything(),
    );
    expect(markReviewerAcceptanceJobQueued).toHaveBeenCalledWith(101);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('fresh accept WITHOUT board identity is rejected 400 board_identity_required (S308)', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    applyStage2aResponse.mockClear();
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      // policy acks present, but boardIdentity omitted entirely
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      reason: 'board_identity_required',
      fields: ['academicRank', 'primaryDepartment', 'mainInstitution'],
    }));
    // The suggestion accept must NOT have committed.
    expect(applyStage2aResponse).not.toHaveBeenCalled();
  });

  it('fresh accept with a whitespace-only board field is rejected 400 (S308)', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: '   ', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'board_identity_required',
      fields: ['primaryDepartment'],
    }));
  });

  it('fresh accept does not send the acceptance confirmation inline', async () => {
    const { buildReviewDueIcs } = require('../../lib/external/calendar-invite');
    DynamicsService.createAndSendEmail.mockClear();
    buildReviewDueIcs.mockClear();
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      reviewer: { wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'reviewer@example.org' },
    });
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(buildReviewDueIcs).not.toHaveBeenCalled();
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({
      isAcceptRepeat: false,
      request: expect.objectContaining({ wmkf_reviewduedate: '2026-08-15' }),
    }));
  });

  it('accept with honorariumOptOut:true stages an opted-out job and does NOT run the orchestrator inline', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', honorariumOptOut: true, policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({
      optedOut: true,
      status: 'accept_pending',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('re-accept (already accepted) queues follow-up retry but skips the suggestion PATCH (Codex P1 #2)', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    applyStage2aResponse.mockClear();
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_accepted: true, wmkf_declined: false },
    });
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept' },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(applyStage2aResponse).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({
      isAcceptRepeat: true,
      status: 'queued',
    }));
    expect(markReviewerAcceptanceJobQueued).toHaveBeenCalledWith(101);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
  });

  it('re-accept does NOT send acceptance confirmation email', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    DynamicsService.createAndSendEmail.mockClear();
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_accepted: true, wmkf_declined: false },
      reviewer: { wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'reviewer@example.org' },
    });
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept' },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({ isAcceptRepeat: true }));
    expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
  });

  it('re-accept honors the PERSISTED opt-out in the staged job (body omits the flag) (Codex post-impl F2)', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_accepted: true, wmkf_declined: false, wmkf_honorariumoptout: true },
    });
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'accept' } });
    const res = createMockRes();
    await handler(req, res);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({
      isAcceptRepeat: true,
      optedOut: true,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('queue-marker failure is non-fatal after the acceptance job has been staged', async () => {
    markReviewerAcceptanceJobQueued.mockRejectedValueOnce(new Error('queue marker down'));
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'T', postalCode: '9', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalled();
    expect(applyStage2aResponse).toHaveBeenCalled();
  });

  it('accept PATCH conflict cancels the staged job and returns 412', async () => {
    applyStage2aResponse.mockRejectedValueOnce(Object.assign(new Error('Update failed (412)'), { status: 412 }));
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'T', postalCode: '9', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalled();
    expect(cancelReviewerAcceptanceJob).toHaveBeenCalledWith(101, 'Update failed (412)');
    expect(markReviewerAcceptanceJobQueued).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(412);
  });

  it('accept PATCH transport failure leaves the staged job for drain verification', async () => {
    applyStage2aResponse.mockRejectedValueOnce(new Error('Dataverse timeout after write'));
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'T', postalCode: '9', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalled();
    expect(cancelReviewerAcceptanceJob).not.toHaveBeenCalled();
    expect(markReviewerAcceptanceJobQueued).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('decline does NOT run the honorarium orchestrator', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'decline', decline: {} },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
  });

  it('allows self-service withdrawal before materials and removes the exact linked honorarium', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: {
        ...fresh.suggestion,
        wmkf_accepted: true,
        wmkf_declined: false,
        _wmkf_honorariumrequest_value: 'honorarium-1',
      },
    });
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: {
        action: 'decline',
        decline: { reasonPicklist: 'too-busy', referral: 'Dr. Alternate' },
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(applyStage2aResponse).toHaveBeenCalledWith(
      'suggestion-1',
      expect.objectContaining({
        action: 'decline',
        decline: expect.objectContaining({ referral: 'Dr. Alternate' }),
      }),
      expect.objectContaining({
        deleteHonorariumRequestId: 'honorarium-1',
      }),
    );
    expect(cancelReviewerAcceptanceJobsForSuggestion).toHaveBeenCalledWith(
      'suggestion-1',
      'reviewer_withdrew_before_materials',
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a malformed address with 400 before any write', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', address: { country: 'U' } }, // ISO2 violation (len 1, passes the cap, fails ISO2 shape)
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_country', field: 'country' }));
  });

  it('rejects an over-long contactEdits field with 400 and never writes (eval #6)', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'decline', contactEdits: { firstName: 'x'.repeat(101) } },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'contact_field_too_long', field: 'firstName' }));
    expect(applyStage2aResponse).not.toHaveBeenCalled();
  });

  it('rejects a malformed email in contactEdits with 400', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'decline', contactEdits: { email: 'not-an-email' } },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_email', field: 'email' }));
    expect(applyStage2aResponse).not.toHaveBeenCalled();
  });

  it('rejects an unknown contactEdits field with 400', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'decline', contactEdits: { ssn: '123' } },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'unknown_contact_field', field: 'ssn' }));
    expect(applyStage2aResponse).not.toHaveBeenCalled();
  });

  // ── Retired hold path + direct accept transition matrix ──
  const respondReq = (suggestion, body) => {
    verifySuggestionToken.mockResolvedValue({ ...fresh, suggestion: { ...fresh.suggestion, ...suggestion } });
    return createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body });
  };

  it('fresh accept goes straight through the full accept path', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'T', postalCode: '9', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(applyStage2aResponse).toHaveBeenCalledWith('suggestion-1', expect.objectContaining({ action: 'accept' }), expect.anything());
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({ isAcceptRepeat: false }));
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('REPEAT accept (already accepted) still queues honorarium retry', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    verifySuggestionToken.mockResolvedValue({ ...fresh, suggestion: { ...fresh.suggestion, wmkf_accepted: true } });
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'accept' } });
    const res = createMockRes();
    await handler(req, res);
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({ isAcceptRepeat: true }));
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('any action on a review-received row → 409 review_received_locked (side-channel receipt without materials_sent)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_reviewreceivedat: '2026-06-14T00:00:00Z' },
    });
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'decline', decline: {} } });
    const res = createMockRes();
    await handler(req, res);
    expect(applyStage2aResponse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'review_received_locked' }));
  });

  it('invalid action → 400 invalid_action', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'maybe' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'invalid_action' }));
  });

  // ── Remaining transition-matrix cells (Codex chunk-3 #2) ──
  it('historical held → accept runs the accept write and stages follow-up work', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_responsetype: 100000004 }, // held, not accepted
    });
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'T', postalCode: '9', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(applyStage2aResponse).toHaveBeenCalledWith('suggestion-1', expect.objectContaining({ action: 'accept' }), expect.anything());
    expect(enqueueReviewerAcceptanceJob).toHaveBeenCalledWith(expect.objectContaining({ isAcceptRepeat: false }));
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('held → decline (flip) → 200, adapter called with action:decline', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_responsetype: 100000004 },
    });
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'decline', decline: {} } });
    const res = createMockRes();
    await handler(req, res);
    expect(applyStage2aResponse).toHaveBeenCalledWith('suggestion-1', expect.objectContaining({ action: 'decline' }), expect.anything());
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('withdrawn_sufficient + decline → 409 withdrawn_sufficient', async () => {
    const res = createMockRes();
    await handler(respondReq({ wmkf_responsetype: 100000003 }, { action: 'decline', decline: {} }), res);
    expect(applyStage2aResponse).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reason: 'withdrawn_sufficient' }));
  });

  // ── Stage 5 Phase A gap fill — envelope + ordering pins ──────────────────
  it('405s a non-POST with Allow header and the { ok:false, reason } envelope', async () => {
    const req = createMockReq({ method: 'GET', query: { token: 'good-token' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'method_not_allowed' });
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(verifySuggestionToken).not.toHaveBeenCalled();
  });

  it('invalid token → 401 with the verifier reason; nothing staged or written', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'expired' });
    const req = createMockReq({ method: 'POST', query: { token: 'stale' }, headers: {}, body: { action: 'decline' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'expired' });
    expect(applyStage2aResponse).not.toHaveBeenCalled();
    expect(enqueueReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('unknown token → 404 not_found envelope', async () => {
    verifySuggestionToken.mockResolvedValue({ ok: false, reason: 'not_found' });
    const req = createMockReq({ method: 'POST', query: { token: 'missing' }, headers: {}, body: { action: 'decline' } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ ok: false, reason: 'not_found' });
  });

  it('fresh accept 200 envelope pinned exactly (drain contract: acceptanceJobId surfaced)', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._data).toEqual({
      ok: true,
      idempotent: false,
      acceptanceJobId: 101,
      engagementState: { view: 'accepted-pre-materials', accepted: true, declined: false },
    });
  });

  it('accept write ORDERING pinned: durable job staged accept_pending BEFORE the Dataverse PATCH, queued-marker after (drain contract)', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' }, address: { line1: '1 St', city: 'Town', postalCode: '94000', state: 'NY', country: 'US', phone: '+1 555 0100' } },
    });
    const res = createMockRes();
    await handler(req, res);
    const enqueueOrder = enqueueReviewerAcceptanceJob.mock.invocationCallOrder[0];
    const patchOrder = applyStage2aResponse.mock.invocationCallOrder[0];
    const queuedOrder = markReviewerAcceptanceJobQueued.mock.invocationCallOrder[0];
    expect(enqueueOrder).toBeLessThan(patchOrder);
    expect(patchOrder).toBeLessThan(queuedOrder);
    // Status value the drain consumes — must never change spelling.
    expect(enqueueReviewerAcceptanceJob.mock.calls[0][0].status).toBe('accept_pending');
  });

  it('fresh decline 200 envelope pinned exactly', async () => {
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'decline', decline: {} } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._data).toEqual({
      ok: true,
      idempotent: false,
      engagementState: { view: 'declined', accepted: false, declined: true },
    });
  });

  it('repeat decline replays idempotently with NO re-stamp (envelope pinned)', async () => {
    verifySuggestionToken.mockResolvedValue({
      ...fresh,
      suggestion: { ...fresh.suggestion, wmkf_declined: true },
    });
    const req = createMockReq({ method: 'POST', query: { token: 'good-token' }, headers: {}, body: { action: 'decline', decline: {} } });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._data).toEqual({
      ok: true,
      idempotent: true,
      engagementState: { view: 'declined', accepted: false, declined: true },
    });
    expect(applyStage2aResponse).not.toHaveBeenCalled();
  });
});
