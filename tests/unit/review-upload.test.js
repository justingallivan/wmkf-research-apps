/**
 * Tests for the shared review-upload core. Mocks GraphService and
 * DynamicsService to exercise the orchestration logic without touching
 * the network.
 *
 * @jest-environment node
 */

// Phase D: the upload core now loads the live question set + dual-writes the
// rating snapshot rows. Pin the set to the static schema so snapshot decode is
// deterministic without a Dataverse round trip. (Hoisted above imports.)
jest.mock('../../lib/external/review-question-fetcher', () => {
  const { reviewFormSchema } = require('../../lib/external/review-form-schema');
  return { getActiveQuestionSet: jest.fn(async () => reviewFormSchema.fields) };
});

import { GraphService } from '../../lib/services/graph-service.js';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { bypassDynamicsRestrictions } from '../../lib/services/dynamics-context.js';
import NotificationService from '../../lib/services/notification-service.js';
import { clearResolverCache } from '../../lib/services/program-director-resolver.js';
import { writeReviewFiles as writeReviewFilesReal, buildReviewerSubfolder } from '../../lib/services/review-upload.js';

// `installMocks` (below) replaces `DynamicsService.executeChangeset` directly
// with a bare jest.fn(), but the rating-row write path still goes through the
// REAL `lib/dataverse/core/changeset.js#runChangeset`, which — under Stage-7
// enforcement (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md; on by default in
// test) — now requires a trusted Dataverse context before composing the
// changeset. Real callers of `writeReviewFiles` already run inside one (e.g.
// the external-review submit route's bypassDynamicsRestrictions wrapper), so
// every call in this file goes through the same wrapper.
function writeReviewFiles(...args) {
  return bypassDynamicsRestrictions('test-review-upload', () => writeReviewFilesReal(...args));
}

// The parent PATCH body, whichever write path ran: an atomic changeset when
// rating rows are present (the happy path), or a bare updateRecord otherwise.
function parentPatch() {
  if (DynamicsService.executeChangeset.mock.calls.length) {
    const [ops] = DynamicsService.executeChangeset.mock.calls[0];
    return ops[ops.length - 1].body;
  }
  return DynamicsService.updateRecord.mock.calls[0]?.[2];
}

// Replace specific methods with jest.fn() before each test, restore afterwards.
const originals = {};
function installMocks() {
  for (const [obj, names] of [
    [GraphService, ['getDriveId', 'uploadFile', 'deleteFile']],
    [DynamicsService, ['getRecord', 'updateRecord', 'resolveEntitySetName', 'executeChangeset']],
  ]) {
    for (const name of names) {
      if (originals[name] === undefined) originals[name] = obj[name];
      obj[name] = jest.fn();
    }
  }
}
function restoreMocks() {
  for (const [obj, names] of [
    [GraphService, ['getDriveId', 'uploadFile', 'deleteFile']],
    [DynamicsService, ['getRecord', 'updateRecord', 'resolveEntitySetName', 'executeChangeset']],
  ]) {
    for (const name of names) {
      if (originals[name] !== undefined) obj[name] = originals[name];
    }
  }
}
afterAll(() => restoreMocks());

const PDF_BYTES = Buffer.concat([
  Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
  Buffer.alloc(50, 0x20),
]);
const SUGGESTION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REQUEST_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQUEST_NUMBER = '1001289';
// First 8 chars of suggestion GUID (no hyphens) → 'aaaaaaaa'.
// With no reviewer name in the mocked row, sanitizer falls back to short-id-only.
const EXPECTED_FOLDER = `${REQUEST_NUMBER}_${REQUEST_ID.replace(/-/g, '').toUpperCase()}/Reviewer_Uploads/aaaaaaaa`;

function validInput(overrides = {}) {
  return {
    suggestionId: SUGGESTION_ID,
    files: [{ filename: 'review.pdf', buffer: PDF_BYTES }],
    structuredData: {
      affiliation: 'Prof X, U of Example',
      impact: 3,
      risk: 2,
      overallRating: 4,
    },
    opts: { source: 'reviewer_self_token', performedBy: null },
    ...overrides,
  };
}

function mockSuggestionFound() {
  DynamicsService.getRecord.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    // materials_sent (100000001): a normal reviewer who has been released materials and
    // may upload. The Phase-2 self-token guard rejects anything below this value.
    wmkf_reviewstatus: 100000001,
    wmkf_Request: { akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER },
  });
}

