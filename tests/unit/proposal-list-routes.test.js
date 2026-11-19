/**
 * Proposal list routes — the staff route's app gate, session-only actor and
 * body allowlist; the external routes' order (rate limit, verify, resolve) and
 * fail-closed answers (docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md).
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/external/rate-limit', () => ({
  checkRateLimit: jest.fn(async () => ({ ok: true })),
  recordTokenOutcome: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/verify-proposal-list-token', () => ({ verifyProposalListToken: jest.fn() }));
jest.mock('../../lib/services/proposal-lists/list-page-service', () => ({
  buildProposalListContext: jest.fn(),
  resolveProposalListDocument: jest.fn(),
}));
jest.mock('../../lib/services/proposal-lists/list-link-service', () => ({
  createProposalList: jest.fn(),
  getProposalListDetail: jest.fn(),
  getProposalListOverview: jest.fn(),
  rebuildProposalList: jest.fn(),
  revokeProposalList: jest.fn(),
  setProposalListMarks: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { checkRateLimit, recordTokenOutcome } from '../../lib/external/rate-limit';
import { verifyProposalListToken } from '../../lib/external/verify-proposal-list-token';
import { buildProposalListContext, resolveProposalListDocument } from '../../lib/services/proposal-lists/list-page-service';
import {
  createProposalList,
  getProposalListOverview,
  revokeProposalList,
  setProposalListMarks,
} from '../../lib/services/proposal-lists/list-link-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import staffHandler from '../../pages/api/workbench/proposal-lists';
import contextHandler from '../../pages/api/external/proposal-list/[token]/context';
import documentHandler from '../../pages/api/external/proposal-list/[token]/document';

const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const LINK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINK = { id: LINK_ID, cycle_code: 'J27' };

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
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: ACTOR_ID, name: 'Staff', azureEmail: 'staff@example.org' } } });
  checkRateLimit.mockResolvedValue({ ok: true });
  verifyProposalListToken.mockResolvedValue({ ok: true, link: LINK });
});

describe('staff route', () => {
  test('unauthenticated callers stop at the app gate', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await staffHandler({ method: 'GET', query: { cycle: 'J27' } }, res);
    expect(getProposalListOverview).not.toHaveBeenCalled();
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  });

  test('create takes the actor from the session, never from the body', async () => {
    createProposalList.mockResolvedValueOnce({ link: { id: LINK_ID } });
    const res = mockRes();
    await staffHandler({ method: 'POST', body: { action: 'create', cycle: 'J27', kind: 'ordinary', rosterId: 7 } }, res);
    expect(res.statusCode).toBe(200);
    expect(createProposalList).toHaveBeenCalledWith({
      cycleCode: 'J27', listKind: 'ordinary', rosterId: 7,
      actor: { systemUserId: ACTOR_ID, name: 'Staff', email: 'staff@example.org' },
    });
  });

  test.each([
    [{ action: 'create', cycle: 'J27', kind: 'test', actor: { systemUserId: 'x' } }],
    [{ action: 'create', cycle: 'J27', kind: 'test', recipientEmail: 'someone@example.org' }],
    [{ action: 'revoke', linkId: LINK_ID, cycle: 'J27' }],
    [{ action: 'send', linkId: LINK_ID }],
    [{ action: 'constructor' }],
    [{ action: 'toString', linkId: LINK_ID }],
    [[]],
  ])('rejects the unsupported body %j', async (body) => {
    const res = mockRes();
    await staffHandler({ method: 'POST', body }, res);
    expect(res.statusCode).toBe(400);
    expect(createProposalList).not.toHaveBeenCalled();
    expect(revokeProposalList).not.toHaveBeenCalled();
  });

  test('marks pass the two id lists through and service errors keep their status', async () => {
    setProposalListMarks.mockRejectedValueOnce(new ServiceHttpError('no', { httpStatus: 409, code: 'proposal_list_marks_not_on_list', body: { error: 'no', code: 'proposal_list_marks_not_on_list' } }));
    const res = mockRes();
    await staffHandler({ method: 'POST', body: { action: 'marks', linkId: LINK_ID, highlightedRequestIds: ['a'], ownInstitutionRequestIds: [] } }, res);
    expect(setProposalListMarks).toHaveBeenCalledWith(expect.objectContaining({ linkId: LINK_ID, highlightedRequestIds: ['a'], ownInstitutionRequestIds: [] }));
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('proposal_list_marks_not_on_list');
  });

  test('other methods are refused', async () => {
    const res = mockRes();
    await staffHandler({ method: 'DELETE' }, res);
    expect(res.statusCode).toBe(405);
    expect(requireAppAccess).not.toHaveBeenCalled();
  });
});

describe('external routes', () => {
  test('context returns the list for a verified link, uncached', async () => {
    buildProposalListContext.mockResolvedValueOnce({ ok: true, total: 2 });
    const res = mockRes();
    await contextHandler({ method: 'GET', query: { token: 't' } }, res);
    expect(res.statusCode).toBe(200);
    expect(buildProposalListContext).toHaveBeenCalledWith({ link: LINK });
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
  });

  test.each([
    ['not_found', 404],
    ['revoked', 401],
    ['expired', 401],
    ['invalid_claim', 401],
  ])('a %s token gets %i from both routes and nothing is read', async (reason, status) => {
    verifyProposalListToken.mockResolvedValue({ ok: false, reason });
    const a = mockRes();
    await contextHandler({ method: 'GET', query: { token: 't' } }, a);
    const b = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't', request: '1001' } }, b);
    expect(a.statusCode).toBe(status);
    expect(b.statusCode).toBe(status);
    expect(buildProposalListContext).not.toHaveBeenCalled();
    expect(resolveProposalListDocument).not.toHaveBeenCalled();
    expect(recordTokenOutcome).toHaveBeenCalledWith(expect.anything(), 't', false);
  });

  test('a rate-limited caller is refused before the token is checked', async () => {
    checkRateLimit.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 30 });
    const res = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't', request: '1001' } }, res);
    expect(res.statusCode).toBe(429);
    expect(verifyProposalListToken).not.toHaveBeenCalled();
  });

  test('document streams the PDF inline and passes only the request number', async () => {
    resolveProposalListDocument.mockResolvedValueOnce({ buffer: Buffer.from('%PDF'), mimeType: 'application/pdf', filename: 'U_Staff-Version_1001.pdf', size: 4 });
    const res = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't', request: '1001', requestId: 'ignored', folder: 'ignored' } }, res);
    expect(resolveProposalListDocument).toHaveBeenCalledWith({ link: LINK, requestNumber: '1001' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Disposition']).toBe('inline; filename="U_Staff-Version_1001.pdf"');
  });

  test('document needs a request number and reports a refusal from the service', async () => {
    const missing = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't' } }, missing);
    expect(missing.statusCode).toBe(400);
    expect(verifyProposalListToken).not.toHaveBeenCalled();

    resolveProposalListDocument.mockRejectedValueOnce(new ServiceHttpError('not_on_list', { httpStatus: 404, body: { ok: false, reason: 'not_on_list' } }));
    const refused = mockRes();
    await documentHandler({ method: 'GET', query: { token: 't', request: '2002' } }, refused);
    expect(refused.statusCode).toBe(404);
    expect(refused.body).toEqual({ ok: false, reason: 'not_on_list' });
    expect(refused.send).not.toHaveBeenCalled();
  });

  test('a browser gets a readable page, not JSON, when a proposal cannot be opened', async () => {
    resolveProposalListDocument.mockRejectedValueOnce(new ServiceHttpError('not ready', { httpStatus: 404, body: { ok: false, reason: 'document_not_ready' } }));
    const res = mockRes();
    await documentHandler({ method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' }, query: { token: 't', request: '<script>1001' } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    const html = res.send.mock.calls[0][0];
    expect(html).toContain('This proposal is not available yet.');
    // Fixed text only: nothing from the request reaches the page.
    expect(html).not.toContain('1001');
    expect(html).not.toContain('<script');
    expect(res.json).not.toHaveBeenCalled();
  });

  test('only GET is allowed', async () => {
    const res = mockRes();
    await documentHandler({ method: 'POST', query: { token: 't', request: '1001' } }, res);
    expect(res.statusCode).toBe(405);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
