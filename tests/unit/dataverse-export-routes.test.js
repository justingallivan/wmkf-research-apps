/**
 * Dataverse Power Tools — Track B — Phase 2 route-handler integration tests.
 *
 * Covers the build-plan §11 route-level contract + the Codex S160 Phase-2
 * fixes: auth/method gates, preview 422 + the operational-exclusion
 * fail-loud, the stateless confirm gate (forged/absent → 403 BEFORE any SSE
 * byte; /run honors the token's spec, never a mismatched body spec),
 * metadata fail-loud, and the gated download proxy. result-token is REAL
 * (the gate under test); the heavy deps are mocked.
 *
 * @jest-environment node
 */

// Uses the GLOBAL jest (no @jest/globals import) so babel-plugin-jest-hoist
// lifts jest.mock above the static imports (repo precedent:
// execute-prompt-payload-boundary.test.js). Factories may only reference
// `mock`-prefixed vars (jest static check) — hence the naming.
const mockTax = {
  entity: 'akoya_request', enumeratedAt: 'now',
  programs: [{ id: 'g-mr', name: 'Medical Research' }, { id: 'g-rr', name: 'Research Reviewer' }],
  types: [{ id: 't-sv', name: 'Site Visit' }, { id: 't-p', name: 'Program' }],
  fundingCategories: [{ id: 'f-h', name: 'Honorarium' }],
  statuses: ['Approved', 'Phase I Declined'],
  requestTypeOptions: [
    // Labels mirror the LIVE akoya_request.wmkf_request_type picklist —
    // the phone option is "Phone Call", not "Phone" (verified live; the
    // OPERATIONAL_EXCLUSION constant must match this exactly).
    { value: 1, label: 'Office Visit' }, { value: 2, label: 'Site Visit' },
    { value: 3, label: 'Phone Call' }, { value: 100000000, label: 'Request' },
  ],
};
const mockRequireAppAccess = jest.fn(async () => ({ profileId: 'p1', session: { user: {} } }));
const mockFetchLiveTaxonomy = jest.fn(async () => mockTax);
const mockFetchXmlAll = jest.fn();
const mockFetchXmlAggregateCount = jest.fn(async () => 3);
const mockPut = jest.fn(async () => ({ pathname: 'dataverse-export/x-abc.xlsx' }));
const mockBlobGet = jest.fn();
const mockBuildWorkbook = jest.fn(async () => Buffer.from('XLSXBYTES'));

jest.mock('../../lib/utils/auth', () => ({
  __esModule: true, requireAppAccess: (...a) => mockRequireAppAccess(...a),
}));
jest.mock('../../lib/services/dataverse-export/live-taxonomy', () => ({
  __esModule: true,
  fetchLiveTaxonomy: (...a) => mockFetchLiveTaxonomy(...a),
  buildResolver: jest.requireActual('../../lib/services/dataverse-export/live-taxonomy.js')
    .buildResolver,
}));
jest.mock('../../lib/services/dataverse-export/fetch-client', () => ({
  __esModule: true,
  fetchXmlAll: (...a) => mockFetchXmlAll(...a),
  fetchXmlAggregateCount: (...a) => mockFetchXmlAggregateCount(...a),
  FetchXmlError: class FetchXmlError extends Error {
    constructor(m, o = {}) { super(m); this.name = 'FetchXmlError'; Object.assign(this, o); }
  },
}));
jest.mock('@vercel/blob', () => ({
  __esModule: true, put: (...a) => mockPut(...a), get: (...a) => mockBlobGet(...a),
}));
jest.mock('../../lib/services/dataverse-export/workbook', () => ({
  __esModule: true,
  buildWorkbook: (...a) => mockBuildWorkbook(...a),
  WorkbookError: class WorkbookError extends Error {},
}));

import previewHandler from '../../pages/api/dataverse-export/preview';
import runHandler from '../../pages/api/dataverse-export/run';
import metadataHandler from '../../pages/api/dataverse-export/metadata';
import downloadHandler from '../../pages/api/dataverse-export/download';
import {
  mintResultToken, mintDownloadToken,
} from '../../lib/services/dataverse-export/result-token.js';

