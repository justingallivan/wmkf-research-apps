/**
 * Review bundle assembly (plan §11, Step C1/C2): one PDF containing every
 * received review, assembled server-side at Share (prepare) time so the
 * Graph/pdf-lib latency lands on staff, not a Board reader.
 *
 * `reviewSetFingerprint` pins the identity of the review set an assembled
 * bundle came from (used both at prepare, on the attempt, and by the
 * on-demand rebuild comparison). It covers every field the separator pages
 * render (name, affiliation, received date — normalized) plus the file
 * identity (suggestionId/folder/filename), so a rebuild trigger is never
 * blind to a change the bundle's own pages would show. `assembleReviewBundle`
 * fails closed on an incomplete review (no silent per-review skip), bounds
 * review count and source/output byte size before doing unbounded work, then
 * fetches each received review's bytes (converting a DOCX-origin review to
 * PDF through the same Graph conversion the brief PDF snapshot uses),
 * prepends a separator page per review (WinAnsi-only font: reviewer-controlled
 * text is sanitized, never throws), and concatenates everything into one
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

// Resource bounds (Codex adversarial review, Step C): a request with an
// unusually large received-review set or oversized source files must never
// consume unbounded memory/time assembling a bundle, and the output must
// stay under the document route's 60mb response limit
// (pages/api/external/briefing/[token]/document.js `config.api.responseLimit`).
const MAX_REVIEW_COUNT = 25;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

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

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Trim + Unicode NFC-normalize; empty/whitespace-only collapses to null. */
function normalizeFingerprintText(value) {
  const text = typeof value === 'string' ? value : (value == null ? '' : String(value));
  const trimmed = text.trim().normalize('NFC');
  return trimmed || null;
}

/**
 * ISO `YYYY-MM-DD`, or null when unparseable — the same reduction the
 * separator page's "Received <date>" line renders (see `formatReceivedDate`
 * below), so the fingerprint can never be blind to what the page shows.
 */
