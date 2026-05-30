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
import { GraphService } from '../../lib/services/graph-service';
import { getRequestSharePointBuckets } from '../../lib/utils/sharepoint-buckets';
import { writeReviewFiles } from '../../lib/services/review-upload';
import { applyStage2aResponse } from '../../lib/dataverse/adapters/reviewer-suggestion';

jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: jest.fn(),
}));

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    updateRecord: jest.fn(),
    queryRecords: jest.fn(async () => ({ records: [] })),
    getRecord: jest.fn(async () => null),
  },
}));

// Stage 2a (S143) added a getActivePolicies call to the context handler when
// engagement view is 'stage2a'. The fetcher throws on missing slots, which
// would 500 the handler before its file-listing logic. Stub it to return
// minimal valid policy data — these file-listing tests don't assert on
// policy contents.
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

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  applyStage2aResponse: jest.fn(async () => ({})),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));

// Honorarium onboarding (chunk-4) is exercised in its own unit test; here we
// only assert respond.js invokes it on accept (and not on decline/opt-out).
jest.mock('../../lib/bill/honorarium-onboard-orchestrator', () => ({
  ensureHonorariumOnboarding: jest.fn().mockResolvedValue({ honorariumRequestId: 'hon-1' }),
}));
jest.mock('../../lib/services/notification-service', () => ({
  notify: jest.fn().mockResolvedValue({ id: 1 }),
}));

const verifiedSuggestion = {
  ok: true,
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
  },
  reviewer: {
    wmkf_name: 'Dr. External Reviewer',
    wmkf_emailaddress: 'reviewer@example.org',
    wmkf_organizationname: 'Reviewer Org',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(res._data.files).toEqual([
      expect.objectContaining({
        id: 'allowed-file',
        library: 'akoya_request',
      }),
    ]);
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
    request: { akoya_requestid: 'request-1', akoya_requestnum: 'REQ-001' },
    reviewer: {},
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

  it('accept (fresh, not opted out) runs the honorarium orchestrator with suggestion/request/reviewer/body', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST',
      query: { token: 'good-token' },
      headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, address: { line1: '1 St', city: 'Town', postalCode: '94000', country: 'US' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(applyStage2aResponse).toHaveBeenCalledWith('suggestion-1', expect.objectContaining({ action: 'accept' }), expect.anything());
    expect(ensureHonorariumOnboarding).toHaveBeenCalledWith(expect.objectContaining({
      suggestion: fresh.suggestion, request: fresh.request, reviewer: fresh.reviewer,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('accept with honorariumOptOut:true does NOT run the orchestrator', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    ensureHonorariumOnboarding.mockClear();
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', honorariumOptOut: true, policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(ensureHonorariumOnboarding).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('re-accept (already accepted) STILL runs the orchestrator but skips the suggestion PATCH (Codex P1 #2)', async () => {
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
    expect(ensureHonorariumOnboarding).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
  });

  it('orchestrator failure is non-fatal: accept still 200 + alert fired', async () => {
    const { ensureHonorariumOnboarding } = require('../../lib/bill/honorarium-onboard-orchestrator');
    const NotificationService = require('../../lib/services/notification-service');
    ensureHonorariumOnboarding.mockClear();
    NotificationService.notify.mockClear();
    ensureHonorariumOnboarding.mockRejectedValueOnce(new Error('honorarium boom'));
    verifySuggestionToken.mockResolvedValue(fresh);
    const req = createMockReq({
      method: 'POST', query: { token: 'good-token' }, headers: {},
      body: { action: 'accept', policyAcks: { 'reviewer-coi': true, 'reviewer-ai-use': true }, address: { line1: '1 St', city: 'T', postalCode: '9', country: 'US' } },
    });
    const res = createMockRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'honorarium_onboard_failed' }));
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
});

