/**
 * service-error.js — covers the contract the drain classifier depends on.
 *
 * The drain (forthcoming /api/cron/drain-submissions) reads err.status,
 * err.dataverseCode, err.isTransient, err.noResponse, and err.causeKind to
 * decide between duplicate_pk / validation_400 / throttle_429 / transient_5xx
 * / network_no_response and the per-category retry behavior. If any of these
 * properties stops being set, every error from dynamics-service.js or
 * graph-service.js gets misclassified.
 */

const { buildServiceError, buildNoResponseError } = require('../../lib/utils/service-error.js');

function mockResp(status) {
  return { status };
}

describe('buildServiceError', () => {
  test('attaches serviceName, status, isTransient on a 404', () => {
    const e = buildServiceError('dataverse', mockResp(404), '');
    expect(e).toBeInstanceOf(Error);
    expect(e.serviceName).toBe('dataverse');
    expect(e.status).toBe(404);
    expect(e.isTransient).toBe(false);
    expect(e.message).toMatch(/dataverse failed \(404\)/);
  });

  test('isTransient is true on 429', () => {
    const e = buildServiceError('dataverse', mockResp(429), '');
    expect(e.isTransient).toBe(true);
  });

  test('isTransient is true on 5xx', () => {
    expect(buildServiceError('dataverse', mockResp(500), '').isTransient).toBe(true);
    expect(buildServiceError('dataverse', mockResp(502), '').isTransient).toBe(true);
    expect(buildServiceError('dataverse', mockResp(503), '').isTransient).toBe(true);
    expect(buildServiceError('dataverse', mockResp(504), '').isTransient).toBe(true);
  });

  test('isTransient is false on 4xx (other than 429)', () => {
    expect(buildServiceError('dataverse', mockResp(400), '').isTransient).toBe(false);
    expect(buildServiceError('dataverse', mockResp(401), '').isTransient).toBe(false);
    expect(buildServiceError('dataverse', mockResp(403), '').isTransient).toBe(false);
    expect(buildServiceError('dataverse', mockResp(412), '').isTransient).toBe(false);
  });

  test('parses Dataverse error envelope into dataverseCode / dataverseMessage', () => {
    const body = JSON.stringify({
      error: { code: '0x80060891', message: "Resource not found for the segment 'X'." },
    });
    const e = buildServiceError('dataverse', mockResp(404), body);
    expect(e.dataverseCode).toBe('0x80060891');
    expect(e.dataverseMessage).toBe("Resource not found for the segment 'X'.");
  });

  test('handles non-JSON body without throwing', () => {
    const e = buildServiceError('dataverse', mockResp(500), '<html>internal server error</html>');
    expect(e.status).toBe(500);
    expect(e.dataverseCode).toBeUndefined();
    expect(e.message).toMatch(/<html>internal server error<\/html>/);
  });

  test('handles empty body', () => {
    const e = buildServiceError('dataverse', mockResp(204), '');
    expect(e.status).toBe(204);
    expect(e.dataverseCode).toBeUndefined();
    expect(e.dataverseMessage).toBeUndefined();
  });

  test('serviceName flows through for graph errors', () => {
    const e = buildServiceError('graph', mockResp(500), '{"error":{"code":"serviceNotAvailable"}}');
    expect(e.serviceName).toBe('graph');
    expect(e.dataverseCode).toBe('serviceNotAvailable'); // generic .error.code extraction
  });

  test('configuration-error shape via fake { status: 500 } stub', () => {
    // The dynamics-service/graph-service token paths use this pattern for
    // missing-env throws — there's no real response, just a stubbed status.
    const e = buildServiceError('dataverse', { status: 500 }, 'Missing Dynamics 365 env vars');
    expect(e.status).toBe(500);
    expect(e.serviceName).toBe('dataverse');
    expect(e.isTransient).toBe(true); // 5xx is transient by convention; classifier still terminal-fails on config bugs
    expect(e.message).toMatch(/Missing Dynamics 365 env vars/);
  });
});

describe('buildNoResponseError', () => {
  test('attaches noResponse, isTransient, serviceName', () => {
    const e = buildNoResponseError('dataverse', new Error('socket hang up'));
    expect(e).toBeInstanceOf(Error);
    expect(e.noResponse).toBe(true);
    expect(e.isTransient).toBe(true);
    expect(e.serviceName).toBe('dataverse');
    expect(e.status).toBeNull();
    expect(e.message).toMatch(/dataverse no-response: socket hang up/);
  });

  test('classifies AbortError as causeKind=abort', () => {
    const ab = new Error('aborted');
    ab.name = 'AbortError';
    const e = buildNoResponseError('graph', ab);
    expect(e.causeKind).toBe('abort');
    expect(e.cause).toBe(ab);
  });

  test('classifies ETIMEDOUT as causeKind=timeout', () => {
    const t = new Error('Connect Timeout Error');
    t.code = 'ETIMEDOUT';
    const e = buildNoResponseError('dataverse', t);
    expect(e.causeKind).toBe('timeout');
  });

  test('classifies UND_ERR_HEADERS_TIMEOUT as causeKind=timeout', () => {
    const t = new Error('Headers Timeout');
    t.code = 'UND_ERR_HEADERS_TIMEOUT';
    expect(buildNoResponseError('graph', t).causeKind).toBe('timeout');
  });

  test('classifies ECONNRESET as causeKind=socket', () => {
    const r = new Error('socket reset');
    r.code = 'ECONNRESET';
    expect(buildNoResponseError('graph', r).causeKind).toBe('socket');
  });

  test('classifies ENOTFOUND as causeKind=dns', () => {
    const d = new Error('getaddrinfo ENOTFOUND');
    d.code = 'ENOTFOUND';
    expect(buildNoResponseError('graph', d).causeKind).toBe('dns');
  });

  test('classifies unknown errors as causeKind=unknown', () => {
    expect(buildNoResponseError('dataverse', new Error('weird')).causeKind).toBe('unknown');
  });

  test('handles non-Error causes (null, string)', () => {
    expect(buildNoResponseError('dataverse', null).message).toMatch(/no-response/);
    expect(buildNoResponseError('dataverse', 'bare string').message).toMatch(/bare string/);
  });
});