const requireAppAccess = mockRequireAppAccess;
const fetchLiveTaxonomy = mockFetchLiveTaxonomy;
const fetchXmlAll = mockFetchXmlAll;
const fetchXmlAggregateCount = mockFetchXmlAggregateCount;
const put = mockPut;
const buildWorkbook = mockBuildWorkbook;
const blobGet = mockBlobGet;

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {}, chunks: [], ended: false,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
  };
}
const sseEvents = (res) => res.chunks
  .map(c => { try { return JSON.parse(c.replace(/^data: /, '').trim()); } catch { return null; } })
  .filter(Boolean);

const baseSpec = (over = {}) => ({
  version: 1, entity: 'akoya_request', filters: [],
  programRollup: 'optionB', excludeOperational: true, excludeTestRecords: true,
  columns: { default: true }, eraScope: 'all', ...over,
});

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-at-least-32-chars-long';
  // run.js/download.js require a DEDICATED private-store token (the shared
  // public BLOB_READ_WRITE_TOKEN cannot serve a private blob — prod log
  // "Cannot use private access on a public store"). Pre-stream fail-loud
  // guard; set a stub so the success-path specs exercise the real flow.
  process.env.DVX_BLOB_RW_TOKEN = 'vercel_blob_rw_TESTSTORE_teststubsecret';
});
beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 'p1', session: { user: {} } });
  fetchLiveTaxonomy.mockResolvedValue(mockTax);
  fetchXmlAggregateCount.mockResolvedValue(3);
  fetchXmlAll.mockResolvedValue({ rows: [], fetched: 0, pages: 1, capped: false, truncatedByBudget: false });
  buildWorkbook.mockResolvedValue(Buffer.from('XLSXBYTES'));
  put.mockResolvedValue({ pathname: 'dataverse-export/x-abc.xlsx' });
});

