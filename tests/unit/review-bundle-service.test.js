/**
 * Review bundle assembly (plan §11, Step C1/C2/C-followups).
 *
 * @jest-environment node
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import crypto from 'node:crypto';
import {
  assembleReviewBundle,
  reviewSetFingerprint,
  sanitizeForWinAnsi,
  MAX_REVIEW_COUNT,
  MAX_SOURCE_BYTES,
  MAX_OUTPUT_BYTES,
} from '../../lib/services/pre-site-visit/review-bundle-service.js';

async function onePagePdf(label = 'part') {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(label, { x: 10, y: 10, size: 10 });
  return Buffer.from(await doc.save());
}

async function twoPagePdf(label = 'part') {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]).drawText(`${label}-1`, { x: 10, y: 10, size: 10 });
  doc.addPage([200, 200]).drawText(`${label}-2`, { x: 10, y: 10, size: 10 });
  return Buffer.from(await doc.save());
}

/**
 * A PDF whose saved size is just over `totalMB` megabytes: a few pages whose
 * content streams are raw random (incompressible) bytes, so the size survives
 * pdf-lib's save and `copyPages`. Used only to prove the MAX_OUTPUT_BYTES
 * bound is enforced on a real assembled document.
 */
async function oversizedPdf(totalMB, perPageMB = 5) {
  const doc = await PDFDocument.create();
  const pages = Math.ceil(totalMB / perPageMB);
  for (let p = 0; p < pages; p += 1) {
    // Random bytes as the page's raw content stream: incompressible, copied
    // verbatim by `copyPages`, and built in milliseconds. Drawing the same
    // volume as text took ~12s per fixture and timed out the CI runner.
    const page = doc.addPage([200, 200]);
    const ref = doc.context.register(doc.context.stream(crypto.randomBytes(perPageMB * 1024 * 1024)));
    page.node.set(PDFName.of('Contents'), ref);
  }
  return Buffer.from(await doc.save());
}

function review(overrides = {}) {
  return {
    suggestionId: 'reviewer-1',
    reviewReceivedAt: '2026-09-01T00:00:00Z',
    name: 'Reviewer One',
    affiliation: 'Test University',
    reviewSharePointFolder: 'Requests/1002379/Reviewer_Uploads/attempt_1',
    reviewFilename: 'review-1.pdf',
    ...overrides,
  };
}

function metadataStub({ size = 1024 } = {}) {
  return jest.fn(async (folder, filename) => ({
    id: `${filename}-item`,
    driveId: `${filename}-drive`,
    size,
  }));
}

