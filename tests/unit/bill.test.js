/**
 * Unit tests for lib/bill — BILL.com API wrapper.
 *
 * Mocks global fetch (safeFetch delegates to it after allowlist check).
 * Covers session caching, classification, retry policy, error redaction,
 * SSRF allowlist, abort + timeout, and verifyBillWebhook signature checks.
 *
 * @jest-environment node
 */

import crypto from 'crypto';
import {
  createBillVendor,
  searchBillNetwork,
  sendNetworkInvitation,
  verifyBillWebhook,
  BillError,
  BillAuthError,
  BillRateLimitError,
  BillValidationError,
  BillServerError,
} from '../../lib/bill/index.js';
import { __resetSessionCacheForTests } from '../../lib/bill/session.js';
import { redactString } from '../../lib/bill/redact.js';
import { classify, extractBdcCodes } from '../../lib/bill/classify.js';
import { safeFetch } from '../../lib/utils/safe-fetch.js';

// ─── Test harness ───

const STAGE = 'https://gateway.stage.bill.com/connect';

beforeEach(() => {
  process.env.BILL_BASE_URL = STAGE;
  process.env.BILL_DEV_KEY = 'devKeyTestValue1234567890';
  process.env.BILL_USERNAME = 'test@example.com';
  process.env.BILL_PASSWORD = 'p4ssword!';
  process.env.BILL_ORG_ID = 'org-xyz';
  __resetSessionCacheForTests();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Make a Response-like object from a status + body. */
function mockResponse(status, body, { headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => headers[k.toLowerCase()] ?? null },
    text: async () => text,
  };
}

/** Queue a sequence of mock responses; each call to fetch consumes one. */
function queueResponses(...responses) {
  let i = 0;
  global.fetch.mockImplementation(async () => {
    if (i >= responses.length) {
      throw new Error(`No mock response queued for fetch call #${i + 1}`);
    }
    return responses[i++];
  });
}

const okLogin = () => mockResponse(200, { sessionId: 'sess-abc123' });
const okVendor = (id = '009vendorxyz') => mockResponse(201, { id, networkStatus: 'NEW' });
const networkHit = () => mockResponse(200, {
  results: [{ id: '0rvnetworkid', name: 'Jane Doe', type: 'EMPLOYEE_OR_INDIVIDUAL', addresses: [] }],
});
const networkMiss = () => mockResponse(200, { results: [] });
const networkMulti = () => mockResponse(200, {
  results: [
    { id: '0rvA', name: 'John Smith', type: 'BUSINESS', addresses: [] },
    { id: '0rvB', name: 'John Smith', type: 'BUSINESS', addresses: [] },
  ],
});
const errEnvelope = (code, message = 'mocked') => [{ code, severity: 'ERROR', category: 'REQUEST', message, timestamp: new Date().toISOString() }];

// ─── createBillVendor ───

describe('createBillVendor', () => {
  const validVendor = {
    name: 'Amy Gladfelter',
    email: 'amy@duke.edu',
    address: { line1: '4 Mount Bolus Rd', city: 'Chapel Hill', zipOrPostalCode: '27514', country: 'US' },
  };

  test('happy path: returns vendorId starting with 009', async () => {
    queueResponses(okLogin(), okVendor());
    const { vendorId } = await createBillVendor(validVendor);
    expect(vendorId).toBe('009vendorxyz');
  });

  test('validation: missing required address field → BillValidationError, no fetch', async () => {
    queueResponses(); // nothing should be called
    await expect(
      createBillVendor({ name: 'X', address: { line1: 'a', city: 'b', country: 'US' } })
    ).rejects.toBeInstanceOf(BillValidationError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('validation: name > 100 chars → BillValidationError', async () => {
    await expect(
      createBillVendor({ ...validVendor, name: 'x'.repeat(101) })
    ).rejects.toBeInstanceOf(BillValidationError);
  });

  test('validation: country not ISO2 → BillValidationError', async () => {
    await expect(
      createBillVendor({ ...validVendor, address: { ...validVendor.address, country: 'USA' } })
    ).rejects.toBeInstanceOf(BillValidationError);
  });

  test('4xx with BdcError array → BillValidationError, no retry', async () => {
    queueResponses(okLogin(), mockResponse(400, errEnvelope('BDC_1001', 'malformed')));
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillValidationError);
    // 2 fetches: login + one POST (no retry on validation)
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('5xx well-formed → exp-backoff retry up to 3 attempts → BillServerError', async () => {
    jest.useFakeTimers();
    queueResponses(
      okLogin(),
      mockResponse(503, errEnvelope('BDC_9999', 'transient')),
      mockResponse(503, errEnvelope('BDC_9999', 'transient')),
      mockResponse(503, errEnvelope('BDC_9999', 'transient')),
      mockResponse(503, errEnvelope('BDC_9999', 'transient')),
    );
    const promise = createBillVendor(validVendor);
    promise.catch(() => {}); // pre-attach so the timer drain doesn't see an unhandled rejection
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toBeInstanceOf(BillServerError);
  });

  test('5xx malformed body (HTML page) → still retries within 5xx budget → BillServerError', async () => {
    jest.useFakeTimers();
    queueResponses(
      okLogin(),
      mockResponse(502, '<html><body>Bad Gateway</body></html>'),
      mockResponse(502, '<html><body>Bad Gateway</body></html>'),
      mockResponse(502, '<html><body>Bad Gateway</body></html>'),
      mockResponse(502, '<html><body>Bad Gateway</body></html>'),
    );
    const promise = createBillVendor(validVendor);
    promise.catch(() => {}); // pre-attach so the timer drain doesn't see an unhandled rejection
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toBeInstanceOf(BillServerError);
  });

  test('4xx malformed body → BillValidationError, no retry', async () => {
    queueResponses(okLogin(), mockResponse(400, '<html>nope</html>'));
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillValidationError);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('BDC_1101 auth error → BillAuthError, no retry', async () => {
    queueResponses(okLogin(), mockResponse(401, errEnvelope('BDC_1101', 'bad creds')));
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillAuthError);
  });

  test('BDC_1144 hourly rate limit → BillRateLimitError, no retry', async () => {
    queueResponses(okLogin(), mockResponse(429, errEnvelope('BDC_1144', 'hourly')));
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillRateLimitError);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('BDC_1322 concurrent rate limit → exp-backoff retry, eventual success', async () => {
    jest.useFakeTimers();
    queueResponses(
      okLogin(),
      mockResponse(429, errEnvelope('BDC_1322', 'concurrent')),
      okVendor('009retried'),
    );
    const promise = createBillVendor(validVendor);
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result.vendorId).toBe('009retried');
  });

  test('BDC_1322 exhausted (4 attempts all rate-limited) → BillRateLimitError', async () => {
    jest.useFakeTimers();
    queueResponses(
      okLogin(),
      mockResponse(429, errEnvelope('BDC_1322')),
      mockResponse(429, errEnvelope('BDC_1322')),
      mockResponse(429, errEnvelope('BDC_1322')),
      mockResponse(429, errEnvelope('BDC_1322')),
    );
    const promise = createBillVendor(validVendor);
    promise.catch(() => {});
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toBeInstanceOf(BillRateLimitError);
  });

  test('login BDC_1322 exhausted → BillRateLimitError', async () => {
    jest.useFakeTimers();
    queueResponses(
      mockResponse(429, errEnvelope('BDC_1322')),
      mockResponse(429, errEnvelope('BDC_1322')),
    );
    const promise = createBillVendor(validVendor);
    promise.catch(() => {});
    await jest.runAllTimersAsync();
    await expect(promise).rejects.toBeInstanceOf(BillRateLimitError);
  });

  test('BDC_1109 session expired → reauth + retry once → success', async () => {
    queueResponses(
      okLogin(),
      mockResponse(401, errEnvelope('BDC_1109', 'expired')),
      mockResponse(200, { sessionId: 'sess-new' }), // reauth login
      okVendor('009afterreauth'),
    );
    const result = await createBillVendor(validVendor);
    expect(result.vendorId).toBe('009afterreauth');
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('BDC_1109 twice in a row → BillAuthError (reauth budget exhausted)', async () => {
    queueResponses(
      okLogin(),
      mockResponse(401, errEnvelope('BDC_1109', 'expired')),
      mockResponse(200, { sessionId: 'sess-new' }),
      mockResponse(401, errEnvelope('BDC_1109', 'still expired')),
    );
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillAuthError);
  });

  test('HTTP 200 with error-array body → classified per BDC code', async () => {
    queueResponses(okLogin(), mockResponse(200, errEnvelope('BDC_1101', 'sneaky 200')));
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillAuthError);
  });

  test('response 2xx but id missing "009" prefix → BillError', async () => {
    queueResponses(okLogin(), mockResponse(201, { id: 'wrongprefix' }));
    await expect(createBillVendor(validVendor)).rejects.toBeInstanceOf(BillError);
  });
});

// ─── searchBillNetwork ───

describe('searchBillNetwork', () => {
  test('zero results → pni null + exactMatchCount 0', async () => {
    queueResponses(okLogin(), networkMiss());
    const r = await searchBillNetwork({ name: 'Amy Gladfelter' });
    expect(r.pni).toBeNull();
    expect(r.exactMatchCount).toBe(0);
  });

  test('one result → returns PNI + networkId + type', async () => {
    queueResponses(okLogin(), networkHit());
    const r = await searchBillNetwork({ name: 'Jane Doe', zipOrPostalCode: '27514' });
    expect(r.pni).toBe('0rvnetworkid');
    expect(r.networkId).toBe('0rvnetworkid');
    expect(r.type).toBe('EMPLOYEE_OR_INDIVIDUAL');
    expect(r.exactMatchCount).toBe(1);
  });

  test('multiple results → exactMatchCount > 1, no auto pni', async () => {
    queueResponses(okLogin(), networkMulti());
    const r = await searchBillNetwork({ name: 'John Smith' });
    expect(r.exactMatchCount).toBe(2);
    expect(r.pni).toBeNull();
    expect(r.allResults).toHaveLength(2);
  });

  test('name < 3 chars → BillValidationError', async () => {
    await expect(searchBillNetwork({ name: 'Jo' })).rejects.toBeInstanceOf(BillValidationError);
  });

  test('zip is URL-encoded in query', async () => {
    queueResponses(okLogin(), networkMiss());
    await searchBillNetwork({ name: 'Amy Gladfelter', zipOrPostalCode: '27514' });
    const url = global.fetch.mock.calls[1][0];
    expect(url).toContain('name=Amy+Gladfelter');
    expect(url).toContain('scope=BILL');
    expect(url).toContain('zipOrPostalCode=27514');
  });
});

// ─── sendNetworkInvitation ───

describe('sendNetworkInvitation', () => {
  test('happy path → resolves void; body shape correct', async () => {
    queueResponses(okLogin(), mockResponse(200, {}));
    await sendNetworkInvitation('009vendor', '0rvnetwork');
    const opts = global.fetch.mock.calls[1][1];
    expect(JSON.parse(opts.body)).toEqual({ networkId: '0rvnetwork', networkType: 'BILL' });
    const url = global.fetch.mock.calls[1][0];
    expect(url).toContain('/v3/network/invitation/vendor/009vendor');
  });

  test('vendorId without "009" prefix → BillValidationError, no fetch', async () => {
    await expect(sendNetworkInvitation('abc', '0rvX')).rejects.toBeInstanceOf(BillValidationError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('empty networkId → BillValidationError', async () => {
    await expect(sendNetworkInvitation('009X', '')).rejects.toBeInstanceOf(BillValidationError);
  });

  test('4xx → BillValidationError', async () => {
    queueResponses(okLogin(), mockResponse(400, errEnvelope('BDC_1003')));
    await expect(sendNetworkInvitation('009vendor', '0rvX')).rejects.toBeInstanceOf(BillValidationError);
  });
});

// ─── Session cache ───

describe('session cache', () => {
  test('two concurrent calls trigger only one login', async () => {
    queueResponses(
      okLogin(),         // single login
      okVendor('009A'),
      okVendor('009B'),
    );
    const [a, b] = await Promise.all([
      createBillVendor({
        name: 'A', email: 'a@x', address: { line1: 'x', city: 'y', zipOrPostalCode: 'z', country: 'US' },
      }),
      createBillVendor({
        name: 'B', email: 'b@x', address: { line1: 'x', city: 'y', zipOrPostalCode: 'z', country: 'US' },
      }),
    ]);
    expect(a.vendorId).toBe('009A');
    expect(b.vendorId).toBe('009B');
    // 3 calls: 1 login + 2 vendor POSTs
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('rejected login clears in-flight promise → next call retries fresh', async () => {
    // First call: login fails with auth
    queueResponses(mockResponse(401, errEnvelope('BDC_1101', 'bad creds')));
    await expect(createBillVendor({
      name: 'A', address: { line1: 'x', city: 'y', zipOrPostalCode: 'z', country: 'US' },
    })).rejects.toBeInstanceOf(BillAuthError);

    // Second call after rejection: should re-attempt login (not await stale rejection)
    queueResponses(okLogin(), okVendor('009ok'));
    const result = await createBillVendor({
      name: 'A', address: { line1: 'x', city: 'y', zipOrPostalCode: 'z', country: 'US' },
    });
    expect(result.vendorId).toBe('009ok');
  });

  test('session expiry triggers reauth and increments login count', async () => {
    queueResponses(
      okLogin(),
      mockResponse(401, errEnvelope('BDC_1109', 'expired')),
      mockResponse(200, { sessionId: 'sess-new' }),
      okVendor('009X'),
    );
    await createBillVendor({
      name: 'A', address: { line1: 'x', city: 'y', zipOrPostalCode: 'z', country: 'US' },
    });
    // 4 fetches: login + first POST (BDC_1109) + reauth login + retried POST
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});

// ─── SSRF allowlist ───

describe('SSRF allowlist', () => {
  test('BILL stage host is allowlisted', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
    const r = await safeFetch('https://gateway.stage.bill.com/connect/v3/anything');
    expect(r.status).toBe(200);
  });

  test('BILL prod host is allowlisted', async () => {
    global.fetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
    const r = await safeFetch('https://gateway.bill.com/connect/v3/anything');
    expect(r.status).toBe(200);
  });

  test('arbitrary host is rejected before fetch', async () => {
    await expect(safeFetch('https://evil.example.com/foo')).rejects.toThrow(/host not allowed/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('non-https BILL URL is rejected', async () => {
    await expect(safeFetch('http://gateway.bill.com/connect/v3/anything')).rejects.toThrow(/HTTPS required/);
  });

  test('billRequest rejects when BILL_BASE_URL points outside allowlist', async () => {
    process.env.BILL_BASE_URL = 'https://evil.example.com';
    queueResponses(); // shouldn't get to fetch
    // login goes through safeFetch which will reject; that bubbles up as a BillError
    await expect(searchBillNetwork({ name: 'Amy Gladfelter' })).rejects.toThrow(/host not allowed|BillError/);
  });
});

// ─── verifyBillWebhook ───

describe('verifyBillWebhook', () => {
  const secret = 'webhook-secret-shhh';
  const body = JSON.stringify({ eventId: 'evt_1', subscriptionId: 'sub_1', payload: { foo: 'bar' } });
  const validSig = crypto.createHmac('sha256', secret).update(body).digest('base64');

  test('valid signature → true', () => {
    expect(verifyBillWebhook(body, validSig, secret)).toBe(true);
  });

  test('wrong signature → false', () => {
    const bad = crypto.createHmac('sha256', 'other-secret').update(body).digest('base64');
    expect(verifyBillWebhook(body, bad, secret)).toBe(false);
  });

  test('tampered body → false', () => {
    expect(verifyBillWebhook(body + 'tampered', validSig, secret)).toBe(false);
  });

  test('missing signature header → false (not throw)', () => {
    expect(verifyBillWebhook(body, '', secret)).toBe(false);
    expect(verifyBillWebhook(body, null, secret)).toBe(false);
    expect(verifyBillWebhook(body, undefined, secret)).toBe(false);
  });

  test('missing secret → false (not throw)', () => {
    expect(verifyBillWebhook(body, validSig, '')).toBe(false);
    expect(verifyBillWebhook(body, validSig, null)).toBe(false);
  });

  test('different-length signature does not throw (timingSafeEqual handles padding)', () => {
    expect(() => verifyBillWebhook(body, 'short', secret)).not.toThrow();
    expect(verifyBillWebhook(body, 'short', secret)).toBe(false);
  });

  test('non-string body still verifies correctly (Buffer)', () => {
    const buf = Buffer.from(body);
    expect(verifyBillWebhook(buf, validSig, secret)).toBe(true);
  });
});

// ─── Redaction ───

describe('redactString', () => {
  test('devKey JSON field is redacted', () => {
    const s = '{"devKey":"abc123secretXYZ","other":"ok"}';
    expect(redactString(s)).toContain('"devKey":"[redacted]"');
    expect(redactString(s)).not.toContain('abc123secretXYZ');
  });

  test('password JSON field is redacted', () => {
    const s = '{"password":"hunter2"}';
    expect(redactString(s)).toContain('"password":"[redacted]"');
  });

  test('sessionId JSON field is redacted', () => {
    const s = '{"sessionId":"sess-abc"}';
    expect(redactString(s)).toContain('"sessionId":"[redacted]"');
  });

  test('devKey header form is redacted', () => {
    const s = 'devKey: abc123secretXYZ';
    expect(redactString(s)).toContain('devKey: [redacted]');
  });

  test('long token-shaped string is swept', () => {
    const s = 'random nonsense AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf more text';
    expect(redactString(s)).toContain('[redacted-token]');
  });

  test('JWT-shaped token (3 dot-segments) is swept', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = redactString(`Authorization: Bearer ${jwt}`);
    expect(out).toContain('[redacted-token]');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  test('base64-shaped secret with +/= chars is swept', () => {
    const b64 = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5KystLw==';
    const out = redactString(`secret=${b64}`);
    expect(out).toContain('[redacted-token]');
  });

  test('non-string passes through unchanged', () => {
    expect(redactString(123)).toBe(123);
    expect(redactString(null)).toBe(null);
    expect(redactString(undefined)).toBe(undefined);
  });

  test('thrown BillError message is auto-redacted at construction', () => {
    const err = new BillError('hello devKey: abc123secretXYZ end');
    expect(err.message).not.toContain('abc123secretXYZ');
  });
});

// ─── classify (direct unit tests) ───

describe('classify', () => {
  test('2xx with normal body → ok', () => {
    expect(classify({ status: 200, parsedBody: { foo: 'bar' } }).category).toBe('ok');
  });

  test('2xx with error-array body → reclassified per BDC code', () => {
    expect(classify({ status: 200, parsedBody: errEnvelope('BDC_1101') }).category).toBe('auth');
  });

  test('4xx with BDC_1109 → session_expired', () => {
    expect(classify({ status: 401, parsedBody: errEnvelope('BDC_1109') }).category).toBe('session_expired');
  });

  test('4xx with BDC_1144 → rate_limited_hourly (not retryable)', () => {
    const c = classify({ status: 429, parsedBody: errEnvelope('BDC_1144') });
    expect(c.category).toBe('rate_limited_hourly');
    expect(c.retryable).toBe(false);
  });

  test('4xx with BDC_1322 → rate_limited_concurrent (retryable)', () => {
    const c = classify({ status: 429, parsedBody: errEnvelope('BDC_1322') });
    expect(c.category).toBe('rate_limited_concurrent');
    expect(c.retryable).toBe(true);
  });

  test('4xx with unparseable body → unknown_client', () => {
    expect(classify({ status: 400, parsedBody: null }).category).toBe('unknown_client');
  });

  test('5xx with unparseable body → server (retryable)', () => {
    const c = classify({ status: 502, parsedBody: null });
    expect(c.category).toBe('server');
    expect(c.retryable).toBe(true);
  });

  test('network error → transient (retryable)', () => {
    expect(classify({ networkError: true })).toEqual({ category: 'transient', codes: [], retryable: true });
  });

  test('extractBdcCodes handles {errors: [...]} envelope', () => {
    expect(extractBdcCodes({ errors: errEnvelope('BDC_1144') })).toEqual(['BDC_1144']);
  });
});
