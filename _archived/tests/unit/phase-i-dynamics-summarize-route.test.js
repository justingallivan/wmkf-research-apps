/**
 * POST /api/phase-i-dynamics/summarize — akoya_requests read/write contract test.
 * Written tests-before the Wave-5(c) conversion to the grant-request adapter
 * (getById/updateById) per the data-access-layer migration plan's per-file
 * recipe: golden-path DTO shape + one failure path, pinned against CURRENT
 * behavior BEFORE the raw-call swap (the payload-boundary integration tests
 * cover the untrusted-content wrapping, not the Dynamics read/writeback
 * contract). `logAiRun` stays on raw DynamicsService (non-entity-transport,
 * out of Wave 5c scope) and is asserted unconverted here too.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), updateRecord: jest.fn(), logAiRun: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return Promise.resolve().then(() => fn());
  },
}));
jest.mock('../../lib/services/model-override-loader', () => ({ loadModelOverrides: jest.fn(async () => {}) }));
jest.mock('../../shared/api/middleware/rateLimiter', () => ({
  nextRateLimiter: () => jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../lib/utils/file-loader', () => ({
  loadFile: jest.fn(async () => ({ text: 'A'.repeat(200), filename: 'phase1.pdf' })),
}));
jest.mock('../../lib/services/llm-client', () => ({
  createLLMClient: jest.fn(() => ({
    complete: jest.fn(async () => ({
      text: 'A multi-paragraph Phase I summary that is well over twenty characters long.',
      model: 'claude-test',
    })),
  })),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import handler from '../../pages/api/phase-i-dynamics/summarize';

const GUID = '44444444-4444-4444-4444-444444444444';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const reqOf = (body) => ({ method: 'POST', body, headers: {} });

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p1', session: { user: { dynamicsSystemuserId: 'sys-1' } } });
  DynamicsService.getRecord.mockReset();
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  DynamicsService.logAiRun.mockReset().mockResolvedValue({ id: 'audit-1' });
  process.env.CLAUDE_API_KEY = 'sk-ant-test';
});

describe('POST /api/phase-i-dynamics/summarize — envelope inventory gap fill (Stage 5 Phase A)', () => {
  const validBody = () => ({
    requestGuid: GUID,
    fileRef: { source: 'upload', fileUrl: 'https://x.public.blob.vercel-storage.com/p.pdf', filename: 'phase1.pdf' },
  });

  test('405 on non-POST with pinned envelope, no auth check', async () => {
    const res = mockRes();
    await handler({ method: 'GET', body: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('unauth: requireAppAccess short-circuits before any Dynamics call', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await handler(reqOf(validBody()), res);
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'batch-phase-i-summaries');
  });

  test('domain error: missing requestGuid -> 400 pinned', async () => {
    const res = mockRes();
    await handler(reqOf({ fileRef: { source: 'upload' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'requestGuid is required' });
  });

  test('domain error: non-GUID requestGuid -> 400 pinned, no record read', async () => {
    const res = mockRes();
    await handler(reqOf({ requestGuid: 'not-a-guid', fileRef: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'requestGuid is not a valid GUID' });
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });

  test('domain error: missing fileRef -> 400 pinned', async () => {
    const res = mockRes();
    await handler(reqOf({ requestGuid: GUID }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'fileRef is required' });
  });

  test('golden: 200 envelope pinned fully', async () => {
    DynamicsService.getRecord.mockResolvedValueOnce({ wmkf_ai_summary: '', modifiedon: null, _etag: 'W/"1"' });
    const res = mockRes();
    await handler(reqOf(validBody()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      summary: 'A multi-paragraph Phase I summary that is well over twenty characters long.',
      filename: 'phase1.pdf',
      model: 'claude-test',
      writtenToDynamics: true,
      writebackFailure: null,
      auditLogCreated: true,
    });
  });

  test('409 conflict envelope pinned fully (existing summary, no overwrite)', async () => {
    DynamicsService.getRecord.mockResolvedValueOnce({
      wmkf_ai_summary: 'An existing prior summary.', modifiedon: '2026-01-01T00:00:00Z', _etag: 'W/"1"',
    });
    const res = mockRes();
    await handler(reqOf(validBody()), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      error: 'wmkf_ai_summary already populated — confirm overwrite to proceed',
      conflict: {
        field: 'wmkf_ai_summary',
        existingLength: 26,
        existingContent: 'An existing prior summary.',
        recordModifiedOn: '2026-01-01T00:00:00Z',
      },
    });
  });

  test('writeback failure is non-fatal: 200 with writebackFailure category + needs_review audit', async () => {
    DynamicsService.getRecord.mockResolvedValueOnce({ wmkf_ai_summary: '', modifiedon: null, _etag: 'W/"1"' });
    DynamicsService.updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
    const res = mockRes();
    await handler(reqOf(validBody()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ writtenToDynamics: false, writebackFailure: 'conflict', auditLogCreated: true });
    expect(DynamicsService.logAiRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'needs_review' }));
  });
});

describe('POST /api/phase-i-dynamics/summarize (grant-request adapter contract)', () => {
  test('golden: preflight read + conditional writeback, written to Dynamics', async () => {
    DynamicsService.getRecord.mockResolvedValueOnce({ wmkf_ai_summary: '', modifiedon: null, _etag: 'W/"1"' });

    const res = mockRes();
    await handler(reqOf({
      requestGuid: GUID,
      fileRef: { source: 'upload', fileUrl: 'https://x.public.blob.vercel-storage.com/p.pdf', filename: 'phase1.pdf' },
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.writtenToDynamics).toBe(true);
    expect(res.body.auditLogCreated).toBe(true);

    // Preflight read: exact entity + select shape.
    expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', GUID, {
      select: 'wmkf_ai_summary,modifiedon',
    });
    // Writeback PATCH: conditional on the preflight etag + acting user.
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith('akoya_requests', GUID,
      { wmkf_ai_summary: expect.any(String) },
      { ifMatch: 'W/"1"', actingUserSystemId: 'sys-1' });
    // Non-entity transport (logAiRun) is untouched by this conversion.
    expect(DynamicsService.logAiRun).toHaveBeenCalled();
  });

  test('failure: wmkf_ai_summary already populated -> 409 without overwrite=true', async () => {
    DynamicsService.getRecord.mockResolvedValueOnce({
      wmkf_ai_summary: 'An existing prior summary.', modifiedon: '2026-01-01T00:00:00Z', _etag: 'W/"1"',
    });

    const res = mockRes();
    await handler(reqOf({
      requestGuid: GUID,
      fileRef: { source: 'upload', fileUrl: 'https://x.public.blob.vercel-storage.com/p.pdf', filename: 'phase1.pdf' },
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/already populated/);
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });
});
