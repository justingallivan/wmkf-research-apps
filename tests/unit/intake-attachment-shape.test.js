/**
 * intake-attachment-shape.test.js
 *
 * The validator runs at both submit-entry (422 to applicant) and
 * drain-entry (terminal validation_400 + system_alerts). Both paths
 * delegate here, so this is the single contract test.
 */

const { validateAttachmentShape, validateAttachmentSet } = require('../../lib/utils/intake-attachment-shape.js');

const validAttachment = {
  filename: 'budget.xlsx',
  blob_url: 'https://blob.vercel-storage.com/intake-applicant-private/abc.xlsx',
  pathname: 'intake/draft-42/abc-budget.xlsx',
  sha256: 'a'.repeat(64),
  size: 12345,
  scan_result: 'clean',
  uploaded_at: '2026-05-23T12:00:00Z', // extra field — not required
};

describe('validateAttachmentShape — happy path', () => {
  test('valid attachment passes', () => {
    expect(() => validateAttachmentShape(validAttachment, 0)).not.toThrow();
  });
  test('scan_result=infected still shape-valid (clean check is separate)', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, scan_result: 'infected' }, 0))
      .not.toThrow();
  });
  test('scan_result=error still shape-valid', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, scan_result: 'error' }, 0))
      .not.toThrow();
  });
});

describe('validateAttachmentShape — missing required fields', () => {
  for (const key of ['filename', 'blob_url', 'pathname', 'sha256', 'size', 'scan_result']) {
    test(`missing ${key} throws`, () => {
      const att = { ...validAttachment };
      delete att[key];
      expect(() => validateAttachmentShape(att, 3))
        .toThrow(new RegExp(`attachment\\[3\\] shape: missing ${key}`));
    });
    test(`null ${key} throws`, () => {
      expect(() => validateAttachmentShape({ ...validAttachment, [key]: null }, 0))
        .toThrow(`missing ${key}`);
    });
  }
});

describe('validateAttachmentShape — type / format checks', () => {
  test('sha256 wrong length → throws', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, sha256: 'abc' }, 0))
      .toThrow('sha256 not 64-hex');
  });
  test('sha256 non-hex chars → throws', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, sha256: 'z'.repeat(64) }, 0))
      .toThrow('sha256 not 64-hex');
  });
  test('size = 0 → throws', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, size: 0 }, 0))
      .toThrow('size not positive number');
  });
  test('size negative → throws', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, size: -1 }, 0))
      .toThrow('size not positive number');
  });
  test('size as string → throws', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, size: '123' }, 0))
      .toThrow('size not positive number');
  });
  test('invalid scan_result enum → throws', () => {
    expect(() => validateAttachmentShape({ ...validAttachment, scan_result: 'pending' }, 0))
      .toThrow('invalid scan_result=pending');
  });
});

describe('validateAttachmentSet — filename uniqueness (Codex round-13 Q5)', () => {
  const a = { ...validAttachment, filename: 'budget.xlsx', sha256: 'a'.repeat(64) };
  const b = { ...validAttachment, filename: 'biosketch.pdf', sha256: 'b'.repeat(64) };
  test('empty set passes', () => {
    expect(() => validateAttachmentSet([])).not.toThrow();
  });
  test('unique filenames pass', () => {
    expect(() => validateAttachmentSet([a, b])).not.toThrow();
  });
  test('duplicate filenames + same sha → throws (would silently dedupe in SharePoint)', () => {
    expect(() => validateAttachmentSet([a, { ...a }]))
      .toThrow(/duplicate filename "budget\.xlsx"/);
  });
  test('duplicate filenames + DIFFERENT sha → throws (would overwrite in SharePoint)', () => {
    const c = { ...a, sha256: 'c'.repeat(64) };
    expect(() => validateAttachmentSet([a, c]))
      .toThrow(/duplicate filename "budget\.xlsx"/);
  });
  test('error message pinpoints both indices', () => {
    try {
      validateAttachmentSet([a, b, { ...a }]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).toMatch(/at index 2 \(also at index 0\)/);
    }
  });
  test('null filename skipped (per-row validator owns that error)', () => {
    expect(() => validateAttachmentSet([{ filename: null }, { filename: null }])).not.toThrow();
  });
  test('non-array throws', () => {
    expect(() => validateAttachmentSet('not-an-array')).toThrow('not an array');
  });
});

describe('validateAttachmentShape — defensive inputs', () => {
  test('null att throws (missing filename)', () => {
    expect(() => validateAttachmentShape(null, 0)).toThrow('missing filename');
  });
  test('undefined att throws', () => {
    expect(() => validateAttachmentShape(undefined, 0)).toThrow('missing filename');
  });
});
