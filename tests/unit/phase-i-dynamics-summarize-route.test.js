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
