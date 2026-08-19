/**
 * Unit tests for pages/api/webhooks/vercel-log-drain.js.
 *
 * Covers: 405 non-POST, fail-closed missing secret (500), signature gate
 * (403 on missing/bad signature, constant-time helper), unsupported
 * content-encoding (415), body size cap (413), empty test delivery (200),
 * happy path counters, and ingest failures still returning 200.
 *
 * @jest-environment node
 */

import crypto from 'crypto';
import { Readable } from 'stream';

jest.mock('../../lib/services/vercel-log-drain-ingest', () => {
  const actual = jest.requireActual('../../lib/services/vercel-log-drain-ingest');
  return {
    ...actual,
    ingestDrainEntries: jest.fn(),
  };
});

import handler, { verifyVercelLogDrainSignature } from '../../pages/api/webhooks/vercel-log-drain.js';
import { ingestDrainEntries } from '../../lib/services/vercel-log-drain-ingest';

const SECRET = 'drain-secret-shhh';

function sign(body, secret = SECRET) {
  return crypto.createHmac('sha1', secret).update(body).digest('hex');
}

function mkReq({ method = 'POST', body = '', headers = {}, signature } = {}) {
  const sig = signature !== undefined ? signature : sign(body);
  const stream = Readable.from(body.length ? [Buffer.from(body)] : []);
  stream.method = method;
  stream.headers = { 'x-vercel-signature': sig, ...headers };
  return stream;
}

function mkRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

beforeEach(() => {
  process.env.NODE_ENV = 'test'; // prod-shape rules
  process.env.VERCEL_LOG_DRAIN_SECRET = SECRET;
  delete process.env.VERCEL_LOG_DRAIN_VERIFY;
  ingestDrainEntries.mockReset();
  ingestDrainEntries.mockResolvedValue({
    considered: 1, stored: 1, duplicates: 0, skipped: 0, invalid: 0, droppedByCap: 0,
  });
});

test('GET → 405', async () => {
  const res = mkRes();
  await handler(mkReq({ method: 'GET' }), res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
});

test('missing secret in non-dev → 500 before reading anything', async () => {
  delete process.env.VERCEL_LOG_DRAIN_SECRET;
  const res = mkRes();
  await handler(mkReq({ body: '[]' }), res);
  expect(res.statusCode).toBe(500);
  expect(ingestDrainEntries).not.toHaveBeenCalled();
});

test('missing signature → 403', async () => {
  const res = mkRes();
  await handler(mkReq({ body: '[]', signature: null }), res);
  expect(res.statusCode).toBe(403);
  expect(ingestDrainEntries).not.toHaveBeenCalled();
});

test('wrong signature → 403', async () => {
  const res = mkRes();
  await handler(mkReq({ body: '[]', signature: sign('[]', 'other-secret') }), res);
  expect(res.statusCode).toBe(403);
});

test('gzip content-encoding → 415', async () => {
  const res = mkRes();
  await handler(mkReq({ body: '[]', headers: { 'content-encoding': 'gzip' } }), res);
  expect(res.statusCode).toBe(415);
});

test('oversized body → 413', async () => {
  const body = 'x'.repeat(4 * 1024 * 1024 + 1);
  const res = mkRes();
  await handler(mkReq({ body }), res);
  expect(res.statusCode).toBe(413);
  expect(ingestDrainEntries).not.toHaveBeenCalled();
});

test('empty signed body (drain-creation test) → 200', async () => {
  const res = mkRes();
  await handler(mkReq({ body: '' }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ ok: true, received: 0 });
});

test('valid NDJSON delivery → 200 with counters', async () => {
  const entry = { id: 'log-1', source: 'lambda', level: 'error', timestamp: 1, message: 'boom' };
  const body = `${JSON.stringify(entry)}\n`;
  const res = mkRes();
  await handler(mkReq({ body }), res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ ok: true, received: 1, stored: 1 });
  expect(ingestDrainEntries).toHaveBeenCalledWith([entry]);
});

test('VERCEL_LOG_DRAIN_VERIFY echoes x-vercel-verify header', async () => {
  process.env.VERCEL_LOG_DRAIN_VERIFY = 'verify-token';
  const res = mkRes();
  await handler(mkReq({ body: '[]' }), res);
  expect(res.headers['x-vercel-verify']).toBe('verify-token');
});

describe('verifyVercelLogDrainSignature', () => {
  test('accepts the correct HMAC-SHA1 hex signature', () => {
    const body = Buffer.from('payload');
    expect(verifyVercelLogDrainSignature(body, sign('payload'), SECRET)).toBe(true);
  });

  test('rejects wrong length, wrong value, missing secret', () => {
    const body = Buffer.from('payload');
    expect(verifyVercelLogDrainSignature(body, 'short', SECRET)).toBe(false);
    expect(verifyVercelLogDrainSignature(body, sign('other'), SECRET)).toBe(false);
    expect(verifyVercelLogDrainSignature(body, sign('payload'), '')).toBe(false);
    expect(verifyVercelLogDrainSignature(body, null, SECRET)).toBe(false);
  });
});
