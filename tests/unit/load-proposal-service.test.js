/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/load-proposal-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — logic-level coverage
 * with adapters/Graph/Blob mocked: exact canonical selection, the exact
 * current-cycle Phase I fallback, explicit historical override, bucket
 * dedupe, per-bucket listing failure tolerance, and each LoadProposalError
 * with its pinned httpStatus/body.
 *
 * Also covers the Step 1 proposal-blob-cache addition (S397,
 * outputs/reviewer-find-warm-revisit-step0-findings.md "Step 1 — APPROVED"):
 * deterministic cache path, head()-hit short-circuit, head()-miss/head()-error
 * fall-through to download+put, cache-key sensitivity to lastModified/size/
 * fileKey-override, the cached-size-mismatch guard (treat as miss, self-heal
 * via overwrite), and the miss-path race guard (file changed between listing
 * and download → uncached random-suffix upload, never persisted under a
 * stale version key). `file()` fixture fields (name/size/mimeType/
 * lastModified/folder) mirror the exact shape GraphService.listFiles returns
 * per-item (lib/services/graph-service.js:351-359: name, size,
 * lastModified: item.lastModifiedDateTime, mimeType, webUrl, id, folder).
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  __esModule: true,
  getById: jest.fn(),
  SELECT_PROFILES: { IDENTITY: ['akoya_requestid', 'akoya_requestnum'] },
}));
const listFiles = jest.fn();
const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    listFiles: (...a) => listFiles(...a),
    downloadFileByPath: (...a) => downloadFileByPath(...a),
  },
}));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));
const put = jest.fn();
const head = jest.fn();
class BlobNotFoundError extends Error {}
jest.mock('@vercel/blob', () => ({
  put: (...a) => put(...a),
  head: (...a) => head(...a),
  BlobNotFoundError,
}));
// classifyFile now lives in its canonical service home (Stage 5 batch 2 —
// plumbing-only mock retarget; the mocked classifier behavior is unchanged).
jest.mock('../../lib/services/grant-reporting/classify-file', () => ({
  classifyFile: (name) => (/narrative|proposal|phase/i.test(name) ? 'proposal' : 'other'),
}));

const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request.js');
const { getRequestSharePointBuckets } = require('../../lib/utils/sharepoint-buckets');
const { loadProposal, LoadProposalError } = require('../../lib/services/reviewer-finder/load-proposal-service');

const REQ = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function file(name, over = {}) {
  return {
    name,
    size: 10,
    mimeType: 'application/pdf',
    lastModified: '2026-01-01',
    folder: 'F/Reviewer Materials',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  grantRequestAdapter.getById.mockResolvedValue({ akoya_requestid: REQ, akoya_requestnum: '1002836' });
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'F', source: 'dynamics' },
  ]);
  // filename/size mirror the picked file's own name/size (production-shaped:
  // Graph's downloadFileByPath returns the file it was asked for, so
  // `downloaded.filename` and `picked.name` are the same file, and the miss
  // path's `size: downloaded.size` and the hit path's `size: cached.size`
  // describe the same bytes) rather than a fixed, mismatched fixture name —
  // otherwise a hit/miss parity test would silently pass by comparing two
  // different payloads.
  downloadFileByPath.mockImplementation(async (_library, _folder, name) => ({
    buffer: Buffer.from('x'), filename: name, mimeType: 'application/pdf', size: 10,
  }));
  put.mockResolvedValue({ url: 'https://blob.example/x.pdf' });
  // Default: cache miss on every test unless a test overrides it, so the
  // pre-existing golden-path/error-path assertions below (all written
  // against the download+put behavior) are unaffected by the cache addition.
  head.mockRejectedValue(new BlobNotFoundError('not found'));
});

const CACHE_PATH_RE = /^reviewer-finder\/1002836\/[0-9a-f]{16}\/[^/]+$/;

test('404 LoadProposalError with default { error } body when the request is missing its number', async () => {
  grantRequestAdapter.getById.mockResolvedValue(null);
  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err).toBeInstanceOf(LoadProposalError);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toBeUndefined();
  expect(err.message).toBe(`Request ${REQ} not found or missing request number.`);
});

test('404 with explicit { error, requestNumber, libraries } body when no files exist; per-bucket errors surfaced', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'F', source: 'dynamics' },
    { library: 'RequestArchive1', folder: 'G', source: 'archive' },
  ]);
  listFiles.mockImplementation(async (library) => {
    if (library === 'RequestArchive1') throw new Error('Graph 403');
    return [];
  });
  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body).toEqual({
    error: 'No SharePoint files found for this request.',
    requestNumber: '1002836',
    libraries: [
      { library: 'akoya_request', folder: 'F', error: null },
      { library: 'RequestArchive1', folder: 'G', error: 'Graph 403' },
    ],
  });
});