function mockSuggestionNotFound() {
  const err = new Error('Not found');
  err.status = 404;
  DynamicsService.getRecord.mockRejectedValue(err);
}

beforeEach(() => {
  installMocks();
  GraphService.getDriveId.mockResolvedValue('drive-id-123');
  GraphService.uploadFile.mockResolvedValue({
    id: 'item-1', name: 'review.pdf', size: PDF_BYTES.length, webUrl: 'https://example/x',
  });
  GraphService.deleteFile.mockResolvedValue(undefined);
  DynamicsService.updateRecord.mockResolvedValue(undefined);
  DynamicsService.resolveEntitySetName.mockResolvedValue('wmkf_appreviewanswers');
  DynamicsService.executeChangeset.mockResolvedValue({ ok: true, operations: [] });
});

describe('writeReviewFiles — argument validation', () => {
  test('rejects missing suggestionId', async () => {
    const r = await writeReviewFiles(validInput({ suggestionId: '' }));
    expect(r).toEqual({ ok: false, reason: 'validation', errors: ['suggestionId required'] });
  });

  test('rejects empty files array', async () => {
    const r = await writeReviewFiles(validInput({ files: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(['at least one file required']);
  });

  test('rejects more than 5 files', async () => {
    const f = { filename: 'review.pdf', buffer: PDF_BYTES };
    const r = await writeReviewFiles(validInput({ files: [f, f, f, f, f, f] }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/max 5/);
  });

  test('rejects unknown source', async () => {
    const r = await writeReviewFiles(validInput({ opts: { source: 'sneaky' } }));
    expect(r.ok).toBe(false);
  });
});

describe('writeReviewFiles — materials-sent upload gate (Phase 2)', () => {
  const withStatus = (wmkf_reviewstatus) => DynamicsService.getRecord.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_reviewstatus,
    wmkf_Request: { akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER },
  });

  test('self-token + status null (accepted-pre-materials) → materials_not_sent, no SharePoint write', async () => {
    withStatus(null);
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual({ ok: false, reason: 'materials_not_sent' });
    expect(GraphService.uploadFile).not.toHaveBeenCalled();
  });

  test('self-token + status accepted (below materials_sent) → materials_not_sent', async () => {
    withStatus(100000000);
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual({ ok: false, reason: 'materials_not_sent' });
  });

  test('self-token + status materials_sent → proceeds', async () => {
    withStatus(100000001);
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(true);
  });

  test('staff_upload is NOT gated even when materials not yet sent', async () => {
    withStatus(null);
    const r = await writeReviewFiles(validInput({ opts: { source: 'staff_upload', actingUserSystemId: 'sys-1' } }));
    expect(r.ok).toBe(true);
  });
});

describe('writeReviewFiles — file validation', () => {
  test('rejects empty file', async () => {
    const r = await writeReviewFiles(validInput({
      files: [{ filename: 'review.pdf', buffer: Buffer.alloc(0) }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/empty/);
  });

  test('rejects oversized file', async () => {
    // 26 MB of PDF magic + zeros
    const big = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), Buffer.alloc(26 * 1024 * 1024)]);
    const r = await writeReviewFiles(validInput({
      files: [{ filename: 'review.pdf', buffer: big }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/exceeds/);
  });

  test('rejects file whose magic bytes lie about the extension', async () => {
    const r = await writeReviewFiles(validInput({
      files: [{ filename: 'review.pdf', buffer: Buffer.from('not a pdf') }],
    }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/PDF/);
  });
});

describe('writeReviewFiles — structured-data validation', () => {
  test('rejects missing affiliation', async () => {
    const r = await writeReviewFiles(validInput({
      structuredData: { impact: 3, risk: 2, overallRating: 4 },
    }));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => /Organization/.test(e))).toBe(true);
  });

  test('rejects out-of-range picklist', async () => {
    const r = await writeReviewFiles(validInput({
      structuredData: { affiliation: 'X', impact: 99, risk: 99, overallRating: 17 },
    }));
    expect(r.ok).toBe(false);
  });
});

describe('writeReviewFiles — happy paths', () => {
  test('reviewer self-serve: writes to SharePoint, PATCHes Dataverse', async () => {
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(true);
    expect(r.folder).toBe(EXPECTED_FOLDER);
    expect(GraphService.uploadFile).toHaveBeenCalledWith(
      'akoya_request',
      EXPECTED_FOLDER,
      'review.pdf',
      PDF_BYTES,
      'application/pdf',
    );
    const patch = parentPatch();
    expect(patch).toMatchObject({
      wmkf_revieweraffiliation: 'Prof X, U of Example',
      wmkf_reviewsharepointfolder: EXPECTED_FOLDER,
      wmkf_reviewfilename: 'review.pdf',
      wmkf_reviewuploadedbystaff: false,
    });
    // Phase E: the parent PATCH no longer carries the rating columns.
    expect(patch.wmkf_reviewerimpact).toBeUndefined();
    expect(patch.wmkf_reviewerrisk).toBeUndefined();
    expect(patch.wmkf_revieweroverallrating).toBeUndefined();
    expect(patch.wmkf_reviewreceivedat).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The changeset carries the 3 rating snapshot rows, addressed by alternate
    // key, byte-identical to a reviewer-written row.
    const [ops] = DynamicsService.executeChangeset.mock.calls[0];
    const answerOps = ops.filter((o) => /wmkf_questionkey=/.test(o.url));
    expect(answerOps).toHaveLength(3);
    const impactOp = answerOps.find((o) => o.url.includes("wmkf_questionkey='impact'"));
    expect(impactOp.url).toContain(`_wmkf_appreviewersuggestion_value=${SUGGESTION_ID}`);
    expect(impactOp.body).toMatchObject({
      wmkf_questionorder: 1,
      wmkf_questiontype: 'picklist',
      wmkf_answervalue: 3,
      wmkf_answertext: 'Will result in publications of broad interest',
      wmkf_answerhtml: null,
    });
  });

  test('staff source: sets wmkf_reviewuploadedbystaff = true', async () => {
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput({
      opts: { source: 'staff_upload', performedBy: 42 },
    }));
    expect(r.ok).toBe(true);
    expect(parentPatch().wmkf_reviewuploadedbystaff).toBe(true);
  });

  test('multi-file upload writes each file in order', async () => {
    mockSuggestionFound();
    GraphService.uploadFile
      .mockResolvedValueOnce({ id: 'item-1', name: 'a.pdf', size: 50, webUrl: 'x' })
      .mockResolvedValueOnce({ id: 'item-2', name: 'b.pdf', size: 50, webUrl: 'y' });
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'a.pdf', buffer: PDF_BYTES },
        { filename: 'b.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(GraphService.uploadFile).toHaveBeenCalledTimes(2);
    expect(r.files).toHaveLength(2);
    // primary filename = first file
    expect(parentPatch().wmkf_reviewfilename).toBe('a.pdf');
  });
});

describe('writeReviewFiles — failure paths', () => {
  test('returns not_found when suggestion does not exist', async () => {
    mockSuggestionNotFound();
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(GraphService.uploadFile).not.toHaveBeenCalled();
  });

  test('returns not_found when expanded request is missing', async () => {
    DynamicsService.getRecord.mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    const r = await writeReviewFiles(validInput());
    expect(r.reason).toBe('not_found');
  });

  test('SharePoint failure mid-upload triggers cleanup of prior items', async () => {
    mockSuggestionFound();
    GraphService.uploadFile
      .mockResolvedValueOnce({ id: 'item-1', name: 'a.pdf', size: 50, webUrl: 'x' })
      .mockRejectedValueOnce(new Error('SharePoint 503'));
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'a.pdf', buffer: PDF_BYTES },
        { filename: 'b.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('sharepoint_failed');
    expect(r.partial).toEqual(['a.pdf']);
    expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-id-123', 'item-1');
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
    expect(DynamicsService.executeChangeset).not.toHaveBeenCalled();
  });

  test('Dataverse PATCH failure triggers SharePoint rollback', async () => {
    mockSuggestionFound();
    GraphService.uploadFile.mockResolvedValue({ id: 'item-1', name: 'review.pdf', size: 50, webUrl: 'x' });
    DynamicsService.executeChangeset.mockRejectedValue(new Error('Dataverse 500'));
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dataverse_failed');
    expect(r.cleanedUp).toBe(true);
    expect(GraphService.deleteFile).toHaveBeenCalledWith('drive-id-123', 'item-1');
  });

  test('Dataverse failure + cleanup failure flags cleanedUp=false', async () => {
    mockSuggestionFound();
    GraphService.uploadFile.mockResolvedValue({ id: 'item-1', name: 'review.pdf', size: 50, webUrl: 'x' });
    DynamicsService.executeChangeset.mockRejectedValue(new Error('Dataverse 500'));
    GraphService.deleteFile.mockRejectedValue(new Error('SharePoint cleanup 500'));
    // Suppress the expected console.error during this test
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dataverse_failed');
    expect(r.cleanedUp).toBe(false);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('writeReviewFiles — virus scan integration', () => {
  // We don't mock scanBytes itself — we mock global.fetch underneath it.
  // Lets the real cloudmersive-scan.js exercise its own contract (env-var
  // gate, isTransient classification, error wrapping) while we control
  // what the scanner "sees."
  const originalFetch = global.fetch;
  const originalKey = process.env.CLOUDMERSIVE_API_KEY;
  const originalEnabled = process.env.VIRUS_SCAN_ENABLED;

  beforeEach(() => {
    process.env.CLOUDMERSIVE_API_KEY = 'test-key';
    // Caller-side beforeEach already installs the GraphService/DynamicsService
    // mocks via installMocks(); we layer the fetch mock on top here.
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CLOUDMERSIVE_API_KEY;
    else process.env.CLOUDMERSIVE_API_KEY = originalKey;
    if (originalEnabled === undefined) delete process.env.VIRUS_SCAN_ENABLED;
    else process.env.VIRUS_SCAN_ENABLED = originalEnabled;
  });

  function mockScanResponses(responses) {
    // responses: per-call output, in order. Each is either:
    //   { status, body }  (a fetch response)
    //   Error instance    (thrown by fetch)
    let idx = 0;
    global.fetch = jest.fn(async () => {
      if (idx >= responses.length) {
        throw new Error(`fetch called ${idx + 1}× but only ${responses.length} responses configured`);
      }
      const r = responses[idx++];
      if (r instanceof Error) throw r;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
        json: async () => r.body ?? {},
      };
    });
  }

  test('flag off → no scan happens, upload proceeds', async () => {
    delete process.env.VIRUS_SCAN_ENABLED;
    global.fetch = jest.fn(async () => { throw new Error('fetch should not be called when flag is off'); });
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(GraphService.uploadFile).toHaveBeenCalled();
  });

  test('flag off (empty string) → no scan happens', async () => {
    process.env.VIRUS_SCAN_ENABLED = '';
    global.fetch = jest.fn(async () => { throw new Error('fetch should not be called'); });
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('flag off (literal "false") → no scan happens', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'false';
    global.fetch = jest.fn(async () => { throw new Error('fetch should not be called'); });
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('flag on + all clean → upload proceeds', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 200, body: { CleanResult: true, FoundViruses: [] } },
    ]);
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(GraphService.uploadFile).toHaveBeenCalled();
  });

  test('flag on + one of three infected → reason=infected, NO SharePoint write', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 200, body: { CleanResult: true, FoundViruses: [] } },
      { status: 200, body: { CleanResult: false, FoundViruses: [{ FileName: 'b.pdf', VirusName: 'EICAR-Test-Signature' }] } },
      { status: 200, body: { CleanResult: true, FoundViruses: [] } },
    ]);
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'a.pdf', buffer: PDF_BYTES },
        { filename: 'b.pdf', buffer: PDF_BYTES },
        { filename: 'c.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r).toEqual(expect.objectContaining({
      ok: false,
      reason: 'infected',
      errors: ['b.pdf: virus detected (EICAR-Test-Signature)'],
    }));
    expect(GraphService.uploadFile).not.toHaveBeenCalled();
    expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  });

  test('flag on + multiple infected → errors lists all detections', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ FileName: 'a.pdf', VirusName: 'V1' }] } },
      { status: 200, body: { CleanResult: false, FoundViruses: [{ FileName: 'b.pdf', VirusName: 'V2' }] } },
    ]);
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'a.pdf', buffer: PDF_BYTES },
        { filename: 'b.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('infected');
    expect(r.errors).toEqual([
      'a.pdf: virus detected (V1)',
      'b.pdf: virus detected (V2)',
    ]);
  });

  test('flag on + infected with missing virusName → falls back to "unknown signature"', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 200, body: { CleanResult: false, FoundViruses: [] } },
    ]);
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('infected');
    expect(r.errors[0]).toBe('review.pdf: virus detected (unknown signature)');
  });

  test('flag on + scanner 5xx-exhaust → reason=scan_unavailable, NO SharePoint write', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    // cloudmersive-scan.js retries 5xx up to MAX_ATTEMPTS=3.
    mockScanResponses([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
    ]);
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: "scan_unavailable" }));
    expect(GraphService.uploadFile).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('flag on + scanner 401 → reason=scan_misconfigured, NO SharePoint write', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 401, body: 'bad key' },
    ]);
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: "scan_misconfigured" }));
    expect(GraphService.uploadFile).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('flag on + missing CLOUDMERSIVE_API_KEY → reason=scan_misconfigured', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    delete process.env.CLOUDMERSIVE_API_KEY;
    global.fetch = jest.fn(async () => { throw new Error('fetch should not be called when key missing'); });
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: "scan_misconfigured" }));
    expect(global.fetch).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('flag on + mixed misconfig + outage → misconfigured wins (operator priority)', async () => {
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 401, body: 'bad key' },
    ]);
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'a.pdf', buffer: PDF_BYTES },
        { filename: 'b.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: "scan_misconfigured" }));
    errSpy.mockRestore();
  });

  test('flag on + infected + outage in same batch → outage wins over infected (response-reason precedence)', async () => {
    // Response-reason precedence: if any file failed to scan, the user-facing
    // response is `scan_unavailable` rather than `infected` — we don't know
    // whether the un-scanned file is also infected, so we force a clean
    // rescan once the scanner recovers. The detection alert path is
    // separately exercised by 'fires alert for known infected files even
    // when the response wins as scan_unavailable' below; the two concerns
    // are decoupled per Codex 2026-05-26 review.
    process.env.VIRUS_SCAN_ENABLED = 'true';
    mockScanResponses([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'V1' }] } },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
    ]);
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'a.pdf', buffer: PDF_BYTES },
        { filename: 'b.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'scan_unavailable' }));
    errSpy.mockRestore();
  });
});

