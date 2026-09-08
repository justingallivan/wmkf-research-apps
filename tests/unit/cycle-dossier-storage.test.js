/**
 * @jest-environment node
 */

jest.mock('@vercel/blob', () => ({
  get: jest.fn(),
  put: jest.fn(),
}));
jest.mock('../../lib/services/cycle-dossier-store', () => ({
  dossierError: (message, httpStatus = 409) => Object.assign(new Error(message), { httpStatus }),
}));

const { get, put } = require('@vercel/blob');
const {
  assertDossierStorageConfigured,
  dossierDigest,
  readDossierFile,
  storeDossierFile,
} = require('../../lib/services/cycle-dossier-storage.js');

const TOKEN = 'dossier-private-token-fixture';
const PATHNAME = 'cycle-dossier/run-1/entry.docx';
const MAX_DOSSIER_BYTES = 30 * 1024 * 1024;

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
  return {
    pathname: PATHNAME,
    sha256: dossierDigest(bytes),
    size: bytes.length,
    contentType: 'application/octet-stream',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.DOSSIER_BLOB_READ_WRITE_TOKEN = TOKEN;
  get.mockReset();
  put.mockReset();
});

afterEach(() => {
  delete process.env.DOSSIER_BLOB_READ_WRITE_TOKEN;
});

describe('Cycle Dossier private storage configuration', () => {
  it('fails closed before accessing Blob when the dedicated token is absent', async () => {
    delete process.env.DOSSIER_BLOB_READ_WRITE_TOKEN;

    expect(() => assertDossierStorageConfigured()).toThrow(/private dossier store has not been configured/i);
    await expect(readDossierFile(refFor(Buffer.from('bytes')))).rejects.toThrow(/private dossier store has not been configured/i);
    await expect(storeDossierFile(PATHNAME, Buffer.from('bytes'), 'application/octet-stream'))
      .rejects.toThrow(/private dossier store has not been configured/i);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('Cycle Dossier private reads', () => {
  it('reads bounded private bytes with the dedicated token and verifies digest and size', async () => {
    const bytes = Buffer.from('scientific dossier bytes');
    const response = streamResponse([bytes.subarray(0, 10), bytes.subarray(10)]);
    get.mockResolvedValue(response);

    await expect(readDossierFile(refFor(bytes))).resolves.toEqual(bytes);
    expect(get).toHaveBeenCalledWith(PATHNAME, {
      access: 'private', token: TOKEN, useCache: false,
    });
    expect(response.reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('rejects a downloaded artifact when its digest or declared size differs', async () => {
    const bytes = Buffer.from('stored bytes');
    get.mockResolvedValueOnce(streamResponse([bytes]));
    await expect(readDossierFile(refFor(bytes, { sha256: 'a'.repeat(64) })))
      .rejects.toThrow(/integrity check/i);

    get.mockResolvedValueOnce(streamResponse([bytes]));
    await expect(readDossierFile(refFor(bytes, { size: bytes.length + 1 })))
      .rejects.toThrow(/integrity check/i);
  });

  it('cancels and rejects a private download that exceeds the byte bound', async () => {
    const reader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(MAX_DOSSIER_BYTES + 1) })
        .mockResolvedValue({ done: true, value: undefined }),
      releaseLock: jest.fn(),
      cancel: jest.fn(),
    };
    get.mockResolvedValue({ stream: { getReader: () => reader } });

    await expect(readDossierFile(refFor(Buffer.from('unused')))).rejects.toThrow(/download limit/i);
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });
});

describe('Cycle Dossier create-only writes', () => {
  it('recovers a lost put response only when the exact bytes are already present', async () => {
    const bytes = Buffer.from('recoverable artifact');
    const ref = refFor(bytes);
    put.mockRejectedValueOnce(new Error('response lost after write'));
    get.mockResolvedValueOnce(streamResponse([bytes]));

    await expect(storeDossierFile(PATHNAME, bytes, ref.contentType)).resolves.toEqual(ref);
    expect(put).toHaveBeenCalledWith(PATHNAME, bytes, expect.objectContaining({
      access: 'private', token: TOKEN, addRandomSuffix: false, allowOverwrite: false,
    }));
    expect(get).toHaveBeenCalledWith(PATHNAME, {
      access: 'private', token: TOKEN, useCache: false,
    });
  });

  it('propagates the original put error when recovery bytes do not match', async () => {
    const bytes = Buffer.from('intended artifact');
    put.mockRejectedValueOnce(new Error('create-only conflict'));
    get.mockResolvedValueOnce(streamResponse([Buffer.from('different artifact')]));

    await expect(storeDossierFile(PATHNAME, bytes, 'application/octet-stream'))
      .rejects.toThrow('create-only conflict');
  });
});

describe('Cycle Dossier artifact reference validation', () => {
  it('rejects malformed or non-dossier pathnames before Blob access', async () => {
    const bytes = Buffer.from('bytes');
    const valid = refFor(bytes);

    await expect(readDossierFile({ ...valid, pathname: 'uploads/secret.docx' }))
      .rejects.toThrow(/invalid saved artifact reference/i);
    await expect(readDossierFile({ ...valid, pathname: 'cycle-dossier/../secret.docx' }))
      .rejects.toThrow(/invalid saved artifact reference/i);
    await expect(storeDossierFile('uploads/secret.docx', bytes, 'application/octet-stream'))
      .rejects.toThrow(/invalid dossier artifact/i);
    await expect(storeDossierFile('cycle-dossier/../secret.docx', bytes, 'application/octet-stream'))
      .rejects.toThrow(/invalid dossier artifact/i);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects references with malformed digests before Blob access', async () => {
    const bytes = Buffer.from('bytes');
    await expect(readDossierFile(refFor(bytes, { sha256: 'not-a-sha256' })))
      .rejects.toThrow(/invalid saved artifact reference/i);
    expect(get).not.toHaveBeenCalled();
  });
});
