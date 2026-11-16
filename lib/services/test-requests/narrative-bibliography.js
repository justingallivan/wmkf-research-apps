/**
 * Build the combined narrative-plus-bibliography PDF for a J27 Factory test
 * request (alignment log D60; owner, 2026-11-15): the narrative's pages, then
 * the bibliography's pages, no cover or separator. On real requests Connor's
 * flow builds this file; Reviewer Finder opens it by default
 * (`lib/services/reviewer-finder/load-proposal-service.js`).
 *
 * Pure: takes the two verified source buffers and returns the combined bytes.
 * The output is not required to be byte-identical across calls; the copy
 * step journals the hash of the bytes it actually uploads.
 */
import { PDFDocument } from 'pdf-lib';

function combineError(message) {
  const error = new Error(message);
  error.code = 'file_rejected';
  return error;
}

async function loadPart(bytes, label) {
  let pdf;
  let pageCount;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    // pdf-lib loads some broken files leniently and only fails when the page tree is read.
    pageCount = pdf.isEncrypted ? null : pdf.getPageCount();
  } catch (error) {
    throw combineError(`The ${label} could not be read as a PDF, so the combined Narrative-Bibliography file was not built (${error.message}).`);
  }
  if (pdf.isEncrypted) {
    throw combineError(`The ${label} is encrypted, so the combined Narrative-Bibliography file was not built.`);
  }
  if (pageCount < 1) throw combineError(`The ${label} has no pages.`);
  return pdf;
}

/**
 * @param {Buffer} narrative
 * @param {Buffer} bibliography
 * @returns {Promise<{ buffer: Buffer, pageCount: number }>}
 */
export async function buildNarrativeBibliographyPdf(narrative, bibliography) {
  if (!Buffer.isBuffer(narrative) || !Buffer.isBuffer(bibliography)) {
    throw combineError('Both the narrative and the bibliography bytes are required.');
  }
  const parts = [await loadPart(narrative, 'narrative'), await loadPart(bibliography, 'bibliography')];
  const combined = await PDFDocument.create({ updateMetadata: false });
  for (const part of parts) {
    const pages = await combined.copyPages(part, part.getPageIndices());
    pages.forEach((page) => combined.addPage(page));
  }
  const buffer = Buffer.from(await combined.save());
  return { buffer, pageCount: combined.getPageCount() };
}