test('400 with { error, allFiles } body when an explicit fileKey is not found', async () => {
  listFiles.mockResolvedValue([file('Narrative.pdf')]);
  const err = await loadProposal({ requestId: REQ, fileKey: 'nope::nope::nope' }).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.body.error).toBe("fileKey not found in this request's libraries: nope::nope::nope");
  expect(err.body.allFiles).toHaveLength(1);
});

test('default falls back to the exact active Phase I ProjectDescription PDF', async () => {
  listFiles.mockResolvedValue([
    file('ProjectDescription.pdf', { folder: 'F/Phase I' }),
  ]);
  const out = await loadProposal({ requestId: REQ });
  expect(out.picked).toBe('akoya_request::F/Phase I::ProjectDescription.pdf');
  expect(downloadFileByPath).toHaveBeenCalledWith(
    'akoya_request',
    'F/Phase I',
    'ProjectDescription.pdf',
  );
});

test('default prefers the exact active canonical proposal over the Phase I fallback', async () => {
  listFiles.mockResolvedValue([
    file('ProjectDescription.pdf', { folder: 'F/Phase I' }),
    file('Proposal_1002836.pdf'),
  ]);
  const out = await loadProposal({ requestId: REQ });
  expect(out.picked).toBe('akoya_request::F/Reviewer Materials::Proposal_1002836.pdf');
});

test('default fails closed and returns the picker list when neither automatic path exists', async () => {
  listFiles.mockResolvedValue([
    file('Project Narrative.pdf', { folder: 'F/Phase I' }),
  ]);
  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body.error).toBe(
    'Reviewer proposal not found at Reviewer Materials/Proposal_1002836.pdf or Phase I/ProjectDescription.pdf. Choose a request file to override.',
  );
  expect(err.body.allFiles).toHaveLength(1);
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test('fallback excludes archive, wrong-folder, and wrong-case lookalikes', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'F', source: 'dynamics' },
    { library: 'RequestArchive1', folder: 'A', source: 'archive' },
  ]);
  listFiles.mockImplementation(async (library) => (
    library === 'akoya_request'
      ? [
        file('ProjectDescription.pdf', { folder: 'F/Phase II' }),
        file('projectdescription.pdf', { folder: 'F/Phase I' }),
      ]
      : [file('ProjectDescription.pdf', { folder: 'A/Phase I' })]
  ));

  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(404);
  expect(err.body.allFiles).toHaveLength(3);
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test('duplicate library::folder::name entries across buckets are deduped in allFiles', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'F', source: 'dynamics' },
    { library: 'akoya_request', folder: 'F', source: 'dynamics' },
  ]);
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  const out = await loadProposal({ requestId: REQ });
  expect(out.allFiles).toHaveLength(1);
});

test('golden path (cache miss) downloads, uploads at the deterministic hashed path with no random suffix, and allows overwrite', async () => {
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  const out = await loadProposal({ requestId: REQ });
  expect(out).toEqual({
    success: true,
    blobUrl: 'https://blob.example/x.pdf',
    filename: 'Proposal_1002836.pdf',
    contentType: 'application/pdf',
    size: 10,
    picked: 'akoya_request::F/Reviewer Materials::Proposal_1002836.pdf',
    requestNumber: '1002836',
    allFiles: [expect.objectContaining({
      name: 'Proposal_1002836.pdf',
      classification: 'proposal',
      source: 'dynamics',
    })],
  });
  expect(head).toHaveBeenCalledWith(expect.stringMatching(CACHE_PATH_RE));
  expect(put).toHaveBeenCalledWith(
    expect.stringMatching(CACHE_PATH_RE),
    expect.any(Buffer),
    {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: true,
    },
  );
  // put must land at the exact path head() was checked against.
  expect(put.mock.calls[0][0]).toBe(head.mock.calls[0][0]);
});

