/**
 * /api/external/briefing/[token]/context and /document — method guard,
 * rate-limit ordering, verifier reasons, response headers, and the
 * member-required guard (docs/DELIBERATION_BRIEFING_PAGE_PLAN.md §2.3, §3).
 *
 * @jest-environment node
 */
jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ ok: true })),
  recordTokenOutcome: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/verify-briefing-token', () => ({ verifyBriefingToken: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/deliberation-briefing/briefing-page-service', () => ({
  buildBriefingContext: jest.fn(),
  resolveBriefingMember: jest.fn(),
}));

import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyBriefingToken } from '../../lib/external/verify-briefing-token';
import { buildBriefingContext, resolveBriefingMember } from '../../lib/services/deliberation-briefing/briefing-page-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import contextHandler from '../../pages/api/external/briefing/[token]/context';
import documentHandler from '../../pages/api/external/briefing/[token]/document';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  checkRateLimit.mockResolvedValue({ ok: true });
});

describe('context', () => {
  test('rejects non-GET', async () => {
    const res = mockRes();
    await contextHandler({ method: 'POST', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(405);
    expect(verifyBriefingToken).not.toHaveBeenCalled();
  });

  test('rate limit runs before verification and returns 429 with Retry-After', async () => {
    checkRateLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 30 });
    const res = mockRes();
    await contextHandler({ method: 'GET', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBe('30');
    expect(verifyBriefingToken).not.toHaveBeenCalled();
  });

  test('verifier failures map to 401 (or 404 for not_found) and are recorded', async () => {
    verifyBriefingToken.mockResolvedValueOnce({ ok: false, reason: 'revoked' });
    let res = mockRes();
    await contextHandler({ method: 'GET', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ ok: false, reason: 'revoked' });
    expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 't', false);

    verifyBriefingToken.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    res = mockRes();
    await contextHandler({ method: 'GET', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(404);
    expect(buildBriefingContext).not.toHaveBeenCalled();
  });

  test('a verified token returns the model with no-store caching', async () => {
    verifyBriefingToken.mockResolvedValueOnce({ ok: true, requestId: 'req', link: { id: 'l' } });
    buildBriefingContext.mockResolvedValueOnce({ ok: true, title: 'Example University', reviews: [] });
    const res = mockRes();
    await contextHandler({ method: 'GET', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.title).toBe('Example University');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(buildBriefingContext).toHaveBeenCalledWith({ requestId: 'req', link: { id: 'l' } });
  });
});

describe('document', () => {
  test('member is required before any rate-limit or verification work', async () => {
    const res = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(400);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test('streams a resolved member with nosniff, no-store, and a bounded filename', async () => {
    verifyBriefingToken.mockResolvedValueOnce({ ok: true, requestId: 'req', link: {} });
    resolveBriefingMember.mockResolvedValueOnce({
      buffer: Buffer.from('%PDF-'), mimeType: 'application/pdf', filename: 'Pre"Site\r\n.pdf', size: 5, inline: true,
    });
    const res = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't', member: 'writeup-pdf' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.headers['Content-Disposition']).toBe('inline; filename="PreSite.pdf"');
    expect(res.headers['Content-Length']).toBe(5);
    expect(resolveBriefingMember).toHaveBeenCalledWith({ requestId: 'req', member: 'writeup-pdf' });
  });

  test('a 404 from member resolution passes through as the service body', async () => {
    verifyBriefingToken.mockResolvedValueOnce({ ok: true, requestId: 'req', link: {} });
    resolveBriefingMember.mockRejectedValueOnce(new ServiceHttpError('nope', { httpStatus: 404, body: { ok: false, reason: 'not_found' } }));
    const res = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't', member: 'nope' } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ ok: false, reason: 'not_found' });
  });

  test('unexpected errors are sanitized to server_error', async () => {
    verifyBriefingToken.mockResolvedValueOnce({ ok: true, requestId: 'req', link: {} });
    resolveBriefingMember.mockRejectedValueOnce(new Error('Graph exploded with /drives/abc'));
    const res = mockRes();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await documentHandler({ method: 'GET', query: { token: 't', member: 'proposal' } }, res);
    errorSpy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ ok: false, reason: 'server_error' });
  });
});
