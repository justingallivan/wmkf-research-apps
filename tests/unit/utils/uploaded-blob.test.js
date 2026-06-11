/**
 * @jest-environment node
 *
 * Unit tests for the Phase 1 private-blob read helper. Node env so the global
 * Web `Response`/`ReadableStream` (used to collect the private-blob stream) and
 * `TextEncoder` are present.
 */

jest.mock('@vercel/blob', () => ({ get: jest.fn() }));
jest.mock('../../../lib/utils/safe-fetch', () => ({ safeFetch: jest.fn() }));

import { get as getBlob } from '@vercel/blob';
import { safeFetch } from '../../../lib/utils/safe-fetch';
import { readUploadedBlobBuffer } from '../../../lib/utils/uploaded-blob';

const ORIGINAL_TOKEN = process.env.UPLOADS_BLOB_RW_TOKEN;
beforeEach(() => {
  getBlob.mockReset();
  safeFetch.mockReset();
  process.env.UPLOADS_BLOB_RW_TOKEN = 'vercel_blob_rw_test';
});
afterAll(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.UPLOADS_BLOB_RW_TOKEN;
  else process.env.UPLOADS_BLOB_RW_TOKEN = ORIGINAL_TOKEN;
});

describe('readUploadedBlobBuffer', () => {
  test('private reference reads server-side via get(pathname, {access:private})', async () => {
    getBlob.mockResolvedValue({ stream: new Response(new Uint8Array([1, 2, 3])).body });

    const buf = await readUploadedBlobBuffer({ access: 'private', pathname: 'private/expense-reporter/r.pdf' });

    expect(getBlob).toHaveBeenCalledWith('private/expense-reporter/r.pdf', {
      access: 'private',
      token: 'vercel_blob_rw_test',
    });
    expect(safeFetch).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([1, 2, 3]);
  });

  test('private read fails closed when UPLOADS_BLOB_RW_TOKEN is unset (no public-store fallback)', async () => {
    delete process.env.UPLOADS_BLOB_RW_TOKEN;
    await expect(
      readUploadedBlobBuffer({ access: 'private', pathname: 'private/expense-reporter/r.pdf' }),
    ).rejects.toThrow('UPLOADS_BLOB_RW_TOKEN is not set');
    expect(getBlob).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  test('legacy/public reference (no access) fetches the public url via safeFetch', async () => {
    safeFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer });

    const buf = await readUploadedBlobBuffer({ url: 'https://x.public.blob.vercel-storage.com/r.pdf', filename: 'r.pdf' });

    expect(safeFetch).toHaveBeenCalledWith('https://x.public.blob.vercel-storage.com/r.pdf');
    expect(getBlob).not.toHaveBeenCalled();
    expect([...buf]).toEqual([4, 5, 6]);
  });

  test('explicit public access also uses safeFetch (not get)', async () => {
    safeFetch.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([7]).buffer });
    await readUploadedBlobBuffer({ access: 'public', url: 'https://x.public.blob.vercel-storage.com/a.png', pathname: 'a.png' });
    expect(safeFetch).toHaveBeenCalled();
    expect(getBlob).not.toHaveBeenCalled();
  });

  test('private without pathname throws', async () => {
    await expect(readUploadedBlobBuffer({ access: 'private' })).rejects.toThrow('requires a pathname');
    expect(getBlob).not.toHaveBeenCalled();
  });

  test('private blob not found throws', async () => {
    getBlob.mockResolvedValue(null);
    await expect(readUploadedBlobBuffer({ access: 'private', pathname: 'gone.pdf' })).rejects.toThrow('not found');
  });

  test('public without url throws', async () => {
    await expect(readUploadedBlobBuffer({})).rejects.toThrow('requires a url');
  });

  test('public fetch non-ok throws', async () => {
    safeFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(readUploadedBlobBuffer({ url: 'https://x.public.blob.vercel-storage.com/missing.pdf' })).rejects.toThrow('failed to fetch');
  });

  test('non-object reference throws', async () => {
    await expect(readUploadedBlobBuffer(null)).rejects.toThrow('file reference object is required');
  });
});