test('cache hit: returns the existing blob contract-identical, with no download or put', async () => {
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  // `file()`'s default size is 10 — the cached blob's size must match
  // picked.size for this to count as a real hit.
  head.mockResolvedValue({
    url: 'https://blob.example/cached.pdf',
    contentType: 'application/pdf',
    size: 10,
    pathname: 'reviewer-finder/1002836/deadbeefdeadbeef/Proposal_1002836.pdf',
  });
  const out = await loadProposal({ requestId: REQ });
  expect(out).toEqual({
    success: true,
    blobUrl: 'https://blob.example/cached.pdf',
    filename: 'Proposal_1002836.pdf',
    contentType: 'application/pdf',
    size: 10,
    picked: 'akoya_request::F/Reviewer Materials::Proposal_1002836.pdf',
    requestNumber: '1002836',
    allFiles: [expect.objectContaining({
      name: 'Proposal_1002836.pdf',
      classification: 'proposal',
      source: 'dynamics',
    })],
  });
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test('head() hit with a mismatched size is treated as a miss (warns, downloads, self-heals via overwrite)', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  // Codex adversarial finding: a stored blob whose size doesn't match the
  // metadata we keyed the cache on (hash collision, or an entry written
  // under a since-widened key scheme) must not be served as-is.
  head.mockResolvedValue({
    url: 'https://blob.example/cached.pdf',
    contentType: 'application/pdf',
    size: 12345,
    pathname: 'reviewer-finder/1002836/deadbeefdeadbeef/Proposal_1002836.pdf',
  });
  const out = await loadProposal({ requestId: REQ });
  expect(downloadFileByPath).toHaveBeenCalled();
  expect(put).toHaveBeenCalledWith(
    expect.stringMatching(CACHE_PATH_RE),
    expect.any(Buffer),
    expect.objectContaining({ addRandomSuffix: false, allowOverwrite: true }),
  );
  expect(out.blobUrl).toBe('https://blob.example/x.pdf');
  expect(out.size).toBe(10);
  expect(warnSpy).toHaveBeenCalledWith(
    '[load-proposal] blob cache size mismatch (treating as miss): '
    + 'cached=12345 expected=10 request=1002836',
  );
  warnSpy.mockRestore();
});

test('cache hit payload is contract-identical to the cache miss payload for the same file', async () => {
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  // Miss: default head() rejects not-found; put() resolves to the fixed URL
  // set in the outer beforeEach.
  const missOut = await loadProposal({ requestId: REQ });

  // Hit: head() now resolves, describing the exact same blob (same URL,
  // same content-type/size as what the miss path just "uploaded" and
  // returned) — the deterministic path means a real hit is always a
  // description of the same bytes the miss path produced.
  head.mockReset();
  head.mockResolvedValue({
    url: missOut.blobUrl,
    contentType: missOut.contentType,
    size: missOut.size,
  });
  const hitOut = await loadProposal({ requestId: REQ });

  expect(hitOut).toEqual(missOut);
});

test('a changed lastModified hashes to a different cache path (invalidates naturally)', async () => {
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  await loadProposal({ requestId: REQ });
  const originalPath = head.mock.calls[0][0];

  head.mockClear();
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf', { lastModified: '2026-02-01' })]);
  await loadProposal({ requestId: REQ });
  const changedPath = head.mock.calls[0][0];

  expect(changedPath).not.toBe(originalPath);
});

test('a changed size hashes to a different cache path (invalidates naturally)', async () => {
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  await loadProposal({ requestId: REQ });
  const originalPath = head.mock.calls[0][0];

  head.mockClear();
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf', { size: 999 })]);
  await loadProposal({ requestId: REQ });
  const changedPath = head.mock.calls[0][0];

  expect(changedPath).not.toBe(originalPath);
});

test('missing lastModified/size skips the cache check entirely and falls straight to download', async () => {
  listFiles.mockResolvedValue([
    file('Proposal_1002836.pdf', { lastModified: undefined, size: undefined }),
  ]);
  const out = await loadProposal({ requestId: REQ });
  expect(head).not.toHaveBeenCalled();
  expect(downloadFileByPath).toHaveBeenCalled();
  expect(put).toHaveBeenCalled();
  expect(out.blobUrl).toBe('https://blob.example/x.pdf');
});

test('miss path: file changed between listing and download (size mismatch) uploads uncached at the legacy random-suffix path', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]); // listed size: 10
  downloadFileByPath.mockResolvedValue({
    buffer: Buffer.from('xyz'), filename: 'Proposal_1002836.pdf', mimeType: 'application/pdf', size: 999,
  });
  const out = await loadProposal({ requestId: REQ });
  expect(put).toHaveBeenCalledWith(
    'reviewer-finder/1002836/Proposal_1002836.pdf',
    expect.any(Buffer),
    { access: 'public', contentType: 'application/pdf', addRandomSuffix: true },
  );
  // Never written under the version-keyed cache path.
  expect(put).not.toHaveBeenCalledWith(
    expect.stringMatching(CACHE_PATH_RE),
    expect.anything(),
    expect.anything(),
  );
  expect(out).toEqual({
    success: true,
    blobUrl: 'https://blob.example/x.pdf',
    filename: 'Proposal_1002836.pdf',
    contentType: 'application/pdf',
    size: 999,
    picked: 'akoya_request::F/Reviewer Materials::Proposal_1002836.pdf',
    requestNumber: '1002836',
    allFiles: [expect.objectContaining({
      name: 'Proposal_1002836.pdf',
      classification: 'proposal',
      source: 'dynamics',
    })],
  });
  expect(warnSpy).toHaveBeenCalledWith(
    '[load-proposal] downloaded size 999 != listed size 10 '
    + 'for request=1002836 — file changed mid-flight, uploading uncached',
  );
  warnSpy.mockRestore();
});

