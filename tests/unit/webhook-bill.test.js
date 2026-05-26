/**
 * Unit tests for pages/api/webhooks/bill.js — BILL.com webhook scaffold.
 *
 * Covers: 405 for non-POST, missing-secret fail-closed in prod, signature
 * verification gate (401), duplicate-delivery dedup (200), missing-correlators
 * fail-soft (200), happy-path structured log (200).
 *
 * @jest-environment node
 */

import crypto from 'crypto';
import { Readable } from 'stream';

// Mock @vercel/postgres BEFORE importing the handler.
const sqlMock = jest.fn();
jest.mock('@vercel/postgres', () => ({
  sql: (strings, ...values) => sqlMock(strings, ...values),
}));

import handler from '../../pages/api/webhooks/bill.js';

const SECRET = 'webhook-secret-shhh';

function mkReq({ method = 'POST', body = '', headers = {}, secretHeader = null } = {}) {
  const sig = secretHeader ?? crypto.createHmac('sha256', SECRET).update(body).digest('base64');
  const stream = Readable.from([Buffer.from(body)]);
  // Attach .headers + .method (Node's IncomingMessage has these)
  stream.method = method;
  stream.headers = { 'x-bill-sha-signature': sig, ...headers };
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
  process.env.NODE_ENV = 'test'; // not 'development' — exercise prod-shape rules
  process.env.BILL_WEBHOOK_SECRET = SECRET;
  sqlMock.mockReset();
});

describe('method handling', () => {
  test('GET → 405', async () => {
    const req = mkReq({ method: 'GET' });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });

  test('PUT → 405', async () => {
    const req = mkReq({ method: 'PUT' });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('configuration failure modes', () => {
  test('missing BILL_WEBHOOK_SECRET in non-dev → 500', async () => {
    delete process.env.BILL_WEBHOOK_SECRET;
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', subscriptionId: 's' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/secret not configured/i);
  });

  test('missing BILL_WEBHOOK_SECRET in dev → bypassed (200)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.BILL_WEBHOOK_SECRET;
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', subscriptionId: 's' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
  });
});

describe('signature verification', () => {
  test('valid signature + happy path → 200 inserted', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', subscriptionId: 's', eventType: 'vendor.updated' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, deduped: false, eventType: 'vendor.updated' });
  });

  test('invalid signature → 401', async () => {
    const req = mkReq({
      body: JSON.stringify({ eventId: 'e', subscriptionId: 's' }),
      secretHeader: 'bogus-signature',
    });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('missing signature header → 401', async () => {
    const body = JSON.stringify({ eventId: 'e', subscriptionId: 's' });
    const req = mkReq({ body, secretHeader: undefined, headers: {} });
    delete req.headers['x-bill-sha-signature'];
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
  });
});

describe('body handling', () => {
  test('empty body → 400', async () => {
    const req = mkReq({ body: '' });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const body = '{not-json';
    const req = mkReq({ body });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('correlator extraction + dedup', () => {
  test('eventId at metadata.eventId is recognized', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const req = mkReq({
      body: JSON.stringify({ metadata: { eventId: 'meta-e', subscriptionId: 'meta-s' }, foo: 'bar' }),
    });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.deduped).toBe(false);
  });

  test('missing eventId → 200 fail-soft, no insert', async () => {
    const req = mkReq({ body: JSON.stringify({ subscriptionId: 's', foo: 'bar' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.deduped).toBe(false);
    expect(res.body.reason).toBe('missing_correlators');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('missing subscriptionId → 200 fail-soft', async () => {
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', foo: 'bar' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe('missing_correlators');
  });

  test('non-string eventId (object) → 200 fail-soft, no SQL call', async () => {
    const req = mkReq({ body: JSON.stringify({ eventId: { nested: 'x' }, subscriptionId: 's' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe('missing_correlators');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('non-string subscriptionId (number) → 200 fail-soft, no SQL call', async () => {
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', subscriptionId: 12345 }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe('missing_correlators');
    expect(sqlMock).not.toHaveBeenCalled();
  });

  test('empty-string eventId → 200 fail-soft', async () => {
    const req = mkReq({ body: JSON.stringify({ eventId: '', subscriptionId: 's' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe('missing_correlators');
  });

  test('duplicate delivery (ON CONFLICT returns no row) → deduped:true', async () => {
    sqlMock.mockResolvedValueOnce({ rows: [] });
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', subscriptionId: 's' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, deduped: true });
  });

  test('dedup insert error → 200 with deduped:unknown (avoid BILL retry storm)', async () => {
    sqlMock.mockRejectedValueOnce(new Error('connection refused'));
    const req = mkReq({ body: JSON.stringify({ eventId: 'e', subscriptionId: 's' }) });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.deduped).toBe('unknown');
  });
});

describe('body size limit', () => {
  test('body over 256 KB → 400', async () => {
    const huge = 'x'.repeat(300 * 1024); // 300 KB
    const body = JSON.stringify({ eventId: 'e', subscriptionId: 's', payload: huge });
    const req = mkReq({ body });
    const res = mkRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });
});

describe('client disconnect (readRawBody resource cleanup)', () => {
  test('client close mid-body → settles as 400, no lingering listeners', async () => {
    // Build a stream that emits no chunks then fires 'close' without 'end'.
    const { EventEmitter } = require('events');
    const req = new EventEmitter();
    req.method = 'POST';
    req.headers = { 'x-bill-sha-signature': 'whatever' };
    // off() is what readRawBody uses to clean up; EventEmitter provides it.

    const res = mkRes();
    const handlerPromise = handler(req, res);

    // Fire 'close' before 'end' — simulates client disconnect.
    process.nextTick(() => req.emit('close'));

    await handlerPromise;
    expect(res.statusCode).toBe(400);
    // Cleanup verification: no remaining listeners on the stream after settlement.
    expect(req.listenerCount('data')).toBe(0);
    expect(req.listenerCount('end')).toBe(0);
    expect(req.listenerCount('close')).toBe(0);
    expect(req.listenerCount('aborted')).toBe(0);
    expect(req.listenerCount('error')).toBe(0);
  });
});