describe('reviewSetFingerprint', () => {
  test('is order-independent', () => {
    const a = [review({ suggestionId: 'aaa' }), review({ suggestionId: 'bbb' })];
    const b = [review({ suggestionId: 'bbb' }), review({ suggestionId: 'aaa' })];
    expect(reviewSetFingerprint(a)).toBe(reviewSetFingerprint(b));
  });

  test('changes when a filename, folder, or suggestionId changes', () => {
    const base = reviewSetFingerprint([review()]);
    expect(reviewSetFingerprint([review({ reviewFilename: 'other.pdf' })])).not.toBe(base);
    expect(reviewSetFingerprint([review({ reviewSharePointFolder: 'Requests/other' })])).not.toBe(base);
    expect(reviewSetFingerprint([review({ suggestionId: 'reviewer-2' })])).not.toBe(base);
  });

  test('changes when the reviewer name changes (rendered on the separator page)', () => {
    const base = reviewSetFingerprint([review()]);
    expect(reviewSetFingerprint([review({ name: 'Someone Else' })])).not.toBe(base);
  });

  test('changes when the affiliation changes (rendered on the separator page)', () => {
    const base = reviewSetFingerprint([review()]);
    expect(reviewSetFingerprint([review({ affiliation: 'Different University' })])).not.toBe(base);
  });

  test('changes when reviewerAffiliation changes even if affiliation is unchanged (reviewerAffiliationOf prefers it)', () => {
    const base = reviewSetFingerprint([review({ reviewerAffiliation: 'Accepted University' })]);
    expect(reviewSetFingerprint([review({ reviewerAffiliation: 'Different Accepted University' })])).not.toBe(base);
  });

  test('changes when the received date changes (rendered on the separator page)', () => {
    const base = reviewSetFingerprint([review()]);
    expect(reviewSetFingerprint([review({ reviewReceivedAt: '2026-09-15T00:00:00Z' })])).not.toBe(base);
  });

  test('name/affiliation normalization: trim and NFC-normalize before hashing, so equivalent representations do not create a spurious mismatch', () => {
    // 'é' as a single codepoint vs. 'e' + combining acute accent (NFC-equivalent).
    const nfc = reviewSetFingerprint([review({ name: 'Renée', affiliation: '  Test University  ' })]);
    const decomposed = reviewSetFingerprint([review({ name: 'Renée', affiliation: 'Test University' })]);
    expect(nfc).toBe(decomposed);
  });

  test('ignores review fields the separator pages do not render', () => {
    const base = reviewSetFingerprint([review()]);
    const changedEverythingElse = reviewSetFingerprint([review({
      mainInstitution: 'Different University',
      academicRank: 'Associate Professor',
      reviewerOverallAssessment: 'Weak',
    })]);
    expect(changedEverythingElse).toBe(base);
  });

  test('excludes non-received reviews from the fingerprint', () => {
    const withPending = reviewSetFingerprint([review(), review({ suggestionId: 'pending', reviewReceivedAt: null })]);
    expect(withPending).toBe(reviewSetFingerprint([review()]));
  });
});

describe('sanitizeForWinAnsi', () => {
  test('replaces non-Latin-1 characters with "?", leaving WinAnsi-representable text intact', () => {
    expect(sanitizeForWinAnsi('李明')).toBe('??');
    expect(sanitizeForWinAnsi('Jane Doe')).toBe('Jane Doe');
  });

  test('replaces a combining character (outside Latin-1) with "?"', () => {
    // 'e' + combining acute accent (U+0301) — the base 'e' survives, the
    // combining mark (codepoint > 0xFF) is replaced.
    expect(sanitizeForWinAnsi('Renée')).toBe('Rene?e');
  });

  test('handles a long (300-char) affiliation without throwing, preserving length', () => {
    const long = '李'.repeat(300);
    const sanitized = sanitizeForWinAnsi(long);
    expect(sanitized).toHaveLength(300);
    expect(sanitized).toBe('?'.repeat(300));
  });

  test('handles null/undefined without throwing', () => {
    expect(sanitizeForWinAnsi(null)).toBe('');
    expect(sanitizeForWinAnsi(undefined)).toBe('');
  });
});

