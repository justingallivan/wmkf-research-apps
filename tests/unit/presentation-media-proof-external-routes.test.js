/** @jest-environment node */

jest.mock('../../lib/external/presentation-media-proof-rate-limit', () => ({
  checkPresentationMediaProofRateLimit: jest.fn(),
}));
jest.mock('../../lib/services/post-presentation-materials/presentation-media-proof-service', () => ({
  assertPreviewProofDeployment: jest.fn(),
  getPresentationMediaProofContext: jest.fn(),
  resolvePresentationMediaProof: jest.fn(),
  verifyPresentationMediaProofToken: jest.fn(),
}));

import { checkPresentationMediaProofRateLimit } from '../../lib/external/presentation-media-proof-rate-limit';
import {
  assertPreviewProofDeployment,
  getPresentationMediaProofContext,
  resolvePresentationMediaProof,
  verifyPresentationMediaProofToken,
} from '../../lib/services/post-presentation-materials/presentation-media-proof-service';
import contextHandler from '../../pages/api/external/presentation-media-proof/[token]/context';
import openHandler from '../../pages/api/external/presentation-media-proof/[token]/open';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  assertPreviewProofDeployment.mockImplementation(() => undefined);
  checkPresentationMediaProofRateLimit.mockResolvedValue({ ok: true });
  verifyPresentationMediaProofToken.mockResolvedValue({ ok: true, claims: { itemId: 'item' }, expiresAt: '2026-09-22T12:05:00Z' });
  getPresentationMediaProofContext.mockResolvedValue({ ok: true, filename: 'recording.mp4', size: 60_000_000 });
  resolvePresentationMediaProof.mockResolvedValue({ downloadUrl: 'https://media.example/one-shot' });
});

test('both routes deny Production before rate limiting or token verification', async () => {
  assertPreviewProofDeployment.mockImplementation(() => { throw new Error('not preview'); });
  for (const handler of [contextHandler, openHandler]) {
    const res = mockRes();
    await handler({ method: 'GET', query: { token: 'jwt', mode: 'watch' } }, res);
    expect(res.statusCode).toBe(404);
  }
  expect(checkPresentationMediaProofRateLimit).not.toHaveBeenCalled();
  expect(verifyPresentationMediaProofToken).not.toHaveBeenCalled();
});

test('context fails closed on limiter outage before verifying the bearer token', async () => {
  checkPresentationMediaProofRateLimit.mockResolvedValueOnce({ ok: false, reason: 'rate_limit_unavailable', retryAfterSeconds: 5 });
  const res = mockRes();
  await contextHandler({ method: 'GET', query: { token: 'jwt' } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.headers['Retry-After']).toBe('5');
  expect(verifyPresentationMediaProofToken).not.toHaveBeenCalled();
});

test('context verifies the token and returns only no-store display metadata', async () => {
  const verified = { ok: true, claims: { itemId: 'item' }, expiresAt: '2026-09-22T12:05:00Z' };
  verifyPresentationMediaProofToken.mockResolvedValueOnce(verified);
  const res = mockRes();
  await contextHandler({ method: 'GET', query: { token: 'jwt' } }, res);
  expect(getPresentationMediaProofContext).toHaveBeenCalledWith(verified);
  expect(res.body).toEqual({ ok: true, filename: 'recording.mp4', size: 60_000_000 });
  expect(res.headers['Cache-Control']).toBe('private, no-store');
  expect(res.headers['Referrer-Policy']).toBe('no-referrer');
});

test('open supports a no-store 302 resolver and an explicit one-shot JSON comparison', async () => {
  const redirect = mockRes();
  await openHandler({ method: 'GET', query: { token: 'jwt', mode: 'watch', delivery: 'redirect' } }, redirect);
  expect(redirect.statusCode).toBe(302);
  expect(redirect.headers.Location).toBe('https://media.example/one-shot');
  expect(redirect.ended).toBe(true);

  const json = mockRes();
  await openHandler({ method: 'GET', query: { token: 'jwt', mode: 'download', delivery: 'json' } }, json);
  expect(json.statusCode).toBe(200);
  expect(json.body).toEqual({ ok: true, url: 'https://media.example/one-shot', mode: 'download' });
  expect(json.headers['Cache-Control']).toBe('private, no-store');
});