function normalizedReceivedDate(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Sha256 hex digest of the received review set's identity: each review
 * reduced to its file identity (`suggestionId`, `reviewSharePointFolder`,
 * `reviewFilename`) plus every field the assembled bundle's separator pages
 * render (normalized `name`, `affiliation`, `receivedAt`), sorted by
 * lowercase `suggestionId` for order independence. Every other review field
 * (ratings, answers, ...) is intentionally excluded so the fingerprint
 * changes only when the bundle's own identity or rendered content would
 * change. Pure — no I/O.
 */
export function reviewSetFingerprint(reviews) {
  const parts = receivedReviewsOf(reviews)
    .map((review) => ({
      suggestionId: String(review.suggestionId || '').toLowerCase(),
      reviewSharePointFolder: review.reviewSharePointFolder || null,
      reviewFilename: review.reviewFilename || null,
      name: normalizeFingerprintText(review.name),
      affiliation: normalizeFingerprintText(reviewerAffiliationOf(review)),
      receivedAt: normalizedReceivedDate(review.reviewReceivedAt),
    }))
    .sort((a, b) => a.suggestionId.localeCompare(b.suggestionId));
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function formatReceivedDate(value) {
  return normalizedReceivedDate(value) || 'an unknown date';
}

// WinAnsiEncoding (pdf-lib's default StandardFonts encoding, ~ CP1252) has no
// representation above code point 0xFF; every character above that is
// replaced with `?`. This is reviewer-controlled text (name, affiliation),
// so assembly must never throw on it (Codex adversarial review, Step C) —
// `drawSanitizedText` below also wraps the actual draw call in a last-resort
// catch, in case a code point in the 0x80-0xFF range still isn't in the
// font's encoding table.
function sanitizeForWinAnsi(value) {
  const text = String(value || '');
  let out = '';
  for (const ch of text) {
    out += ch.codePointAt(0) <= 0xFF ? ch : '?';
  }
  return out;
}

function drawSanitizedText(page, value, opts) {
  const sanitized = sanitizeForWinAnsi(value);
  try {
    page.drawText(sanitized, opts);
  } catch {
    page.drawText('?'.repeat(sanitized.length) || '?', opts);
  }
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
    drawSanitizedText(page, line.text, { x: 72, y, size: line.size, font });
    y -= line.size + 14;
  }
}

function incompleteReviewsMessage(incomplete) {
  const names = incomplete.map((review) => review.name || 'Reviewer');
  if (names.length === 1) {
    return `The review from ${names[0]} has no retained file yet. Try again once its document is `
      + "filed, or regenerate it from the reviewer's record.";
  }
  return `The reviews from ${names.join(', ')} have no retained file yet. Try again once their `
    + "documents are filed, or regenerate them from the reviewers' records.";
}

/**
 * Assemble one PDF containing every received review, each preceded by a
 * separator page. Fails closed: any Graph failure, invalid part, incomplete
 * review, or resource bound throws rather than producing a partial or
 * unbounded bundle. `reviewCount` always equals the received-review count —
 * there is no per-review skip.
 *
 * @returns {Promise<{buffer: Buffer, byteHash: string, reviewCount: number, parts: Array<{suggestionId: string, filename: string, converted: boolean}>}>}
 */
export async function assembleReviewBundle(
  { reviews, requestNumber, institutionName },
  dependencies = DEFAULT_DEPENDENCIES,
) {
  const received = receivedReviewsOf(reviews);
  const incomplete = received.filter((review) => !(review.reviewSharePointFolder && review.reviewFilename));
  if (incomplete.length > 0) {
    throw bundleError(incompleteReviewsMessage(incomplete), 'review_bundle_incomplete', 409);
  }
  if (received.length === 0) {
    throw bundleError(
      'No received review has a retained file to bundle.',
      'review_bundle_empty',
      409,
    );
  }
  if (received.length > MAX_REVIEW_COUNT) {
    throw bundleError(
      `This request has ${received.length} received reviews, over the review-bundle limit of `
        + `${MAX_REVIEW_COUNT}. Reduce the review set or contact an administrator to raise the limit.`,
      'review_bundle_too_large',
      409,
    );
  }
  const ordered = [...received].sort(compareReviewersByName);

  // Preflight: resolve every source file's size before downloading any
  // bytes, so an oversized set is refused cheaply.
  const metadataByIndex = [];
  let totalSourceBytes = 0;
  for (const review of ordered) {
    const meta = await dependencies.getFileMetadataByPath(
      review.reviewSharePointFolder,
      review.reviewFilename,
    ).catch(() => null);
    if (!meta?.id || !meta?.driveId) {
      throw bundleError(
        `The review "${review.reviewFilename}" could not be located in SharePoint.`,
        'review_bundle_unavailable',
        502,
      );
    }
    metadataByIndex.push(meta);
    totalSourceBytes += Number(meta.size) || 0;
  }
  if (totalSourceBytes > MAX_SOURCE_BYTES) {
    throw bundleError(
      `This request's review files total ${formatMB(totalSourceBytes)}, over the review-bundle `
        + `source limit of ${formatMB(MAX_SOURCE_BYTES)}. Reduce or re-upload the review files.`,
      'review_bundle_too_large',
      409,
    );
  }

  const doc = await PDFDocument.create();
  doc.setTitle(`${institutionName || 'Reviews'} — Reviews`);
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const parts = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const review = ordered[i];
    const meta = metadataByIndex[i];
    let bytes;
    let converted = false;
    if (/\.pdf$/i.test(review.reviewFilename)) {
      const downloaded = await dependencies.downloadFileByPath(
        review.reviewSharePointFolder,
        review.reviewFilename,
      ).catch(() => {
        throw bundleError(
          `The review "${review.reviewFilename}" could not be downloaded from SharePoint.`,
          'review_bundle_unavailable',
          502,
        );
      });
      bytes = downloaded?.buffer;
    } else {
      bytes = await dependencies.downloadFileAsPdf(meta.driveId, meta.id).catch(() => {
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
  if (buffer.length > MAX_OUTPUT_BYTES) {
    throw bundleError(
      `The assembled review bundle is ${formatMB(buffer.length)}, over the review-bundle output `
        + `limit of ${formatMB(MAX_OUTPUT_BYTES)}. Reduce the review set or re-upload smaller review files.`,
      'review_bundle_too_large',
      409,
    );
  }
  const byteHash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, byteHash, reviewCount: ordered.length, parts };
}

export {
  DEFAULT_DEPENDENCIES,
  MAX_REVIEW_COUNT,
  MAX_SOURCE_BYTES,
  MAX_OUTPUT_BYTES,
  sanitizeForWinAnsi,
};
