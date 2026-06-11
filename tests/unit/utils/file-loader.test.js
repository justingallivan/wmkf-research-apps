/**
 * @jest-environment node
 *
 * Unit tests for the upload branch of lib/utils/file-loader.js after the
 * Phase 1 private-blob change: the read now delegates to readUploadedBlobBuffer
 * (private pathname read or legacy public URL), with HTTP-tagged errors.
 */

jest.mock('pdf-parse', () => jest.fn());
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));
jest.mock('../../../lib/services/graph-service', () => ({ GraphService: { downloadFileByPath: jest.fn() } }));
jest.mock('../../../lib/utils/uploaded-blob', () => ({ readUploadedBlobBuffer: jest.fn() }));

import pdf from 'pdf-parse';
import { readUploadedBlobBuffer } from '../../../lib/utils/uploaded-blob';
import { loadFile } from '../../../lib/utils/file-loader';

beforeEach(() => {
  readUploadedBlobBuffer.mockReset();
  pdf.mockReset();
  // Default: extraction returns enough text to clear loadFile's >100-char gate.
  pdf.mockResolvedValue({ text: 'X'.repeat(300) });
});

describe('loadFile — upload source (Phase 1 private-aware)', () => {
  test('private ref reads via readUploadedBlobBuffer with access+pathname', async () => {
    readUploadedBlobBuffer.mockResolvedValue(Buffer.from('pdf-bytes'));

    const out = await loadFile({
      source: 'upload',
      access: 'private',
      pathname: 'private/expense/x.pdf',
      fileUrl: 'https://x.public.blob.vercel-storage.com/x.pdf',
      filename: 'x.pdf',
    });

    expect(readUploadedBlobBuffer).toHaveBeenCalledWith({
      access: 'private',
      pathname: 'private/expense/x.pdf',
      url: 'https://x.public.blob.vercel-storage.com/x.pdf',
    });
    expect(out.text.length).toBeGreaterThan(100);
    expect(out.filename).toBe('x.pdf');
  });

  test('legacy public ref (only fileUrl, no access) still works — back-compat', async () => {
    readUploadedBlobBuffer.mockResolvedValue(Buffer.from('pdf-bytes'));

    await loadFile({
      source: 'upload',
      fileUrl: 'https://x.public.blob.vercel-storage.com/y.pdf',
      filename: 'y.pdf',
    });

    expect(readUploadedBlobBuffer).toHaveBeenCalledWith({
      access: undefined,
      pathname: undefined,
      url: 'https://x.public.blob.vercel-storage.com/y.pdf',
    });
  });

  test('missing filename → 400', async () => {
    await expect(loadFile({ source: 'upload', fileUrl: 'u' })).rejects.toMatchObject({ status: 400 });
    expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
  });

  test('neither fileUrl nor pathname → 400', async () => {
    await expect(loadFile({ source: 'upload', filename: 'x.pdf' })).rejects.toMatchObject({ status: 400 });
    expect(readUploadedBlobBuffer).not.toHaveBeenCalled();
  });

  test('missing private-store token → 503 (fail closed, not a client error)', async () => {
    readUploadedBlobBuffer.mockRejectedValue(
      new Error('readUploadedBlobBuffer: UPLOADS_BLOB_RW_TOKEN is not set — cannot read private uploads'),
    );
    await expect(
      loadFile({ source: 'upload', access: 'private', pathname: 'p', filename: 'x.pdf' }),
    ).rejects.toMatchObject({ status: 503 });
  });

  test('other read failure (e.g. not found) → 400', async () => {
    readUploadedBlobBuffer.mockRejectedValue(new Error('private blob not found: p'));
    await expect(
      loadFile({ source: 'upload', access: 'private', pathname: 'p', filename: 'x.pdf' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
