/**
 * DynamicsService.executeChangeset — isolated unit coverage (plan §5a #3).
 *
 * Verifies the four properties the reviewer atomic-submit flow depends on:
 *   1. Changeset body construction — one multipart/mixed $batch wrapping a single
 *      changeset, each op an application/http part with a 1-based Content-ID,
 *      method + absolute URL, and (for POST/PATCH) a JSON body.
 *   2. Per-operation If-Match — `ifMatch` lands as an `If-Match` header on the
 *      right embedded op only.
 *   3. Multipart-response parsing — success returns per-op { contentId, status, body }.
 *   4. All-or-nothing — a single failed embedded op throws a structured error
 *      whose `.status` is that op's HTTP status (412/400), never a partial ok.
 *
 * The $batch transport is real fetch (globally mocked). The atomic ROLLBACK
 * itself is a Dataverse server property proven in prod by the S301 spike
 * (scripts/probe-dataverse-batch-changeset.mjs); here we assert the helper's
 * contract surface — a rejected changeset surfaces as a throw, not a partial.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';

const ACTING_GUID = '00000000-0000-0000-0000-000000000abc';
const CRLF = '\r\n';

beforeAll(() => {
  process.env.DYNAMICS_URL = 'https://example.crm.dynamics.com';
  process.env.DYNAMICS_TENANT_ID = 't';
  process.env.DYNAMICS_CLIENT_ID = 'c';
  process.env.DYNAMICS_CLIENT_SECRET = 's';
});

beforeEach(() => {
  fetch.mockReset();
  DynamicsService.clearCaches();
  process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
});

// ── Response fixtures (the nested batchresponse → changesetresponse → http shape) ──

function multipartResponse(ops, { ok = true, status = 200 } = {}) {
  const cs = 'changesetresponse_AAA';
  const batch = 'batchresponse_BBB';
  const parts = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${cs}`, ''];
  for (const op of ops) {
    parts.push(`--${cs}`);
    parts.push('Content-Type: application/http');
    parts.push('Content-Transfer-Encoding: binary');
    parts.push(`Content-ID: ${op.contentId}`);
    parts.push('');
    parts.push(`HTTP/1.1 ${op.status} ${op.reason || ''}`.trim());
    if (op.body !== undefined) {
      parts.push('Content-Type: application/json; odata.metadata=minimal');
      parts.push('');
      parts.push(JSON.stringify(op.body));
    } else {
      parts.push('OData-Version: 4.0');
      parts.push('');
    }
  }
  parts.push(`--${cs}--`);
  parts.push(`--${batch}--`);
  parts.push('');
  return {
    ok,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? `multipart/mixed; boundary=${batch}` : null) },
    text: () => Promise.resolve(parts.join(CRLF)),
  };
}

function jsonErrorResponse(status, errorBody) {
  return {
    ok: false,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; odata.metadata=minimal' : null) },
    text: () => Promise.resolve(JSON.stringify(errorBody)),
  };
}

function mockToken() {
  fetch.mockImplementationOnce(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ access_token: 't', expires_in: 3600 }) }),
  );
}

function lastBatchCall() {
  const calls = fetch.mock.calls.filter(([url]) => String(url).includes('/$batch'));
  return calls[calls.length - 1];
}

const TWO_UPSERTS = [
  { method: 'PATCH', url: "wmkf_appreviewanswers(wmkf_AppReviewerSuggestion=11111111-1111-1111-1111-111111111111,wmkf_questionkey='q2')", body: { wmkf_answervalue: 'A' } },
  { method: 'PATCH', url: 'akoya_requests(22222222-2222-2222-2222-222222222222)', body: { wmkf_reviewrating1: 3 }, ifMatch: 'W/"123"' },
];

// ── 1. Body construction ──────────────────────────────────────────────────────

describe('executeChangeset — changeset body construction', () => {
  test('builds one multipart/mixed $batch wrapping a single changeset of ops', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse([
      { contentId: 1, status: 204 }, { contentId: 2, status: 204 },
    ])));

    await DynamicsService.executeChangeset(TWO_UPSERTS);

    const [url, init] = lastBatchCall();
    expect(url).toBe('https://example.crm.dynamics.com/api/data/v9.2/$batch');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=batch_/);

    const m = init.headers['Content-Type'].match(/boundary=(batch_[\w-]+)/);
    const batchBoundary = m[1];
    const body = init.body;
    // outer batch envelope + inner changeset envelope
    expect(body).toContain(`--${batchBoundary}`);
    expect(body).toMatch(/Content-Type: multipart\/mixed; boundary=changeset_/);
    // both ops present, with 1-based Content-IDs and absolute URLs
    expect(body).toContain('Content-ID: 1');
    expect(body).toContain('Content-ID: 2');
    expect(body).toContain("PATCH https://example.crm.dynamics.com/api/data/v9.2/wmkf_appreviewanswers(wmkf_AppReviewerSuggestion=11111111-1111-1111-1111-111111111111,wmkf_questionkey='q2') HTTP/1.1");
    expect(body).toContain('PATCH https://example.crm.dynamics.com/api/data/v9.2/akoya_requests(22222222-2222-2222-2222-222222222222) HTTP/1.1');
    expect(body).toContain('{"wmkf_answervalue":"A"}');
    expect(body).toContain('{"wmkf_reviewrating1":3}');
    // closing boundaries
    expect(body).toContain(`--${batchBoundary}--`);
  });

  test('a POST op carries its JSON body; a DELETE op carries none', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse([
      { contentId: 1, status: 204 }, { contentId: 2, status: 204 },
    ])));

    await DynamicsService.executeChangeset([
      { method: 'POST', url: 'wmkf_appreviewanswers', body: { wmkf_questionkey: 'q2' } },
      { method: 'DELETE', url: 'wmkf_appreviewanswers(33333333-3333-3333-3333-333333333333)' },
    ]);

    const body = lastBatchCall()[1].body;
    expect(body).toContain('POST https://example.crm.dynamics.com/api/data/v9.2/wmkf_appreviewanswers HTTP/1.1');
    expect(body).toContain('{"wmkf_questionkey":"q2"}');
    expect(body).toContain('DELETE https://example.crm.dynamics.com/api/data/v9.2/wmkf_appreviewanswers(33333333-3333-3333-3333-333333333333) HTTP/1.1');
  });
});

// ── 2. Per-op If-Match ──────────────────────────────────────────────────────────

describe('executeChangeset — per-operation If-Match', () => {
  test('ifMatch lands as an If-Match header on its op only', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse([
      { contentId: 1, status: 204 }, { contentId: 2, status: 204 },
    ])));

    await DynamicsService.executeChangeset(TWO_UPSERTS);

    const body = lastBatchCall()[1].body;
    // exactly one If-Match, attached to the parent PATCH (op 2)
    expect((body.match(/If-Match:/g) || []).length).toBe(1);
    expect(body).toContain('If-Match: W/"123"');
    // the If-Match appears after the akoya_requests line, not the answers line
    const answersIdx = body.indexOf('wmkf_appreviewanswers');
    const parentIdx = body.indexOf('akoya_requests');
    const ifMatchIdx = body.indexOf('If-Match:');
    expect(ifMatchIdx).toBeGreaterThan(parentIdx);
    expect(parentIdx).toBeGreaterThan(answersIdx);
  });
});

// ── 3. Multipart-response parsing (success) ─────────────────────────────────────

describe('executeChangeset — multipart-response parsing', () => {
  test('success returns per-op contentId + status + parsed body', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse([
      { contentId: 1, status: 201, body: { wmkf_appreviewanswerid: 'new-1' } },
      { contentId: 2, status: 204 },
    ])));

    const result = await DynamicsService.executeChangeset(TWO_UPSERTS);
    expect(result.ok).toBe(true);
    expect(result.operations).toEqual([
      { contentId: 1, status: 201, body: { wmkf_appreviewanswerid: 'new-1' } },
      { contentId: 2, status: 204, body: null },
    ]);
  });

  test('attaches MSCRMCallerID to the $batch request when actingUserSystemId is set', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse([{ contentId: 1, status: 204 }])));

    await DynamicsService.executeChangeset(
      [{ method: 'PATCH', url: 'akoya_requests(g)', body: { x: 1 } }],
      { actingUserSystemId: ACTING_GUID },
    );
    expect(lastBatchCall()[1].headers.MSCRMCallerID).toBe(ACTING_GUID);
  });

  test('omits MSCRMCallerID for external-token (unattended) flows', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse([{ contentId: 1, status: 204 }])));

    await DynamicsService.executeChangeset([{ method: 'PATCH', url: 'akoya_requests(g)', body: { x: 1 } }]);
    expect(lastBatchCall()[1].headers.MSCRMCallerID).toBeUndefined();
  });
});

// ── 4. All-or-nothing on one failed op ─────────────────────────────────────────

describe('executeChangeset — all-or-nothing rollback', () => {
  test('a stale If-Match (embedded 412) throws with .status 412 and the Dataverse code', async () => {
    mockToken();
    // Outer 400-wrapping an embedded 412 changeset failure (the real Dataverse shape).
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse(
      [{ contentId: 2, status: 412, reason: 'Precondition Failed', body: { error: { code: '0x80060891', message: 'row version mismatch' } } }],
      { ok: false, status: 400 },
    )));

    await expect(DynamicsService.executeChangeset(TWO_UPSERTS)).rejects.toMatchObject({
      status: 412,
      dataverseCode: '0x80060891',
    });
  });

  test('a validation failure (embedded 400) throws with .status 400 — nothing returned as ok', async () => {
    mockToken();
    fetch.mockImplementationOnce(() => Promise.resolve(multipartResponse(
      [{ contentId: 1, status: 400, reason: 'Bad Request', body: { error: { code: '0x80040265', message: 'invalid value' } } }],
      { ok: false, status: 400 },
    )));

    await expect(DynamicsService.executeChangeset(TWO_UPSERTS)).rejects.toMatchObject({ status: 400 });
  });

  test('falls back to the outer status when Dataverse returns a bare JSON error (no multipart)', async () => {
    mockToken();
    fetch.mockImplementationOnce(() =>
      Promise.resolve(jsonErrorResponse(400, { error: { code: '0x80048d19', message: 'changeset rejected' } })),
    );

    await expect(DynamicsService.executeChangeset(TWO_UPSERTS)).rejects.toMatchObject({
      status: 400,
      dataverseCode: '0x80048d19',
    });
  });
});

// ── 5. Input validation ─────────────────────────────────────────────────────────

describe('executeChangeset — input validation', () => {
  test('rejects an empty operations array', async () => {
    await expect(DynamicsService.executeChangeset([])).rejects.toThrow(/non-empty array/);
  });

  test('rejects an unknown method', async () => {
    await expect(
      DynamicsService.executeChangeset([{ method: 'GET', url: 'x' }]),
    ).rejects.toThrow(/POST\/PATCH\/DELETE/);
  });

  test('rejects a POST/PATCH op with no body', async () => {
    await expect(
      DynamicsService.executeChangeset([{ method: 'PATCH', url: 'akoya_requests(g)' }]),
    ).rejects.toThrow(/requires a body/);
  });

  test('does not hit the network on a validation failure', async () => {
    await expect(DynamicsService.executeChangeset([])).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
