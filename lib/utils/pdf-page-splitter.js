/**
 * PDF Page Splitter Utility
 *
 * Splits a multi-page PDF into individual pages as base64-encoded PDFs
 * for use with Claude's Vision API.
 */

import { PDFDocument } from 'pdf-lib';

/**
 * Split a PDF buffer into individual pages
 * @param {Buffer|ArrayBuffer} pdfBuffer - The PDF file as a buffer
 * @returns {Promise<Array<{pageNumber: number, base64: string, totalPages: number}>>}
 */
export async function splitPdfToPages(pdfBuffer) {
  // Load the source PDF
  const sourcePdf = await PDFDocument.load(pdfBuffer);
  const totalPages = sourcePdf.getPageCount();

  const pages = [];

  for (let i = 0; i < totalPages; i++) {
    // Create a new PDF document for this single page
    const singlePagePdf = await PDFDocument.create();

    // Copy the page from source to the new document
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [i]);
    singlePagePdf.addPage(copiedPage);

    // Save the single-page PDF as bytes
    const pdfBytes = await singlePagePdf.save();

    // Convert to base64
    const base64 = Buffer.from(pdfBytes).toString('base64');

    pages.push({
      pageNumber: i + 1,
      base64,
      totalPages
    });
  }

  return pages;
}
