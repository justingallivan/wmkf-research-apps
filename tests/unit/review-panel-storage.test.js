/**
 * @jest-environment node
 */

jest.mock('@vercel/blob', () => ({
  get: jest.fn(),
  put: jest.fn(),
}));
jest.mock('../../lib/services/review-panel-store', () => ({
  reviewPanelError: (message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus }),
}));

const { get, put } = require('@vercel/blob');
const {
  assertReviewPanelStorageConfigured,
  reviewPanelDigest,
  readReviewPanelFile,
  storeReviewPanelFile,
} = require('../../lib/services/review-panel-storage.js');

const TOKEN = 'review-panel-private-token-fixture';
const PATHNAME = 'review-panel/run-1/entry.docx';
const MAX_BYTES = 30 * 1024 * 1024;

function streamResponse(chunks) {
  let index = 0;
  const reader = {
    read: jest.fn(async () => {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: Uint8Array.from(chunks[index++]) };
    }),
    releaseLock: jest.fn(),
    cancel: jest.fn(),
  };
  return { stream: { getReader: () => reader }, reader };
}

function refFor(bytes, overrides = {}) {
  return { pathname: PATHNAME, sha256: reviewPanelDigest(bytes), size: bytes.length, contentType: 'application/octet-stream', ...overrides };
}

beforeEach(() => {
  process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN = TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.DOSSIER_BLOB_READ_WRITE_TOKEN;
  get.mockReset();
  put.mockReset();
});

afterEach(() => {
  delete process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN;
});

describe('Review Panel private storage configuration', () => {
  it('fails closed with a 503 and plain copy when the dedicated token is absent', async () => {
    delete process.env.REVIEW_PANEL_BLOB_READ_WRITE_TOKEN;
    expect(() => assertReviewPanelStorageConfigured()).toThrow(/private review panel document store has not been configured/i);
    await expect(readReviewPanelFile(refFor(Buffer.from('bytes')))).rejects.toMatchObject({ httpStatus: 503 });
    await expect(storeReviewPanelFile(PATHNAME, Buffer.from('bytes'), 'application/octet-stream')).rejects.toMatchObject({ httpStatus: 503 });
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('uses the dedicated REVIEW_PANEL_BLOB_READ_WRITE_TOKEN, never BLOB_READ_WRITE_TOKEN or DOSSIER_BLOB_READ_WRITE_TOKEN', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'shared-token-fixture-must-not-be-used';
    process.env.DOSSIER_BLOB_READ_WRITE_TOKEN = 'dossier-token-fixture-must-not-be-used';
    const bytes = Buffer.from('panel bytes');
    put.mockResolvedValue({ pathname: PATHNAME });
    await storeReviewPanelFile(PATHNAME, bytes, 'application/octet-stream');
    expect(put).toHaveBeenCalledWith(PATHNAME, bytes, expect.objectContaining({ token: TOKEN }));
  });
});

describe('Review Panel private reads', () => {
  it('reads bounded private bytes with the dedicated token and verifies digest and size', async () => {
    const bytes = Buffer.from('scientific panel bytes');
    get.mockResolvedValue(streamResponse([bytes.subarray(0, 10), bytes.subarray(10)]));
    await expect(readReviewPanelFile(refFor(bytes))).resolves.toEqual(bytes);
    expect(get).toHaveBeenCalledWith(PATHNAME, { access: 'private', token: TOKEN, useCache: false });
  });

  it('rejects a downloaded artifact when its digest or declared size differs', async () => {
    const bytes = Buffer.from('stored bytes');
    get.mockResolvedValueOnce(streamResponse([bytes]));
    await expect(readReviewPanelFile(refFor(bytes, { sha256: 'a'.repeat(64) }))).rejects.toThrow(/integrity check/i);
  });

  it('cancels and rejects a private download that exceeds the byte bound', async () => {
    const reader = {
      read: jest.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_BYTES + 1) }).mockResolvedValue({ done: true, value: undefined }),
      releaseLock: jest.fn(), cancel: jest.fn(),
    };
    get.mockResolvedValue({ stream: { getReader: () => reader } });
    await expect(readReviewPanelFile(refFor(Buffer.from('unused')))).rejects.toThrow(/download limit/i);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('Review Panel create-only writes', () => {
  it('recovers a lost put response only when the exact bytes are already present', async () => {
    const bytes = Buffer.from('recoverable artifact');
    const ref = refFor(bytes);
    put.mockRejectedValueOnce(new Error('response lost after write'));
    get.mockResolvedValueOnce(streamResponse([bytes]));
    await expect(storeReviewPanelFile(PATHNAME, bytes, ref.contentType)).resolves.toEqual(ref);
  });

  it('propagates the original put error when recovery bytes do not match', async () => {
    const bytes = Buffer.from('intended artifact');
    put.mockRejectedValueOnce(new Error('create-only conflict'));
    get.mockResolvedValueOnce(streamResponse([Buffer.from('different artifact')]));
    await expect(storeReviewPanelFile(PATHNAME, bytes, 'application/octet-stream')).rejects.toThrow('create-only conflict');
  });
});

describe('Review Panel artifact reference validation', () => {
  it('rejects malformed or non-review-panel pathnames before Blob access', async () => {
    const bytes = Buffer.from('bytes');
    const valid = refFor(bytes);
    await expect(readReviewPanelFile({ ...valid, pathname: 'uploads/secret.docx' })).rejects.toThrow(/invalid saved artifact reference/i);
    await expect(readReviewPanelFile({ ...valid, pathname: 'review-panel/../secret.docx' })).rejects.toThrow(/invalid saved artifact reference/i);
    await expect(storeReviewPanelFile('uploads/secret.docx', bytes, 'application/octet-stream')).rejects.toThrow(/invalid review panel artifact/i);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
