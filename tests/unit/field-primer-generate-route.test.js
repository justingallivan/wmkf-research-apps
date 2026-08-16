/**
 * POST /api/field-primer/generate — requestId (Workbench) mode contract test.
 * Written tests-before the Wave-5(c) conversion to the grant-request adapter
 * (getById/updateById) per the data-access-layer migration plan's per-file
 * recipe: golden-path DTO shape + one failure path, pinned against CURRENT
 * behavior BEFORE any raw-call swap so the conversion is provably a no-op.
 *
 * Covers: reuse-existing (no paid call), full generate+persist golden path,
 * and the 404 failure path (no request found).
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return Promise.resolve().then(() => fn());
  },
}));
jest.mock('../../lib/services/model-override-loader', () => ({
  loadModelOverrides: jest.fn(async () => {}),
}));
jest.mock('../../lib/services/field-primer-service', () => ({
  generateFieldPrimer: jest.fn(),
  groundPrimerExperts: jest.fn(async (experts) => experts),
}));
jest.mock('../../lib/services/workbench-proposal-documents', () => ({
  getAiProposalNarrativeText: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { generateFieldPrimer } from '../../lib/services/field-primer-service';
import { getAiProposalNarrativeText } from '../../lib/services/workbench-proposal-documents';
import { FIELD_PRIMER_ENVELOPE_SCHEMA, makeFieldPrimerLease } from '../../shared/utils/field-primer-envelope';
import handler from '../../pages/api/field-primer/generate';

const GUID = '33333333-3333-3333-3333-333333333333';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const reqOf = (body) => ({ method: 'POST', body, headers: {} });

function row(over = {}) {
  return {
    akoya_requestid: GUID,
    akoya_requestnum: '1002900',
    wmkf_meetingdate: '2026-06-15',
    wmkf_ai_fieldprimer: null,
    _etag: 'W/"1"',
    ...over,
  };
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ session: { user: {} } });
  DynamicsService.getRecord.mockReset();
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  generateFieldPrimer.mockReset();
  getAiProposalNarrativeText.mockReset();
});

describe('POST /api/field-primer/generate — envelope inventory gap fill (Stage 5 Phase A)', () => {
  test('405 on non-POST, Allow header omitted (route does not set one)', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('unauth: requireAppAccess short-circuits (writes its own response, handler returns without calling downstream)', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await handler(reqOf({ requestId: GUID }), res);
    // requireAppAccess owns the response in the false-return contract; the route
    // itself must not have progressed past the gate.
    expect(generateFieldPrimer).not.toHaveBeenCalled();
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
    expect(requireAppAccess).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'reviewer-finder', 'reviewers',
    );
  });

  test('golden: standalone Mode B (proposalText, no requestId) — full envelope pinned, no persistence', async () => {
    generateFieldPrimer.mockResolvedValue({
      primer: { experts: [] }, model: 'claude-test', runId: 'run-standalone',
    });
    const res = mockRes();
    await handler(reqOf({ proposalText: 'B'.repeat(60), focus: 'genomics' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ primer: { experts: [] }, runId: 'run-standalone', model: 'claude-test' });
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    expect(generateFieldPrimer).toHaveBeenCalledWith({
      proposalText: 'B'.repeat(60), focus: 'genomics', runSource: 'Vercel Interactive',
    });
  });

  test('domain error: standalone Mode B with no requestId and short proposalText -> 400', async () => {
    const res = mockRes();
    await handler(reqOf({ proposalText: 'too short' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'proposalText is required (min ~50 chars), or pass a requestId.' });
    expect(generateFieldPrimer).not.toHaveBeenCalled();
  });

  test('domain error: invalid requestId GUID -> 400, no adapter call', async () => {
    const res = mockRes();
    await handler(reqOf({ requestId: 'not-a-guid' }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'requestId is not a valid GUID' });
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });
});

describe('POST /api/field-primer/generate (requestId mode, grant-request adapter contract)', () => {
  test('golden: reuse-existing envelope — no paid call, persisted:true reused:true', async () => {
    const envelope = { schema: FIELD_PRIMER_ENVELOPE_SCHEMA, generatedAt: '2026-01-01T00:00:00.000Z', primer: { experts: [] } };
    DynamicsService.getRecord.mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: JSON.stringify(envelope) }));

    const res = mockRes();
    await handler(reqOf({ requestId: GUID }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ envelope, persisted: true, reused: true });
    expect(generateFieldPrimer).not.toHaveBeenCalled();
    // Read went through the adapter's entity set + select shape unchanged.
    expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', GUID, {
      select: 'akoya_requestid,akoya_requestnum,wmkf_ai_fieldprimer',
    });
  });

  test('golden: full generate + persist — lease claim, generation, conditional persist', async () => {
    // The pre-persist re-read must see the SAME lease (nonce) the route just wrote
    // via the lease-claim PATCH, so track it rather than hardcoding a nonce we
    // don't control (randomUUID() is internal to the route).
    let writtenLease = null;
    DynamicsService.getRecord
      .mockResolvedValueOnce(row()) // initial fetch (no prior envelope, no _etag conflict)
      .mockImplementationOnce(async () => ({ wmkf_ai_fieldprimer: writtenLease, _etag: 'W/"2"' })); // pre-persist re-read
    DynamicsService.updateRecord.mockImplementation(async (_entity, _id, data) => {
      if (data.wmkf_ai_fieldprimer && typeof data.wmkf_ai_fieldprimer === 'string' && data.wmkf_ai_fieldprimer.includes('field-primer/lease')) {
        writtenLease = data.wmkf_ai_fieldprimer;
      }
      return {};
    });
    getAiProposalNarrativeText.mockResolvedValue({
      text: 'A'.repeat(60),
      filename: 'ProposalNarrative_1002900.pdf',
    });
    generateFieldPrimer.mockResolvedValue({
      primer: { experts: [] }, model: 'claude-test', runId: 'run-1', promptName: 'field-primer', promptVersion: 1,
    });

    const res = mockRes();
    await handler(reqOf({ requestId: GUID }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.persisted).toBe(true);
    expect(res.body.envelope.model).toBe('claude-test');

    // Lease claim PATCH: conditional on the initial read's etag.
    expect(DynamicsService.updateRecord).toHaveBeenNthCalledWith(
      1, 'akoya_requests', GUID,
      { wmkf_ai_fieldprimer: expect.any(String) },
      { ifMatch: 'W/"1"' },
    );
    // Final persist PATCH: conditional on the pre-persist re-read's etag.
    expect(DynamicsService.updateRecord).toHaveBeenNthCalledWith(
      2, 'akoya_requests', GUID,
      { wmkf_ai_fieldprimer: JSON.stringify(res.body.envelope) },
      { ifMatch: 'W/"2"' },
    );
  });

  test('failure: no request found for requestId -> 404', async () => {
    DynamicsService.getRecord.mockRejectedValueOnce(new Error('not found'));

    const res = mockRes();
    await handler(reqOf({ requestId: GUID }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: `No request found for ${GUID}` });
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  test('behavior lock: a FRESH lease held by a peer -> {status: "generating"}, no lease-claim PATCH', async () => {
    const lease = makeFieldPrimerLease(new Date().toISOString(), 'peer-nonce');
    DynamicsService.getRecord.mockResolvedValueOnce(row({ wmkf_ai_fieldprimer: lease }));

    const res = mockRes();
    await handler(reqOf({ requestId: GUID }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'generating' });
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});
