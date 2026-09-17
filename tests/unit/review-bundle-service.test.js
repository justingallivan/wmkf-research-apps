/**
 * Review bundle assembly (plan §11, Step C1).
 *
 * @jest-environment node
 */
import { PDFDocument } from 'pdf-lib';
import {
  assembleReviewBundle,
  reviewSetFingerprint,
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

  test('ignores every other review field', () => {
    const base = reviewSetFingerprint([review()]);
    const changedEverythingElse = reviewSetFingerprint([review({
      name: 'Someone Else',
      affiliation: 'Different University',
      reviewerAffiliation: 'Different University',
      mainInstitution: 'Different University',
      reviewReceivedAt: '2026-09-15T00:00:00Z',
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
    const getFileMetadataByPath = jest.fn(async (folder, filename) => (
      filename === 'review-charlie.docx' ? { id: 'charlie-item', driveId: 'charlie-drive' } : null
    ));
    const downloadFileAsPdf = jest.fn(async (driveId, itemId) => (
      driveId === 'charlie-drive' && itemId === 'charlie-item' ? docxPartPdf : null
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
    expect(result.skipped).toEqual([]);
    expect(typeof result.byteHash).toBe('string');
    expect(result.byteHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a %PDF- magic-byte failure throws review_bundle_part_invalid (502)', async () => {
    const downloadFileByPath = jest.fn(async () => ({ buffer: Buffer.from('not a pdf') }));
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath })).rejects.toMatchObject({
      code: 'review_bundle_part_invalid',
      httpStatus: 502,
    });
  });

  test('a corrupt-but-magic-matching PDF part throws review_bundle_part_invalid (502)', async () => {
    const downloadFileByPath = jest.fn(async () => ({ buffer: Buffer.from('%PDF-not-really-a-pdf') }));
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath })).rejects.toMatchObject({
      code: 'review_bundle_part_invalid',
      httpStatus: 502,
    });
  });

  test('a well-formed PDF missing the leading %PDF- signature is rejected by the magic-byte check even though pdf-lib would otherwise parse it (pdf-lib scans for the header past a leading byte)', async () => {
    const validPdf = await onePagePdf('shifted');
    const shifted = Buffer.concat([Buffer.from('X'), validPdf]);
    const downloadFileByPath = jest.fn(async () => ({ buffer: shifted }));
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath })).rejects.toMatchObject({
      code: 'review_bundle_part_invalid',
      httpStatus: 502,
    });
  });

  test('a Graph rejection throws review_bundle_unavailable (502)', async () => {
    const downloadFileByPath = jest.fn(async () => { throw new Error('Graph is down'); });
    await expect(assembleReviewBundle({
      reviews: [review()],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath })).rejects.toMatchObject({
      code: 'review_bundle_unavailable',
      httpStatus: 502,
    });
  });

  test('a Graph rejection converting a DOCX review throws review_bundle_unavailable (502)', async () => {
    const getFileMetadataByPath = jest.fn(async () => ({ id: 'item', driveId: 'drive' }));
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

  test('no file on any received review throws review_bundle_empty (409)', async () => {
    await expect(assembleReviewBundle({
      reviews: [review({ reviewSharePointFolder: null, reviewFilename: null })],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, {})).rejects.toMatchObject({
      code: 'review_bundle_empty',
      httpStatus: 409,
    });
  });

  test('a received review without a file is skipped, not fatal, and reported in `skipped`', async () => {
    const withFilePdf = await onePagePdf('has-file');
    const downloadFileByPath = jest.fn(async () => ({ buffer: withFilePdf }));

    const result = await assembleReviewBundle({
      reviews: [
        review({ suggestionId: 'has-file' }),
        review({ suggestionId: 'no-file', reviewSharePointFolder: null, reviewFilename: null }),
      ],
      requestNumber: '1002379',
      institutionName: 'Test Institution',
    }, { downloadFileByPath });

    expect(result.reviewCount).toBe(1);
    expect(result.skipped).toEqual(['no-file']);
  });
});