describe('writeReviewFiles — detection alert (B1)', () => {
  // The shared install/restore in this file mocks GraphService + DynamicsService.
  // The detection alert calls NotificationService.notify with an explicit-recipients
  // payload (PD email may be null, in which case the recipients array is empty
  // and category routing handles it). We spy on notify rather than the upstream
  // PD resolver so the test asserts the contract the operator actually receives.
  const originalKey = process.env.CLOUDMERSIVE_API_KEY;
  const originalEnabled = process.env.VIRUS_SCAN_ENABLED;
  const originalFetch = global.fetch;
  let notifySpy;

  beforeEach(() => {
    process.env.CLOUDMERSIVE_API_KEY = 'test-key';
    process.env.VIRUS_SCAN_ENABLED = 'true';
    notifySpy = jest.spyOn(NotificationService, 'notify').mockResolvedValue(null);
    // PD resolver caches per-process; clear so each test's mocked Dataverse
    // chain is exercised rather than the prior test's cached null.
    clearResolverCache();
  });

  afterEach(() => {
    notifySpy.mockRestore();
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.CLOUDMERSIVE_API_KEY;
    else process.env.CLOUDMERSIVE_API_KEY = originalKey;
    if (originalEnabled === undefined) delete process.env.VIRUS_SCAN_ENABLED;
    else process.env.VIRUS_SCAN_ENABLED = originalEnabled;
  });

  function mockScan(responses) {
    let idx = 0;
    global.fetch = jest.fn(async () => {
      const r = responses[idx++];
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: async () => JSON.stringify(r.body ?? {}),
        json: async () => r.body ?? {},
      };
    });
  }

  test('infected → NotificationService.notify called once with detection metadata', async () => {
    mockScan([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'EICAR' }] } },
    ]);
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.reason).toBe('infected');

    // Yield a microtask so the fire-and-forget alert promise settles
    await Promise.resolve();
    await Promise.resolve();

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const call = notifySpy.mock.calls[0][0];
    expect(call.type).toBe('virus_detection_reviewer');
    expect(call.severity).toBe('error');
    expect(call.source).toBe('review-upload');
    expect(call.category).toBe('virus-detection');
    expect(call.metadata).toEqual(expect.objectContaining({
      suggestionId: SUGGESTION_ID,
      requestId: REQUEST_ID,
      requestNumber: REQUEST_NUMBER,
      source: 'reviewer_self_token',
    }));
    expect(call.metadata.fileDetections).toEqual([
      'review.pdf: virus detected (EICAR)',
    ]);
    // The foundation alerts address comes from category routing
    // ('virus-detection' in /admin → Alert Recipients), not from this
    // call. explicitRecipients carries the per-event PD email when
    // resolvable; the mocked suggestion here has no PD, so it's empty.
    expect(call.explicitRecipients).toEqual([]);
  });

  test('scan_misconfigured does NOT fire a detection alert', async () => {
    // Returning 401 fails-loud as a config bug; not a per-event detection.
    mockScan([{ status: 401, body: 'bad key' }]);
    mockSuggestionFound();
    const r = await writeReviewFiles(validInput());
    expect(r.reason).toBe('scan_misconfigured');
    await Promise.resolve();
    expect(notifySpy).not.toHaveBeenCalled();
  });

  test('scan_unavailable does NOT fire a detection alert', async () => {
    mockScan([
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
    ]);
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r.reason).toBe('scan_unavailable');
    await Promise.resolve();
    expect(notifySpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test('mixed batch (infected + outage) still fires alert for the known infected file', async () => {
    // Response-reason precedence promotes the outage to scan_unavailable
    // (covered separately above). The detection alert must still fire for
    // the file we know was infected — pre-S190 Codex review caught that
    // the alert path was gated on `reason === 'infected'`, which silently
    // suppressed alerts on mixed batches.
    mockScan([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'EICAR' }] } },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
      { status: 503, body: 'down' },
    ]);
    mockSuggestionFound();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput({
      files: [
        { filename: 'infected.pdf', buffer: PDF_BYTES },
        { filename: 'unscanned.pdf', buffer: PDF_BYTES },
      ],
    }));
    expect(r.reason).toBe('scan_unavailable');
    await Promise.resolve();
    await Promise.resolve();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const call = notifySpy.mock.calls[0][0];
    expect(call.type).toBe('virus_detection_reviewer');
    expect(call.metadata.fileDetections).toEqual([
      'infected.pdf: virus detected (EICAR)',
    ]);
    errSpy.mockRestore();
  });

  test('successful PD resolution → explicitRecipients contains the PD email', async () => {
    // Mock the 3-step PD lookup chain explicitly: suggestion read,
    // akoya_request read, systemusers query. Earlier tests in this block
    // share the suggestion-shaped mock for every getRecord call which
    // gracefully resolves PD as null — useful for the category-only path
    // but not for verifying the success path.
    mockScan([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'EICAR' }] } },
    ]);
    const PD_GUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    DynamicsService.getRecord
      // 1. fireReviewDetectionAlert: load suggestion (with expand)
      .mockResolvedValueOnce({
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_request_value: REQUEST_ID,
        wmkf_Request: { akoya_requestid: REQUEST_ID, akoya_requestnum: REQUEST_NUMBER, akoya_title: 'Test' },
        wmkf_PotentialReviewer: { wmkf_lastname: 'Patel', wmkf_name: 'A. Patel', wmkf_emailaddress: 'a@ex.org' },
      })
      // 2. resolveProgramDirectorEmailForRequest: load akoya_request
      .mockResolvedValueOnce({
        _wmkf_programdirector_value: PD_GUID,
      })
      // 3. resolveProgramDirectorEmailForRequest: load systemuser
      .mockResolvedValueOnce({
        internalemailaddress: 'pd@example.org',
        isdisabled: false,
      });

    const r = await writeReviewFiles(validInput());
    expect(r.reason).toBe('infected');
    await Promise.resolve();
    await Promise.resolve();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const call = notifySpy.mock.calls[0][0];
    expect(call.category).toBe('virus-detection');
    expect(call.explicitRecipients).toEqual(['pd@example.org']);
  });

  test('PD resolver failure still fires the alert with empty explicitRecipients (category fallback)', async () => {
    // The detection alert must remain durable even if any step of the PD
    // chain throws — the category-routed foundation address still gets
    // notified via category routing.
    mockScan([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'EICAR' }] } },
    ]);
    DynamicsService.getRecord.mockRejectedValue(new Error('Dataverse 503'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r.reason).toBe('infected');
    await Promise.resolve();
    await Promise.resolve();
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const call = notifySpy.mock.calls[0][0];
    expect(call.category).toBe('virus-detection');
    expect(call.explicitRecipients).toEqual([]);
    warnSpy.mockRestore();
  });

  test('PD chain falls back to _wmkf_request_value when expand is missing akoya_requestid', async () => {
    // Codex 2026-05-26: if the expand returns wmkf_Request without
    // akoya_requestid populated, we still have _wmkf_request_value from
    // the top-level $select. Use it rather than silently skipping the
    // PD lookup.
    mockScan([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'EICAR' }] } },
    ]);
    const PD_GUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    DynamicsService.getRecord
      .mockResolvedValueOnce({
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        _wmkf_request_value: REQUEST_ID,
        // Note: wmkf_Request omitted (expand flaked)
      })
      .mockResolvedValueOnce({ _wmkf_programdirector_value: PD_GUID })
      .mockResolvedValueOnce({ internalemailaddress: 'pd@example.org', isdisabled: false });

    await writeReviewFiles(validInput());
    await Promise.resolve();
    await Promise.resolve();
    expect(notifySpy.mock.calls[0][0].explicitRecipients).toEqual(['pd@example.org']);
  });

  test('NotificationService throwing does NOT alter the client rejection', async () => {
    mockScan([
      { status: 200, body: { CleanResult: false, FoundViruses: [{ VirusName: 'EICAR' }] } },
    ]);
    mockSuggestionFound();
    notifySpy.mockRejectedValue(new Error('notification service down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await writeReviewFiles(validInput());
    expect(r).toEqual(expect.objectContaining({
      ok: false,
      reason: 'infected',
      errors: ['review.pdf: virus detected (EICAR)'],
    }));
    await Promise.resolve();
    await Promise.resolve();
    errSpy.mockRestore();
  });
});