// NOTE: the REAL 401/403/CSRF/origin/is_active semantics live in
// requireAppAccess and are covered by its own suite (tests around
// lib/utils/auth). Here we assert the per-route GATE WIRING the security
// matrix promises: every route calls requireAppAccess with the correct app
// key BEFORE any side effect, and short-circuits cleanly on denial.
describe('auth + method gates — every route, not preview-only (Codex confirm P2)', () => {
  const ALL = [
    { name: 'preview', h: () => previewHandler, ok: 'POST', bad: 'GET' },
    { name: 'run', h: () => runHandler, ok: 'POST', bad: 'GET' },
    { name: 'metadata', h: () => metadataHandler, ok: 'GET', bad: 'POST' },
    { name: 'download', h: () => downloadHandler, ok: 'GET', bad: 'POST' },
  ];

  test.each(ALL)('$name gates on requireAppAccess(\'dataverse-bulk-export\') '
    + 'before any side effect', async ({ h, ok }) => {
    requireAppAccess.mockResolvedValue(null); // denial: it already sent 401/403
    const res = mockRes();
    await h()({ method: ok, body: {}, query: {} }, res);
    expect(requireAppAccess).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'dataverse-bulk-export');
    // No downstream work happened (no taxonomy fetch / blob / count).
    expect(fetchLiveTaxonomy).not.toHaveBeenCalled();
    expect(fetchXmlAggregateCount).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(blobGet).not.toHaveBeenCalled();
    expect(res.ended).toBe(false); // handler returned; requireAppAccess owns the response
  });

  test.each(ALL)('$name rejects the wrong HTTP method → 405', async ({ h, bad }) => {
    const res = mockRes();
    await h()({ method: bad, body: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('preview', () => {
  test('invalid spec → 422 + violations (no taxonomy fetch needed)', async () => {
    const res = mockRes();
    await previewHandler({ method: 'POST', body: { querySpec: { version: 99 } } }, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('INVALID_QUERYSPEC');
    expect(fetchLiveTaxonomy).not.toHaveBeenCalled();
  });

  test('excludeOperational + unresolvable labels → 422 fail-loud, NO token '
    + '(Codex S160 P1 #6)', async () => {
    fetchLiveTaxonomy.mockResolvedValue({
      ...mockTax, programs: [], types: [], fundingCategories: [], requestTypeOptions: [],
    });
    const res = mockRes();
    await previewHandler({ method: 'POST', body: { querySpec: baseSpec() } }, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('OPERATIONAL_EXCLUSION_UNRESOLVED');
    expect(res.body.resultToken).toBeUndefined();
  });

  test('unknown filter literal → taxonomyWarnings, NOT a 422 (§2.1 point 4)', async () => {
    const res = mockRes();
    await previewHandler({ method: 'POST', body: {
      querySpec: baseSpec({ filters: [{ axis: 'status', op: 'eq', value: 'No Such Status' }] }),
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.taxonomyWarnings.some(w => /No Such Status/.test(w.message))).toBe(true);
    expect(res.body.resultToken).toBeTruthy();
  });

  test('era split does not false-alarm for an era-scoped spec (Codex P2 #8)', async () => {
    const res = mockRes();
    await previewHandler({ method: 'POST', body: { querySpec: baseSpec({ eraScope: 'native' }) } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.eraSplit).toEqual({ scope: 'native', count: 3, otherEraOutOfScope: true });
  });

  test('loud-exclusion waterfall: sequential matched → −operational → '
    + '−test → exported, attribution never double-counts', async () => {
    // era-agnostic ⇒ 5 counts in order: exported, matched, afterOp,
    // migrated, native (the Caltech∧S&E real shape: 47→29).
    fetchXmlAggregateCount
      .mockResolvedValueOnce(29)  // compiled (full spec) = exported/trueTotal
      .mockResolvedValueOnce(47)  // matched (no operational/test)
      .mockResolvedValueOnce(29)  // afterOperational (test still off)
      .mockResolvedValueOnce(23)  // migrated
      .mockResolvedValueOnce(6);  // native
    const res = mockRes();
    await previewHandler({ method: 'POST', body: { querySpec: baseSpec() } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.composition).toEqual(expect.objectContaining({
      matched: 47,
      excludedOperational: 18,   // 47 − 29
      excludedTestRecords: 0,    // 29 − 29 (none removed by test step here)
      exported: 29,
      operationalApplied: true,
      testRecordsApplied: true,
    }));
    expect(res.body.composition.sequencing).toMatch(/never double-counted/);
    expect(res.body.trueTotal).toBe(29);
  });

  test('waterfall: a broken count invariant FAILS LOUD (no clamped, '
    + 'plausible-wrong composition; Codex S161 P2)', async () => {
    // matched < afterOperational is impossible (exclusions only add
    // filters) — must 5xx, never a 200 with a clamped composition/token.
    fetchXmlAggregateCount
      .mockResolvedValueOnce(29)  // exported
      .mockResolvedValueOnce(10)  // matched  (< afterOperational ⇒ invariant break)
      .mockResolvedValueOnce(40)  // afterOperational
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5);
    const res = mockRes();
    await previewHandler({ method: 'POST', body: { querySpec: baseSpec() } }, res);
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body.composition).toBeUndefined();
    expect(res.body.resultToken).toBeUndefined();
  });

  test('isolation on: marked Test Requests are their own counted waterfall step', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    try {
      fetchXmlAggregateCount
        .mockResolvedValueOnce(25)  // exported (full spec, marker + legacy test)
        .mockResolvedValueOnce(47)  // matched (no operational/test/marker)
        .mockResolvedValueOnce(29)  // afterOperational (no marker)
        .mockResolvedValueOnce(20)  // migrated
        .mockResolvedValueOnce(5)   // native
        .mockResolvedValueOnce(27); // afterMarked (+ marker, legacy test off)
      const res = mockRes();
      await previewHandler({ method: 'POST', body: { querySpec: baseSpec() } }, res);
      expect(res.statusCode).toBe(200);
      expect(res.body.composition).toEqual(expect.objectContaining({
        matched: 47,
        excludedOperational: 18,
        excludedMarkedTestRequests: 2,
        markedTestRequestsApplied: true,
        excludedTestRecords: 2,
        exported: 25,
      }));
      const xml = fetchXmlAggregateCount.mock.calls.map((call) => call[1]);
      expect(xml[1]).not.toContain('wmkf_istestrequest');
      expect(xml[2]).not.toContain('wmkf_istestrequest');
      expect(xml[5]).toContain('wmkf_istestrequest');
      expect(xml[0]).toContain('wmkf_istestrequest');
    } finally {
      delete process.env.TEST_REQUEST_ISOLATION;
    }
  });

  test('isolation on: afterMarked below exported fails loud', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    try {
      fetchXmlAggregateCount
        .mockResolvedValueOnce(25).mockResolvedValueOnce(47).mockResolvedValueOnce(29)
        .mockResolvedValueOnce(20).mockResolvedValueOnce(5).mockResolvedValueOnce(24);
      const res = mockRes();
      await previewHandler({ method: 'POST', body: { querySpec: baseSpec() } }, res);
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(res.body.resultToken).toBeUndefined();
    } finally {
      delete process.env.TEST_REQUEST_ISOLATION;
    }
  });

  test('isolation off: composition carries no marked-test keys', async () => {
    const res = mockRes();
    await previewHandler({ method: 'POST', body: { querySpec: baseSpec() } }, res);
    expect(res.body.composition).not.toHaveProperty('excludedMarkedTestRequests');
    expect(res.body.composition).not.toHaveProperty('markedTestRequestsApplied');
    expect(fetchXmlAggregateCount).toHaveBeenCalledTimes(5);
  });

  test('waterfall: exclusions OFF ⇒ matched == exported, applied flags false', async () => {
    fetchXmlAggregateCount.mockResolvedValue(12);
    const res = mockRes();
    await previewHandler({ method: 'POST', body: {
      querySpec: baseSpec({ excludeOperational: false, excludeTestRecords: false }),
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.composition).toEqual(expect.objectContaining({
      matched: 12, excludedOperational: 0, excludedTestRecords: 0, exported: 12,
      operationalApplied: false, testRecordsApplied: false,
    }));
  });
});

describe('run — the stateless confirm gate', () => {
  test('absent token → 403 BEFORE any SSE byte', async () => {
    const res = mockRes();
    await runHandler({ method: 'POST', body: {} }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('CONFIRM_TOKEN_INVALID');
    expect(res.headers['Content-Type']).toBeUndefined(); // no SSE started
    expect(res.chunks).toHaveLength(0);
  });

  test('forged token → 403, no SSE', async () => {
    const res = mockRes();
    await runHandler({ method: 'POST', body: { resultToken: 'not.a.jwt' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.chunks).toHaveLength(0);
  });

  test('honors the TOKEN spec, never a mismatched body spec (Codex P2 #11)', async () => {
    const tokenSpec = baseSpec({
      filters: [{ axis: 'program', op: 'eq', value: 'TOKEN-PROGRAM-GUID' }],
    });
    const { token } = await mintResultToken(tokenSpec, { trueTotal: 3 });
    const bodySpec = baseSpec({
      filters: [{ axis: 'program', op: 'eq', value: 'ATTACKER-BODY-GUID' }],
    });
    const res = mockRes();
    await runHandler({ method: 'POST', body: { resultToken: token, querySpec: bodySpec } }, res);

    expect(fetchXmlAll).toHaveBeenCalled();
    const compiledFetchXml = fetchXmlAll.mock.calls[0][1];
    expect(compiledFetchXml).toContain('TOKEN-PROGRAM-GUID');
    expect(compiledFetchXml).not.toContain('ATTACKER-BODY-GUID');
    const ev = sseEvents(res);
    expect(ev.find(e => e.event === 'ready')).toBeTruthy();
  });

  test('success → PRIVATE blob + gated proxy downloadUrl + expiresInSec', async () => {
    const { token } = await mintResultToken(baseSpec(), { trueTotal: 3 });
    const res = mockRes();
    await runHandler({ method: 'POST', body: { resultToken: token } }, res);
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining('dataverse-export/'),
      expect.any(Buffer),
      expect.objectContaining({ access: 'private',
        token: process.env.DVX_BLOB_RW_TOKEN,
        contentDisposition: expect.stringContaining('attachment') }),
    );
    const ready = sseEvents(res).find(e => e.event === 'ready');
    expect(ready.downloadUrl).toMatch(/^\/api\/dataverse-export\/download\?t=/);
    expect(ready.expiresInSec).toBeGreaterThan(0);
  });

  test('absent DVX_BLOB_RW_TOKEN → 502 BLOB_STORE_UNCONFIGURED pre-stream, '
    + 'NO blob (a public-store misconfig fails loud + clean, never mid-SSE)', async () => {
    const saved = process.env.DVX_BLOB_RW_TOKEN;
    delete process.env.DVX_BLOB_RW_TOKEN;
    try {
      const { token } = await mintResultToken(baseSpec(), { trueTotal: 3 });
      const res = mockRes();
      await runHandler({ method: 'POST', body: { resultToken: token } }, res);
      expect(res.statusCode).toBe(502);
      expect(res.body.error).toBe('BLOB_STORE_UNCONFIGURED');
      expect(put).not.toHaveBeenCalled();
      expect(res.chunks.length).toBe(0); // pre-stream: no SSE bytes
    } finally {
      process.env.DVX_BLOB_RW_TOKEN = saved;
    }
  });

  test('terminal paging error → error frame, NO blob written', async () => {
    fetchXmlAll.mockRejectedValue(Object.assign(new Error('page 3 failed'),
      { name: 'FetchXmlError', stage: 'paging', retryable: false }));
    const { token } = await mintResultToken(baseSpec(), { trueTotal: 9 });
    const res = mockRes();
    await runHandler({ method: 'POST', body: { resultToken: token } }, res);
    const ev = sseEvents(res);
    expect(ev.find(e => e.event === 'error')).toBeTruthy();
    expect(ev.find(e => e.event === 'ready')).toBeFalsy();
    expect(put).not.toHaveBeenCalled();
  });

  test('truncated run still writes the blob + labels it', async () => {
    fetchXmlAll.mockResolvedValue({
      rows: [], fetched: 50000, pages: 50, capped: true, truncatedByBudget: false,
    });
    const { token } = await mintResultToken(baseSpec(), { trueTotal: 99999 });
    const res = mockRes();
    await runHandler({ method: 'POST', body: { resultToken: token } }, res);
    const ev = sseEvents(res);
    expect(ev.find(e => e.event === 'truncated')).toBeTruthy();
    const ready = ev.find(e => e.event === 'ready');
    expect(ready.truncated).toBe(true);
    expect(put).toHaveBeenCalled();
  });
});

describe('metadata + download', () => {
  test('metadata fail-loud → 502 (never a stale/partial list)', async () => {
    fetchLiveTaxonomy.mockRejectedValue(new Error('dataverse down'));
    const res = mockRes();
    await metadataHandler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('TAXONOMY_FETCH_FAILED');
  });

  test('download: invalid token → 403; valid token → streams private blob', async () => {
    const bad = mockRes();
    await downloadHandler({ method: 'GET', query: { t: 'nope' } }, bad);
    expect(bad.statusCode).toBe(403);

    const { Writable, Readable } = require('stream');
    const { token } = await mintDownloadToken('dataverse-export/x-abc.xlsx');
    blobGet.mockResolvedValue({
      stream: Readable.toWeb(Readable.from([Buffer.from('XLSX')])),
      blob: { contentType: 'application/vnd...sheet', size: 4,
        contentDisposition: 'attachment; filename="x.xlsx"' },
    });
    // a real Writable so Readable.fromWeb(stream).pipe(res) works; headers
    // are set synchronously before the pipe, so assert right after the call.
    const headers = {};
    const ok = new Writable({ write(_c, _e, cb) { cb(); } });
    ok.headers = headers;
    ok.statusCode = 200;
    ok.status = (c) => { ok.statusCode = c; return ok; };
    ok.json = (o) => { ok.body = o; return ok; };
    ok.setHeader = (k, v) => { headers[k] = v; };
    await downloadHandler({ method: 'GET', query: { t: token } }, ok);
    expect(blobGet).toHaveBeenCalledWith('dataverse-export/x-abc.xlsx',
      expect.objectContaining({ access: 'private' }));
    expect(headers['Content-Disposition']).toMatch(/attachment/);
  });
});
