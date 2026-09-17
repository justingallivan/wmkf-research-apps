/**
 * Review bundle assembly (plan §11, Step C1): one PDF containing every
 * received review, assembled server-side at Share (prepare) time so the
 * Graph/pdf-lib latency lands on staff, not a Board reader.
 *
 * `reviewSetFingerprint` pins the identity of the review set an assembled
 * bundle came from (used both at prepare, on the attempt, and by the
 * on-demand rebuild comparison in a later step). `assembleReviewBundle`
 * fetches each received review's bytes (converting a DOCX-origin review to
 * PDF through the same Graph conversion the brief PDF snapshot uses),
 * prepends a separator page per review, and concatenates everything into one
 * pdf-lib document. Both are pure/deterministic aside from the Graph calls
 * `assembleReviewBundle` makes through injected dependencies.
 */

import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { GraphService } from '../graph-service.js';
import { ServiceHttpError } from '../service-http-error.js';
import { compareReviewersByName, reviewerAffiliationOf } from '../../../shared/utils/review-writeup-paragraphs.js';

const REVIEW_LIBRARY = 'akoya_request';
// US Letter, points (72 dpi): 8.5in x 11in.
const PAGE_SIZE = [612, 792];
// A fixed instant so two assemblies of the same review set produce
// byte-identical output (pdf-lib otherwise stamps CreationDate/ModDate with
// `now()`, which would make the generation key's byte hash non-deterministic
// across an idempotent re-run of the same review set).
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

const DEFAULT_DEPENDENCIES = Object.freeze({
  downloadFileByPath: (folderPath, filename) => GraphService.downloadFileByPath(REVIEW_LIBRARY, folderPath, filename),
  getFileMetadataByPath: (folderPath, filename) => GraphService.getFileMetadataByPath(REVIEW_LIBRARY, folderPath, filename),
  downloadFileAsPdf: (driveId, itemId) => GraphService.downloadFileAsPdf(driveId, itemId),
});

function bundleError(message, code, httpStatus = 502) {
  return new ServiceHttpError(message, {
    httpStatus,
    code,
    body: { error: message, code },
  });
}

function isPdfMagic(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.subarray(0, 5).equals(Buffer.from('%PDF-'));
}

function receivedReviewsOf(reviews) {
  return (reviews || []).filter((review) => Boolean(review?.reviewReceivedAt));
}

/**
 * Sha256 hex digest of the received review set's identity: each review
 * reduced to `{ suggestionId, reviewSharePointFolder, reviewFilename }`,
 * sorted by lowercase `suggestionId` for order independence. Every other
 * review field (name, affiliation, ratings, ...) is intentionally excluded
 * so the fingerprint changes only when the actual file set changes. Pure —
 * no I/O.
 */
export function reviewSetFingerprint(reviews) {
  const parts = receivedReviewsOf(reviews)
    .map((review) => ({
      suggestionId: String(review.suggestionId || '').toLowerCase(),
      reviewSharePointFolder: review.reviewSharePointFolder || null,
      reviewFilename: review.reviewFilename || null,
    }))
    .sort((a, b) => a.suggestionId.localeCompare(b.suggestionId));
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function formatReceivedDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return 'an unknown date';
  return parsed.toISOString().slice(0, 10);
}

function drawSeparatorPage(doc, font, { index, total, review }) {
  const page = doc.addPage(PAGE_SIZE);
  const { height } = page.getSize();
  const affiliation = reviewerAffiliationOf(review);
  const lines = [
    { text: `Review ${index} of ${total}`, size: 20 },
    { text: review.name || 'Reviewer', size: 14 },
    ...(affiliation ? [{ text: affiliation, size: 12 }] : []),
    { text: `Received ${formatReceivedDate(review.reviewReceivedAt)}`, size: 12 },
  ];
  let y = height - 160;
  for (const line of lines) {
    page.drawText(line.text, { x: 72, y, size: line.size, font });
    y -= line.size + 14;
  }
}

/**
 * Assemble one PDF containing every received review with a retained file,
 * each preceded by a separator page. Fails closed: any Graph failure or
 * invalid part throws rather than producing a partial bundle, and an empty
 * received-with-file set throws `review_bundle_empty` (the brief gate
 * already guarantees at least one received review overall; a received
 * review without a retained file is skipped, not fatal, and reported in
 * `skipped`).
 *
 * @returns {Promise<{buffer: Buffer, byteHash: string, reviewCount: number, parts: Array<{suggestionId: string, filename: string, converted: boolean}>, skipped: string[]}>}
 */
export async function assembleReviewBundle(
  { reviews, requestNumber, institutionName },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const received = receivedReviewsOf(reviews);
  const withFile = received.filter((review) => review.reviewSharePointFolder && review.reviewFilename);
  const skipped = received
    .filter((review) => !(review.reviewSharePointFolder && review.reviewFilename))
    .map((review) => review.suggestionId);
  if (withFile.length === 0) {
    throw bundleError(
      'No received review has a retained file to bundle.',
      'review_bundle_empty',
      409,
    );
  }
  const ordered = [...withFile].sort(compareReviewersByName);

  const doc = await PDFDocument.create();
  doc.setTitle(`${institutionName || 'Reviews'} — Reviews`);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const parts = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const review = ordered[i];
    let bytes;
    let converted = false;
    if (/\.pdf$/i.test(review.reviewFilename)) {
      const downloaded = await dependencies.downloadFileByPath(
        review.reviewSharePointFolder,
        review.reviewFilename,
      ).catch((error) => {
        throw bundleError(
          `The review "${review.reviewFilename}" could not be downloaded from SharePoint.`,
          'review_bundle_unavailable',
          502,
        );
      });
      bytes = downloaded?.buffer;
    } else {
      const meta = await dependencies.getFileMetadataByPath(
        review.reviewSharePointFolder,
        review.reviewFilename,
      ).catch((error) => {
        throw bundleError(
          `The review "${review.reviewFilename}" could not be located in SharePoint.`,
          'review_bundle_unavailable',
          502,
        );
      });
      if (!meta?.id || !meta?.driveId) {
        throw bundleError(
          `The review "${review.reviewFilename}" could not be located in SharePoint.`,
          'review_bundle_unavailable',
          502,
        );
      }
      bytes = await dependencies.downloadFileAsPdf(meta.driveId, meta.id).catch((error) => {
        throw bundleError(
          `The review "${review.reviewFilename}" could not be converted to PDF.`,
          'review_bundle_unavailable',
          502,
        );
      });
      converted = true;
    }
    if (!isPdfMagic(bytes)) {
      throw bundleError(
        `The review "${review.reviewFilename}" is not a valid PDF.`,
        'review_bundle_part_invalid',
        502,
      );
    }

    drawSeparatorPage(doc, font, { index: i + 1, total: ordered.length, review });

    let sourcePdf;
    try {
      sourcePdf = await PDFDocument.load(bytes);
    } catch (error) {
      throw bundleError(
        `The review "${review.reviewFilename}" could not be parsed as a PDF.`,
        'review_bundle_part_invalid',
        502,
      );
    }
    const copiedPages = await doc.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((copiedPage) => doc.addPage(copiedPage));

    parts.push({ suggestionId: review.suggestionId, filename: review.reviewFilename, converted });
  }

  const buffer = Buffer.from(await doc.save());
  const byteHash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, byteHash, reviewCount: ordered.length, parts, skipped };
}

export { DEFAULT_DEPENDENCIES };