describe('buildReviewerSubfolder', () => {
  const SID = '7f3a9c2e-1234-5678-9abc-def012345678';
  // First 8 chars of the GUID with hyphens stripped: '7f3a9c2e'

  test('produces {LastName}_{shortId} for a normal name', () => {
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: 'Patel' })).toBe('Patel_7f3a9c2e');
  });

  test('falls back to last word of full name when lastname is empty', () => {
    expect(buildReviewerSubfolder(SID, { wmkf_name: 'Dr. Anika Patel' })).toBe('Patel_7f3a9c2e');
  });

  test('strips diacritical marks via NFD normalization', () => {
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: 'José' })).toBe('Jose_7f3a9c2e');
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: 'Müller' })).toBe('Muller_7f3a9c2e');
  });

  test('strips punctuation, spaces, apostrophes', () => {
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: "O'Brien" })).toBe('OBrien_7f3a9c2e');
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: 'van der Berg' })).toBe('vanderBerg_7f3a9c2e');
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: 'Smith-Jones' })).toBe('SmithJones_7f3a9c2e');
  });

  test('truncates very long names', () => {
    const longName = 'A'.repeat(50);
    const folder = buildReviewerSubfolder(SID, { wmkf_lastname: longName });
    expect(folder).toBe('A'.repeat(30) + '_7f3a9c2e');
  });

  test('falls back to short-id-only when sanitization produces empty', () => {
    // CJK-only name: NFD doesn't fold to ASCII, sanitizer strips it to empty.
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: '李四' })).toBe('7f3a9c2e');
    // No reviewer at all
    expect(buildReviewerSubfolder(SID, null)).toBe('7f3a9c2e');
    // Reviewer with empty fields
    expect(buildReviewerSubfolder(SID, { wmkf_lastname: '', wmkf_name: '' })).toBe('7f3a9c2e');
  });

  test('strips honorifics from full name fallback', () => {
    expect(buildReviewerSubfolder(SID, { wmkf_name: 'Prof. Patel' })).toBe('Patel_7f3a9c2e');
    expect(buildReviewerSubfolder(SID, { wmkf_name: 'Professor Anika Patel' })).toBe('Patel_7f3a9c2e');
  });
});