describe('assembleReviewBundle', () => {
  test('two PDF parts and one DOCX part: page count, order, converted flag, and title', async () => {
    const pdfPartA = await twoPagePdf('alpha');
    const pdfPartB = await onePagePdf('bravo');
    const docxPartPdf = await onePagePdf('charlie-converted');

    const reviews = [
      review({
        suggestionId: 'charlie',
        name: 'Charlie Reviewer',
        reviewFilename: 'review-charlie.docx',
      }),
      review({
        suggestionId: 'alpha',
        name: 'Alpha Reviewer',
        reviewFilename: 'review-alpha.pdf',
      }),
      review({
        suggestionId: 'bravo',
        name: 'Bravo Reviewer',
        reviewFilename: 'review-bravo.pdf',
      }),
    ];

    const downloadFileByPath = jest.fn(async (folder, filename) => {
      if (filename === 'review-alpha.pdf') return { buffer: pdfPartA };
      if (filename === 'review-bravo.pdf') return { buffer: pdfPartB };
      throw new Error(`unexpected downloadFileByPath(${filename})`);
    });
    const getFileMetadataByPath = jest.fn(async (folder, filename) => ({
      id: `${filename}-item`,
      driveId: `${filename}-drive`,
      size: 2048,
    }));
    const downloadFileAsPdf = jest.fn(async (driveId, itemId) => (
      driveId === 'review-charlie.docx-drive' && itemId === 'review-charlie.docx-item' ? docxPartPdf : null
    ));

    const result = await assembleReviewBundle({
      reviews,
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath, downloadFileAsPdf });

    // name order is Alpha, Bravo, Charlie (compareReviewersByName), each
    // preceded by a separator page: 1 + 2 (alpha) + 1 + 1 (bravo) + 1 + 1 (charlie) = 7
    const assembled = await PDFDocument.load(result.buffer);
    expect(assembled.getPageCount()).toBe(2 + 1 + 1 + 3);
    expect(assembled.getTitle()).toBe('Test Institution — Reviews');

    expect(result.parts.map((part) => part.suggestionId)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(result.parts.map((part) => part.converted)).toEqual([false, false, true]);
    expect(result.reviewCount).toBe(3);
    expect(result.skipped).toBeUndefined();
    expect(typeof result.byteHash).toBe('string');
    expect(result.byteHash).toMatch(/^[0-9a-f]{64}$/);

    // Metadata is fetched once per review (preflight), not re-fetched for
    // the DOCX conversion pass.
    expect(getFileMetadataByPath).toHaveBeenCalledTimes(3);
  });

  test('a %PDF- magic-byte failure throws review_bundle_part_invalid (502)', async () => {
    const downloadFileByPath = jest.fn(async () => ({ buffer: Buffer.from('not a pdf') }));
    const getFileMetadataByPath = metadataStub();
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_part_invalid',
      httpStatus: 502,
    });
  });

  test('a corrupt-but-magic-matching PDF part throws review_bundle_part_invalid (502)', async () => {
    const downloadFileByPath = jest.fn(async () => ({ buffer: Buffer.from('%PDF-not-really-a-pdf') }));
    const getFileMetadataByPath = metadataStub();
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_part_invalid',
      httpStatus: 502,
    });
  });

  test('a well-formed PDF missing the leading %PDF- signature is rejected by the magic-byte check even though pdf-lib would otherwise parse it (pdf-lib scans for the header past a leading byte)', async () => {
    const validPdf = await onePagePdf('shifted');
    const shifted = Buffer.concat([Buffer.from('X'), validPdf]);
    const downloadFileByPath = jest.fn(async () => ({ buffer: shifted }));
    const getFileMetadataByPath = metadataStub();
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_part_invalid',
      httpStatus: 502,
    });
  });

  test('a Graph rejection throws review_bundle_unavailable (502)', async () => {
    const downloadFileByPath = jest.fn(async () => { throw new Error('Graph is down'); });
    const getFileMetadataByPath = metadataStub();
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_unavailable',
      httpStatus: 502,
    });
  });

  test('a Graph metadata-lookup failure (preflight) throws review_bundle_unavailable (502)', async () => {
    const getFileMetadataByPath = jest.fn(async () => { throw new Error('Graph is down'); });
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_unavailable',
      httpStatus: 502,
    });
  });

  test('a Graph rejection converting a DOCX review throws review_bundle_unavailable (502)', async () => {
    const getFileMetadataByPath = jest.fn(async () => ({ id: 'item', driveId: 'drive', size: 1024 }));
    const downloadFileAsPdf = jest.fn(async () => { throw new Error('conversion failed'); });
    await expect(assembleReviewBundle({
      reviews: [review({ reviewFilename: 'review.docx' })],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { getFileMetadataByPath, downloadFileAsPdf })).rejects.toMatchObject({
      code: 'review_bundle_unavailable',
      httpStatus: 502,
    });
  });

  test('no received review at all throws review_bundle_empty (409)', async () => {
    await expect(assembleReviewBundle({
      reviews: [review({ reviewReceivedAt: null })],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, {})).rejects.toMatchObject({
      code: 'review_bundle_empty',
      httpStatus: 409,
    });
  });

  test('a received review without a retained file fails closed with review_bundle_incomplete (409) naming the reviewer', async () => {
    const withFilePdf = await onePagePdf('has-file');
    const downloadFileByPath = jest.fn(async () => ({ buffer: withFilePdf }));
    const getFileMetadataByPath = metadataStub();

    await expect(assembleReviewBundle({
      reviews: [
        review({ suggestionId: 'has-file' }),
        review({
          suggestionId: 'no-file',
          name: 'Nadia Filer',
          reviewSharePointFolder: null,
          reviewFilename: null,
        }),
      ],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_incomplete',
      httpStatus: 409,
      message: expect.stringContaining('Nadia Filer'),
    });

    // No downloads should have been attempted once any review is incomplete.
    expect(downloadFileByPath).not.toHaveBeenCalled();
  });

  test('multiple received reviews without a retained file are all named in the review_bundle_incomplete message', async () => {
    await expect(assembleReviewBundle({
      reviews: [
        review({ suggestionId: 'a', name: 'Ann Author', reviewSharePointFolder: null, reviewFilename: null }),
        review({ suggestionId: 'b', name: 'Bo Bishop', reviewSharePointFolder: null, reviewFilename: null }),
      ],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, {})).rejects.toMatchObject({
      code: 'review_bundle_incomplete',
      httpStatus: 409,
      message: expect.stringMatching(/Ann Author.*Bo Bishop|Bo Bishop.*Ann Author/),
    });
  });

  test('more than MAX_REVIEW_COUNT received reviews throws review_bundle_too_large (409) without any Graph call', async () => {
    const reviews = Array.from({ length: MAX_REVIEW_COUNT + 1 }, (_, i) => review({
      suggestionId: `reviewer-${i}`,
      reviewFilename: `review-${i}.pdf`,
    }));
    const getFileMetadataByPath = jest.fn(async () => ({ id: 'x', driveId: 'y', size: 1 }));
    await expect(assembleReviewBundle({
      reviews,
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_too_large',
      httpStatus: 409,
    });
    expect(getFileMetadataByPath).not.toHaveBeenCalled();
  });

  test('source files whose total size exceeds MAX_SOURCE_BYTES throws review_bundle_too_large (409) before any download', async () => {
    const reviews = [
      review({ suggestionId: 'a', reviewFilename: 'a.pdf' }),
      review({ suggestionId: 'b', reviewFilename: 'b.pdf' }),
    ];
    const getFileMetadataByPath = jest.fn(async () => ({
      id: 'x',
      driveId: 'y',
      size: Math.ceil(MAX_SOURCE_BYTES / 2) + 1,
    }));
    const downloadFileByPath = jest.fn();
    await expect(assembleReviewBundle({
      reviews,
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { getFileMetadataByPath, downloadFileByPath })).rejects.toMatchObject({
      code: 'review_bundle_too_large',
      httpStatus: 409,
    });
    expect(downloadFileByPath).not.toHaveBeenCalled();
  });

  test('assembled output exceeding MAX_OUTPUT_BYTES throws review_bundle_too_large (409), after assembly completes', async () => {
    const oversized = await oversizedPdf(Math.ceil(MAX_OUTPUT_BYTES / (1024 * 1024)) + 2);
    expect(oversized.length).toBeGreaterThan(MAX_OUTPUT_BYTES);
    const downloadFileByPath = jest.fn(async () => ({ buffer: oversized }));
    const getFileMetadataByPath = metadataStub();

    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath, getFileMetadataByPath })).rejects.toMatchObject({
      code: 'review_bundle_too_large',
      httpStatus: 409,
    });
  }, 30000);
});
