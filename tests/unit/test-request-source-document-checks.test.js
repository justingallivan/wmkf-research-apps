/** @jest-environment node */
/**
 * Factory source lookup checks (owner, 2026-11-15):
 * - an Office package SharePoint rewrites during the read (new version, new
 *   bytes, nobody editing) is read once more and accepted only if stable;
 * - a .pdf the run would copy must be a PDF, and the narrative and
 *   bibliography must open, refused at lookup before anything is created.
 */
import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { PDFDocument } from 'pdf-lib';
import { hydrateTestRequestSourceDocument } from '../../lib/services/test-requests/admin-preview-service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

let REAL_PDF;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([10, 10]);
  REAL_PDF = Buffer.from(await pdf.save());
});

function selection(over = {}) {
  return {
    id: 'inv-1', kind: 'projectBudgetSpreadsheet', library: 'akoya_request', folder: '1002912_ABC/Phase I',
    name: 'Project Budget spreadsheet.xlsx', graphItemId: 'item-1', size: 3, mimeType: XLSX, ...over,
  };
}

/** `versions` is the sequence of stored file states SharePoint serves, one per metadata read or download. */
function graphServing(states) {
  let index = 0;
  const current = () => states[Math.min(index, states.length - 1)];
  return {
    getDriveId: jest.fn(async () => 'drive-1'),
    getSharePointTargetInfo: () => null,
    getFileMetadataById: jest.fn(async () => {
      const state = current();
      index += 1;
      return state && { id: 'item-1', name: state.name, size: state.bytes.length, mimeType: state.mimeType, eTag: state.eTag, versionId: state.versionId };
    }),
    downloadFile: jest.fn(async () => {
      const state = current();
      return { buffer: state.bytes, filename: state.name, mimeType: state.mimeType, size: state.bytes.length };
    }),
  };
}

const xlsxState = (version, bytes) => ({ name: 'Project Budget spreadsheet.xlsx', mimeType: XLSX, eTag: `"{GUID},${version}"`, versionId: `${version}.0`, bytes });

describe('an Office package rewritten by SharePoint during the read', () => {
  test('is read once more and accepted with the rewritten version, size and hash', async () => {
    const v3 = Buffer.from('abc');
    const v4 = Buffer.from('abc+properties');
    // before (v3), download (v4 already), after (v4) -> retry: before v4, download v4, after v4.
    const deps = graphServing([xlsxState(3, v3), xlsxState(4, v4), xlsxState(4, v4), xlsxState(4, v4), xlsxState(4, v4)]);
    const hydrated = await hydrateTestRequestSourceDocument(selection(), deps);
    expect(hydrated).toMatchObject({ size: v4.length, eTag: '"{GUID},4"', versionId: '4.0', contentHash: hash(v4) });
    expect(deps.downloadFile).toHaveBeenCalledTimes(2);
  });

  test('a listed size SharePoint has already changed is not binding for an Office package', async () => {
    const v4 = Buffer.from('abc+properties');
    const deps = graphServing([xlsxState(4, v4)]);
    await expect(hydrateTestRequestSourceDocument(selection({ size: 3 }), deps)).resolves.toMatchObject({ size: v4.length });
  });

  test('a second change during the re-read still refuses', async () => {
    const deps = graphServing([
      xlsxState(3, Buffer.from('abc')), xlsxState(4, Buffer.from('abcd')),
      xlsxState(4, Buffer.from('abcd')), xlsxState(5, Buffer.from('abcde')),
    ]);
    await expect(hydrateTestRequestSourceDocument(selection(), deps)).rejects.toMatchObject({ code: 'test_request_preview_source_changed' });
    expect(deps.downloadFile).toHaveBeenCalledTimes(2);
  });

  test('a PDF that changes during the read is not re-read: it refuses at once', async () => {
    const pdfState = (version, bytes) => ({ name: 'ProjectDescription.pdf', mimeType: 'application/pdf', eTag: `"e${version}"`, versionId: `${version}.0`, bytes });
    const changed = Buffer.concat([REAL_PDF, Buffer.from(' ')]);
    const deps = graphServing([pdfState(1, REAL_PDF), pdfState(2, changed), pdfState(2, changed)]);
    await expect(hydrateTestRequestSourceDocument(selection({
      kind: 'projectDescription', name: 'ProjectDescription.pdf', mimeType: 'application/pdf', size: REAL_PDF.length,
    }), deps)).rejects.toMatchObject({ code: 'test_request_preview_source_changed' });
    expect(deps.downloadFile).toHaveBeenCalledTimes(1);
  });
});

describe('a .pdf that is not a usable PDF', () => {
  const pdfSelection = (kind, name, bytes) => selection({ kind, name, mimeType: 'application/pdf', size: bytes.length });
  const pdfDeps = (name, bytes) => graphServing([{ name, mimeType: 'application/pdf', eTag: '"e1"', versionId: '1.0', bytes }]);

  test('is refused at lookup when it has no PDF header (the 1002912 bibliography held JSON text)', async () => {
    const text = Buffer.from('[null,null,null,null]');
    const name = 'ProposalBibliography_1002912.pdf';
    await expect(hydrateTestRequestSourceDocument(pdfSelection('proposalBibliography', name, text), pdfDeps(name, text)))
      .rejects.toMatchObject({
        httpStatus: 422,
        code: 'test_request_preview_source_invalid_pdf',
        message: expect.stringMatching(/^ProposalBibliography_1002912\.pdf on the source Request isn't a usable PDF \(it has no PDF header\)/),
      });
  });

  test('applies to every copied PDF, not only the narrative and bibliography', async () => {
    const text = Buffer.from('not a pdf');
    await expect(hydrateTestRequestSourceDocument(pdfSelection('projectDescription', 'ProjectDescription.pdf', text), pdfDeps('ProjectDescription.pdf', text)))
      .rejects.toMatchObject({ code: 'test_request_preview_source_invalid_pdf' });
  });

  test('a narrative with a header that still cannot be opened is refused', async () => {
    const broken = Buffer.from('%PDF-1.7\nnot really a pdf body');
    const name = 'ProposalNarrative_1002912.pdf';
    await expect(hydrateTestRequestSourceDocument(pdfSelection('proposalNarrative', name, broken), pdfDeps(name, broken)))
      .rejects.toMatchObject({ code: 'test_request_preview_source_invalid_pdf', message: expect.stringMatching(/cannot be opened as a PDF/) });
  });

  test('a real narrative PDF passes', async () => {
    const name = 'ProposalNarrative_1002912.pdf';
    await expect(hydrateTestRequestSourceDocument(pdfSelection('proposalNarrative', name, REAL_PDF), pdfDeps(name, REAL_PDF)))
      .resolves.toMatchObject({ contentHash: hash(REAL_PDF), size: REAL_PDF.length });
  });
});
