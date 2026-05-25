/**
 * Tests for chunk-2 utilities in the intake-portal attach build:
 *   - lib/utils/file-magic.js → validateIntakeAttachment
 *   - lib/utils/blob-filename.js → sanitizeBlobFilename
 *   - lib/utils/intake-blob.js → getIntakeBlobToken
 *
 * Spec: docs/INTAKE_ATTACH_BUILD_SCOPING.md § 4 (chunk 2) + §§ Q2, Q3, A4, A5.
 *
 * @jest-environment node
 */

import { validateIntakeAttachment } from '../../lib/utils/file-magic.js';
import { sanitizeBlobFilename } from '../../lib/utils/blob-filename.js';
import { getIntakeBlobToken } from '../../lib/utils/intake-blob.js';

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const TXT_BYTES = Buffer.from('hello world', 'utf-8');

const MIME_PDF = 'application/pdf';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('validateIntakeAttachment', () => {
  test('accepts PDF when field allows PDF', () => {
    expect(validateIntakeAttachment('proposal.pdf', PDF_BYTES, [MIME_PDF])).toEqual({
      ok: true,
      type: 'pdf',
    });
  });

  test('accepts DOCX when field allows DOCX', () => {
    expect(validateIntakeAttachment('budget.docx', ZIP_BYTES, [MIME_DOCX])).toEqual({
      ok: true,
      type: 'docx',
    });
  });

  test('accepts XLSX when field allows XLSX (shared ZIP magic with DOCX)', () => {
    expect(validateIntakeAttachment('budget.xlsx', ZIP_BYTES, [MIME_XLSX])).toEqual({
      ok: true,
      type: 'xlsx',
    });
  });

  test('rejects PDF declared as DOCX (extension/magic mismatch)', () => {
    const res = validateIntakeAttachment('proposal.docx', PDF_BYTES, [MIME_DOCX]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/DOCX/i);
  });

  test('rejects ZIP declared as PDF (extension/magic mismatch)', () => {
    const res = validateIntakeAttachment('budget.pdf', ZIP_BYTES, [MIME_PDF]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/PDF/i);
  });

  test('rejects extension not in field accept[] (e.g. DOCX on a PDF-only field)', () => {
    const res = validateIntakeAttachment('budget.docx', ZIP_BYTES, [MIME_PDF]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/not permitted/i);
  });

  test('rejects unsupported extension', () => {
    const res = validateIntakeAttachment('proposal.txt', TXT_BYTES, [MIME_PDF, MIME_DOCX]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unsupported extension/i);
  });

  test('rejects empty filename', () => {
    const res = validateIntakeAttachment('', PDF_BYTES, [MIME_PDF]);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/filename required/);
  });

  test('rejects empty allowedMimeTypes', () => {
    const res = validateIntakeAttachment('proposal.pdf', PDF_BYTES, []);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/non-empty array/);
  });

  test('rejects allowedMimeTypes with only unsupported MIMEs', () => {
    const res = validateIntakeAttachment('proposal.pdf', PDF_BYTES, ['text/plain']);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no supported MIME types/);
  });

  test('extension match is case-insensitive (.PDF accepted)', () => {
    expect(validateIntakeAttachment('PROPOSAL.PDF', PDF_BYTES, [MIME_PDF])).toEqual({
      ok: true,
      type: 'pdf',
    });
  });
});

describe('sanitizeBlobFilename', () => {
  test('passes a plain ascii filename unchanged', () => {
    expect(sanitizeBlobFilename('proposal.pdf')).toBe('proposal.pdf');
  });

  test('strips control characters', () => {
    expect(sanitizeBlobFilename('pro\x00po\x01sal\x7f.pdf')).toBe('proposal.pdf');
  });

  test('strips path separators (/) and (\\\\)', () => {
    expect(sanitizeBlobFilename('a/b\\c.pdf')).toBe('abc.pdf');
  });

  test('rejects a bare `..`', () => {
    expect(() => sanitizeBlobFilename('..')).toThrow(/\.\./);
  });

  test('rejects embedded `..` segments', () => {
    expect(() => sanitizeBlobFilename('foo/../bar.pdf')).toThrow(/\.\./);
  });

  test('rejects fullwidth `．．` (NFKC-normalizes to `..`)', () => {
    expect(() => sanitizeBlobFilename('．．/etc/passwd')).toThrow(/\.\./);
  });

  test('strips leading dots (hidden-file convention)', () => {
    expect(sanitizeBlobFilename('.htaccess')).toBe('htaccess');
  });

  test('trims whitespace', () => {
    expect(sanitizeBlobFilename('  proposal.pdf  ')).toBe('proposal.pdf');
  });

  test('throws on empty input', () => {
    expect(() => sanitizeBlobFilename('')).toThrow(/non-empty/);
  });

  test('throws on empty post-sanitization (all-control-char input)', () => {
    expect(() => sanitizeBlobFilename('\x00\x01\x02')).toThrow(/empty/);
  });

  test('throws on non-string input', () => {
    expect(() => sanitizeBlobFilename(null)).toThrow(/string/);
    expect(() => sanitizeBlobFilename(42)).toThrow(/string/);
    expect(() => sanitizeBlobFilename({})).toThrow(/string/);
  });

  test('truncates to 200 chars preserving extension', () => {
    const long = 'a'.repeat(300) + '.pdf';
    const result = sanitizeBlobFilename(long);
    expect(result.length).toBe(200);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  test('truncates to 200 chars with no extension if absent', () => {
    const long = 'a'.repeat(300);
    const result = sanitizeBlobFilename(long);
    expect(result.length).toBe(200);
    expect(result).toBe('a'.repeat(200));
  });

  test('NFKC normalization collapses compatibility forms', () => {
    // Fullwidth `ｆｉｌｅ.pdf` normalizes to `file.pdf`
    expect(sanitizeBlobFilename('ｆｉｌｅ.pdf')).toBe('file.pdf');
  });
});

describe('getIntakeBlobToken', () => {
  const ORIGINAL_TOKEN = process.env.INTAKE_BLOB_RW_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.INTAKE_BLOB_RW_TOKEN;
    } else {
      process.env.INTAKE_BLOB_RW_TOKEN = ORIGINAL_TOKEN;
    }
  });

  test('returns the env value when set', () => {
    process.env.INTAKE_BLOB_RW_TOKEN = 'vercel_blob_rw_test_token_value';
    expect(getIntakeBlobToken()).toBe('vercel_blob_rw_test_token_value');
  });

  test('throws fail-loud when unset', () => {
    delete process.env.INTAKE_BLOB_RW_TOKEN;
    expect(() => getIntakeBlobToken()).toThrow(/not configured/);
  });

  test('throws fail-loud when empty string', () => {
    process.env.INTAKE_BLOB_RW_TOKEN = '';
    expect(() => getIntakeBlobToken()).toThrow(/not configured/);
  });
});