test('an explicit fileKey override picks its own file identity and therefore its own cache key', async () => {
  listFiles.mockResolvedValue([
    file('Proposal_1002836.pdf'),
    file('ProjectDescription.pdf', { folder: 'F/Phase I' }),
  ]);
  await loadProposal({ requestId: REQ });
  const canonicalPath = head.mock.calls[0][0];

  head.mockClear();
  const key = 'akoya_request::F/Phase I::ProjectDescription.pdf';
  await loadProposal({ requestId: REQ, fileKey: key });
  const overridePath = head.mock.calls[0][0];

  expect(overridePath).not.toBe(canonicalPath);
});

test('head() throwing a non-not-found error still falls through to download (fail open) and warns', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  head.mockRejectedValue(new Error('transient network error'));
  const out = await loadProposal({ requestId: REQ });
  expect(downloadFileByPath).toHaveBeenCalled();
  expect(put).toHaveBeenCalled();
  expect(out.blobUrl).toBe('https://blob.example/x.pdf');
  expect(warnSpy).toHaveBeenCalledWith(
    '[load-proposal] blob cache check failed (treating as miss):',
    'transient network error',
  );
  warnSpy.mockRestore();
});

test('head() throwing BlobNotFoundError falls through to download without warning (normal cache miss)', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  head.mockRejectedValue(new BlobNotFoundError('not found'));
  const out = await loadProposal({ requestId: REQ });
  expect(downloadFileByPath).toHaveBeenCalled();
  expect(put).toHaveBeenCalled();
  expect(out.blobUrl).toBe('https://blob.example/x.pdf');
  expect(warnSpy).not.toHaveBeenCalled();
  warnSpy.mockRestore();
});

test('explicit fileKey override still permits deliberate historical analysis', async () => {
  listFiles.mockResolvedValue([
    file('Proposal_1002836.pdf'),
    file('ProjectDescription.pdf', { folder: 'F/Phase I' }),
  ]);
  const key = 'akoya_request::F/Phase I::ProjectDescription.pdf';
  const out = await loadProposal({ requestId: REQ, fileKey: key });
  expect(out.picked).toBe(key);
});

test('multiple active canonical matches fail closed before download or Blob upload', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'F1', source: 'dynamics' },
    { library: 'akoya_request', folder: 'F2', source: 'dynamics' },
  ]);
  listFiles.mockImplementation(async (_library, folder) => [
    file('Proposal_1002836.pdf', { folder: `${folder}/Reviewer Materials` }),
  ]);

  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body.error).toBe(
    'Multiple active canonical reviewer proposals were found for request 1002836.',
  );
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test('multiple active Phase I fallbacks fail closed before download or Blob upload', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    { library: 'akoya_request', folder: 'F1', source: 'dynamics' },
    { library: 'akoya_request', folder: 'F2', source: 'dynamics' },
  ]);
  listFiles.mockImplementation(async (_library, folder) => [
    file('ProjectDescription.pdf', { folder: `${folder}/Phase I` }),
  ]);

  const err = await loadProposal({ requestId: REQ }).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body.error).toBe(
    'Multiple active Phase I/ProjectDescription.pdf fallback proposals were found for request 1002836.',
  );
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

test('untyped failures (e.g. Blob upload) propagate for the shell 500 mapping', async () => {
  listFiles.mockResolvedValue([file('Proposal_1002836.pdf')]);
  put.mockRejectedValue(new Error('blob quota'));
  await expect(loadProposal({ requestId: REQ })).rejects.toThrow('blob quota');
});
