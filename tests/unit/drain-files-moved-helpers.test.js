/**
 * drain-files-moved-helpers.test.js
 *
 * Covers the pure helpers wired into the files_moved state handler. They
 * live in lib/utils/drain-files-moved-helpers.js (extracted so jest's
 * jsdom env can load them — the route module pulls in pg which needs
 * TextEncoder).
 */

const {
  isAlreadyWritten,
  requestFolderName,
  guessContentType,
} = require('../../lib/utils/drain-files-moved-helpers.js');

describe('requestFolderName — review-upload convention', () => {
  test('happy path: capitalizes and strips hyphens from GUID', () => {
    const folder = requestFolderName('REQ-12345', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(folder).toBe('REQ-12345_AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE');
  });
  test('mixed-case GUID normalized to upper', () => {
    const folder = requestFolderName('R1', 'Ab12CdEf-3456-7890-abcd-ef1234567890');
    expect(folder).toBe('R1_AB12CDEF34567890ABCDEF1234567890');
  });
});

describe('isAlreadyWritten — sharepoint_paths skip logic', () => {
  const att = { filename: 'budget.xlsx', sha256: 'a'.repeat(64) };

  test('empty/null sharepoint_paths → false', () => {
    expect(isAlreadyWritten([], att)).toBe(false);
    expect(isAlreadyWritten(null, att)).toBe(false);
    expect(isAlreadyWritten(undefined, att)).toBe(false);
  });
  test('match on filename + sha256 → true', () => {
    expect(isAlreadyWritten(
      [{ filename: 'budget.xlsx', sha256: 'a'.repeat(64) }],
      att,
    )).toBe(true);
  });
  test('same filename, different sha256 → false (different artifact)', () => {
    expect(isAlreadyWritten(
      [{ filename: 'budget.xlsx', sha256: 'b'.repeat(64) }],
      att,
    )).toBe(false);
  });
  test('different filename, same sha256 → false (different upload slot)', () => {
    expect(isAlreadyWritten(
      [{ filename: 'other.xlsx', sha256: 'a'.repeat(64) }],
      att,
    )).toBe(false);
  });
  test('array with malformed entry skipped safely', () => {
    expect(isAlreadyWritten(
      [null, { filename: 'budget.xlsx', sha256: 'a'.repeat(64) }],
      att,
    )).toBe(true);
  });
});

describe('guessContentType — fallback content-type mapping', () => {
  test.each([
    ['budget.pdf', 'application/pdf'],
    ['biosketch.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['roster.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['scan.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],   // case-insensitive
    ['readme.txt', 'text/plain'],
    ['mystery.bin', 'application/octet-stream'], // unknown
    ['noext', 'application/octet-stream'],
  ])('%s → %s', (filename, expected) => {
    expect(guessContentType(filename)).toBe(expected);
  });
});
