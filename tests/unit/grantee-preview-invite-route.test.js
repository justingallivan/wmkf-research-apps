/**
 * POST /api/workbench/grantee-deliverables/preview-invite (S271).
 * Render-only invitation preview. Covers method guard, auth gate, body
 * validation, and — critically — that it renders the real email HTML with a
 * PLACEHOLDER link and performs NO send / no token mint / no Dataverse access.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => Promise.resolve().then(fn),
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({
    signature: 'Assigned PD\nW. M. Keck Foundation',
    name: 'Assigned PD',
    email: 'assigned.pd@wmkeck.org',
  })),
  appendSignatureBlock: (bodyText, signatureBlock) => `${String(bodyText).trimEnd()}\n\n${signatureBlock.signature}`,
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { resolveSignatureForRequest } from '../../lib/services/email-signature';
import handler from '../../pages/api/workbench/grantee-deliverables/preview-invite';

const GUID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

const BODY = 'Dear Professor Smith: please review the abstract for your award.';

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  resolveSignatureForRequest.mockClear();
});

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('unauthorized → handled by requireAppAccess (no body rendered)', async () => {
  requireAppAccess.mockResolvedValue(null); // requireAppAccess already wrote the 401/403
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: GUID, bodyText: BODY } }, res);
  expect(res.body).toBeNull();
});

test('invalid requestId → 400', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: 'nope', bodyText: BODY } }, res);
  expect(res.statusCode).toBe(400);
  expect(resolveSignatureForRequest).not.toHaveBeenCalled();
});

test('short body → 400', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: GUID, bodyText: 'hi' } }, res);
  expect(res.statusCode).toBe(400);
});

test('renders the email HTML with the staff body and a placeholder link (no real link)', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: GUID, bodyText: BODY } }, res);
  expect(res.statusCode).toBe(200);
  expect(typeof res.body.html).toBe('string');
  expect(res.body.html).toContain('please review the abstract');
  expect(resolveSignatureForRequest).toHaveBeenCalledWith(GUID);
  expect(res.body.html).toContain('Assigned PD');
  // the magic-link button is present, pointing at the obvious placeholder
  expect(res.body.html).toContain('Open the Grantee Portal');
  expect(res.body.html).toContain('secure link generated when you send');
  // and it is NOT a real token URL
  expect(res.body.html).not.toMatch(/external\/grantee\/eyJ/); // no JWT
});

test('SECURITY: the body is HTML-escaped, not injected as markup', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { requestId: GUID, bodyText: 'Hello <script>alert(1)</script> world here' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.html).not.toContain('<script>alert(1)</script>');
  expect(res.body.html).toContain('&lt;script&gt;');
});
