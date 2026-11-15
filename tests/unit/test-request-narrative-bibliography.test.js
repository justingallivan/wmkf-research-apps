/** @jest-environment node */
/**
 * Factory combined narrative-plus-bibliography file (alignment log D60; owner,
 * 2026-11-15): planned last for the J27 layout only, built from the verified
 * source bytes (narrative pages, then bibliography pages), uploaded create-only
 * to AI Materials, and journaled with the hash of the bytes uploaded.
 */
import crypto from 'node:crypto';
import { jest } from '@jest/globals';
import { PDFDocument } from 'pdf-lib';
import {
  NARRATIVE_BIBLIOGRAPHY_KIND,
  bundleManifestFileCountOk,
  copyBundleFiles,
  filesPromisedByManifest,
  planBundleFileCopies,
  plannedBundleFileCount,
  reverifyCopiedItems,
  verifyCopiedFiles,
} from '../../lib/services/test-requests/bundle-file-copy.js';
import { buildNarrativeBibliographyPdf } from '../../lib/services/test-requests/narrative-bibliography.js';
import { assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';
import {
  acceptedProposalBibliographyFilenames,
  acceptedProposalNarrativeFilenames,
  expectedNarrativeBibliographyFilename,
} from '../../lib/utils/proposal-document-names.js';

const SITE = { key: 'akoyago-shared', hostname: 'appriver3651007194.sharepoint.com', pathname: '/sites/akoyago' };
const TARGET = { ...SITE, registered: true };
const SITE_ID = 'site-1';
const REQUEST_DRIVE = 'drive-request';
const REQUEST_FOLDER = '1000400_AAAAAAAAAAAA4AAA8AAAAAAAAAAAAAAA';
const J27 = 'single-submission';
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function pdfWithPages(sizes) {
  const pdf = await PDFDocument.create();
  for (const [width, height] of sizes) pdf.addPage([width, height]);
  return Buffer.from(await pdf.save());
}

let NARRATIVE;
let BIBLIOGRAPHY;
beforeAll(async () => {
  NARRATIVE = await pdfWithPages([[100, 100], [101, 101]]);
  BIBLIOGRAPHY = await pdfWithPages([[200, 200]]);
});

function sourceDoc(kind, itemId, buffer, over = {}) {
  const name = kind === 'proposalNarrative' ? 'ProposalNarrative_1003222.pdf' : 'ProposalBibliography_1003222.pdf';
  return {
    id: `inv-${itemId}`, kind, library: 'akoya_request', folder: '1003222_E43AE6EA/AI Materials', name,
    driveId: 'stale-drive', graphItemId: itemId, sharePointSite: SITE, size: buffer.length,
    mimeType: 'application/pdf', eTag: `"etag-${itemId}"`, versionId: '1.0', contentHash: hash(buffer), ...over,
  };
}
const bundleOf = (documents) => ({ source: { request: { akoya_requestnum: '1003222' } }, documents });
const fullBundle = () => bundleOf([
  sourceDoc('proposalNarrative', 'item-n', NARRATIVE),
  sourceDoc('proposalBibliography', 'item-b', BIBLIOGRAPHY),
]);

function fakeDependencies(overrides = {}) {
  const contents = { 'item-n': NARRATIVE, 'item-b': BIBLIOGRAPHY };
  const metadata = (itemId) => {
    const buffer = contents[itemId];
    if (!buffer) return null;
    const name = itemId === 'item-n' ? 'ProposalNarrative_1003222.pdf' : 'ProposalBibliography_1003222.pdf';
    return { id: itemId, name, size: buffer.length, mimeType: 'application/pdf', eTag: `"etag-${itemId}"`, versionId: '1.0' };
  };
  const destination = new Map();
  const deps = {
    clearGraphCaches: jest.fn(),
    configuredSharePointTarget: jest.fn(() => TARGET),
    getSiteId: jest.fn(async () => SITE_ID),
    getDriveId: jest.fn(async () => REQUEST_DRIVE),
    getFileMetadataById: jest.fn(async (driveId, itemId) => {
      const source = metadata(itemId);
      if (source) return source;
      for (const item of destination.values()) if (item.id === itemId) return item;
      return null;
    }),
    downloadFile: jest.fn(async (driveId, itemId) => {
      if (contents[itemId]) return { buffer: contents[itemId] };
      for (const item of destination.values()) if (item.id === itemId) return { buffer: item.buffer };
      throw new Error('missing');
    }),
    getFileMetadataByPath: jest.fn(async (library, folder, filename) => destination.get(`${folder}/${filename}`) ?? null),
    ensureFolderPath: jest.fn(async (library, folder) => ({ id: `folder:${folder}` })),
    uploadFile: jest.fn(async (library, folder, filename, buffer, mimeType, options) => {
      const item = { id: `new-${filename}`, name: filename, folder, size: buffer.length, mimeType, eTag: '"new"', versionId: '1.0', buffer };
      destination.set(`${folder}/${filename}`, item);
      if (options?.onItemCreated) await options.onItemCreated({ id: item.id, name: filename, size: buffer.length, eTag: item.eTag });
      return { id: item.id, name: filename, size: buffer.length, eTag: item.eTag, versionId: '1.0' };
    }),
    ...overrides,
  };
  return { deps, destination, contents };
}

const params = (plannedFiles) => ({
  plannedFiles, requestFolder: REQUEST_FOLDER, expectedSiteId: SITE_ID, expectedDestinationDriveId: REQUEST_DRIVE,
});

describe('buildNarrativeBibliographyPdf', () => {
  test('puts the narrative pages first, then the bibliography pages, with no extra pages', async () => {
    const { buffer, pageCount } = await buildNarrativeBibliographyPdf(NARRATIVE, BIBLIOGRAPHY);
    expect(pageCount).toBe(3);
    const combined = await PDFDocument.load(buffer);
    expect(combined.getPages().map((page) => page.getWidth())).toEqual([100, 101, 200]);
  });

  test('refuses bytes that are not a PDF, with an allowlisted reason code', async () => {
    await expect(buildNarrativeBibliographyPdf(Buffer.from('not a pdf'), BIBLIOGRAPHY))
      .rejects.toMatchObject({ code: 'file_rejected', message: expect.stringMatching(/narrative could not be read/) });
    await expect(buildNarrativeBibliographyPdf(NARRATIVE, Buffer.from('nope')))
      .rejects.toMatchObject({ code: 'file_rejected', message: expect.stringMatching(/bibliography could not be read/) });
  });
});

describe('planning the combined file', () => {
  test('the J27 layout plans it last, in AI Materials, under the shared name', () => {
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400', destinationLayout: J27 });
    // The two copied files keep the existing plan order; the combined file is always last.
    expect(plan.slice(0, 2).map((file) => [file.kind, file.destination.folder, file.destination.filename]).sort()).toEqual([
      ['proposalBibliography', 'Submission-Documents', 'Bibliography_1000400.pdf'],
      ['proposalNarrative', 'Submission-Documents', 'Project-Narrative_1000400.pdf'],
    ]);
    expect([plan[2].kind, plan[2].destination.folder, plan[2].destination.filename])
      .toEqual([NARRATIVE_BIBLIOGRAPHY_KIND, 'AI Materials', expectedNarrativeBibliographyFilename('1000400')]);
    expect(plan[2].destination.filename).toBe('Narrative-Bibliography_1000400.pdf');
    expect(plan[2].derivedFrom.narrative.graphItemId).toBe('item-n');
    expect(plan[2].derivedFrom.bibliography.graphItemId).toBe('item-b');
    expect(plan[2].source).toMatchObject({ graphItemId: null, size: null, contentHash: null, mimeType: 'application/pdf' });
    expect(planBundleFileCopies(fullBundle(), { destinationLayout: J27 })[2].destination)
      .toMatchObject({ filename: null, filenameTemplate: 'Narrative-Bibliography_{new-request-number}.pdf' });
  });

  test('the D26 layout is unchanged: no combined file', () => {
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400' });
    expect(plan.map((file) => file.kind).sort()).toEqual(['proposalBibliography', 'proposalNarrative']);
    expect(plannedBundleFileCount(fullBundle())).toBe(2);
  });

  test('a J27 bundle missing either input plans no combined file', () => {
    const narrativeOnly = bundleOf([sourceDoc('proposalNarrative', 'item-n', NARRATIVE)]);
    const bibliographyOnly = bundleOf([sourceDoc('proposalBibliography', 'item-b', BIBLIOGRAPHY)]);
    expect(planBundleFileCopies(narrativeOnly, { destinationLayout: J27 }).map((file) => file.kind)).toEqual(['proposalNarrative']);
    expect(planBundleFileCopies(bibliographyOnly, { destinationLayout: J27 }).map((file) => file.kind)).toEqual(['proposalBibliography']);
    expect(plannedBundleFileCount(narrativeOnly, J27)).toBe(1);
    expect(plannedBundleFileCount(fullBundle(), J27)).toBe(3);
  });

  test('the governed narrative and bibliography readers never accept the combined name (D59)', () => {
    const name = expectedNarrativeBibliographyFilename('1000400');
    expect(acceptedProposalNarrativeFilenames('1000400')).not.toContain(name);
    expect(acceptedProposalBibliographyFilenames('1000400')).not.toContain(name);
  });
});

describe('copying the combined file', () => {
  test('builds it from the verified sources, uploads create-only, and journals the uploaded bytes', async () => {
    const { deps, destination } = fakeDependencies();
    const journal = jest.fn(async () => {});
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400', destinationLayout: J27 });
    const copies = await copyBundleFiles(params(plan), deps, journal);
    expect(copies.map((copy) => copy.status)).toEqual(['verified', 'verified', 'verified']);
    const combined = destination.get(`${REQUEST_FOLDER}/AI Materials/Narrative-Bibliography_1000400.pdf`);
    expect(combined).toBeTruthy();
    expect((await PDFDocument.load(combined.buffer)).getPageCount()).toBe(3);
    const [uploadCall] = deps.uploadFile.mock.calls.filter((call) => call[2] === 'Narrative-Bibliography_1000400.pdf');
    expect(uploadCall[4]).toBe('application/pdf');
    expect(uploadCall[5]).toMatchObject({ conflictBehavior: 'fail' });
    expect(copies[2].source).toMatchObject({ size: combined.buffer.length, contentHash: hash(combined.buffer) });
    expect(copies[2].source.graphItemId).toBeNull();
    // The receipt the ledger stores for it passes the ledger grammar (099).
    expect(() => assertLedgerReceipt({
      folder: copies[2].destination.folder, filename: copies[2].destination.filename,
      size: copies[2].source.size, contentHash: copies[2].source.contentHash,
    }, 'readback')).not.toThrow();
    // Final verification: the folder listing and a byte re-read both pass.
    const listing = [...destination.values()].map((item) => ({ id: item.id, name: item.name, folder: item.folder, size: item.size }));
    expect(verifyCopiedFiles(copies, listing)).toEqual([]);
    expect(await reverifyCopiedItems(copies, deps)).toEqual([]);
  });

  test('final verification fails when the combined file is altered or missing', async () => {
    const { deps, destination } = fakeDependencies();
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400', destinationLayout: J27 });
    const copies = await copyBundleFiles(params(plan), deps, jest.fn(async () => {}));
    const key = `${REQUEST_FOLDER}/AI Materials/Narrative-Bibliography_1000400.pdf`;
    const original = destination.get(key);
    destination.set(key, { ...original, buffer: Buffer.alloc(original.buffer.length, 1) });
    expect((await reverifyCopiedItems(copies, deps)).join(' ')).toMatch(/Narrative-Bibliography/);
    destination.delete(key);
    const listing = [...destination.values()].map((item) => ({ id: item.id, name: item.name, folder: item.folder, size: item.size }));
    expect(verifyCopiedFiles(copies, listing).join(' ')).toMatch(/Narrative-Bibliography_1000400.pdf not present/);
  });

  test('a changed input refuses before anything is uploaded for the combined file', async () => {
    const { deps, destination, contents } = fakeDependencies();
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400', destinationLayout: J27 });
    // Both inputs copy fine; then the bibliography bytes change before the combined step re-reads them.
    await copyBundleFiles(params(plan.slice(0, 2)), deps, jest.fn(async () => {}));
    contents['item-b'] = Buffer.concat([BIBLIOGRAPHY.subarray(0, BIBLIOGRAPHY.length - 1), Buffer.from('x')]);
    await expect(copyBundleFiles(params([plan[2]]), deps, jest.fn(async () => {}))).rejects.toThrow(/SHA-256 does not match/);
    expect(destination.has(`${REQUEST_FOLDER}/AI Materials/Narrative-Bibliography_1000400.pdf`)).toBe(false);
  });

  test('an input that is not a PDF stops with file_rejected and uploads nothing', async () => {
    const junk = Buffer.from('not a pdf at all');
    const bundle = bundleOf([
      sourceDoc('proposalNarrative', 'item-n', junk),
      sourceDoc('proposalBibliography', 'item-b', BIBLIOGRAPHY),
    ]);
    const { deps, destination, contents } = fakeDependencies();
    contents['item-n'] = junk;
    const plan = planBundleFileCopies(bundle, { destinationRequestNumber: '1000400', destinationLayout: J27 });
    await expect(copyBundleFiles(params([plan[2]]), deps, jest.fn(async () => {}))).rejects.toMatchObject({ code: 'file_rejected' });
    expect(destination.size).toBe(0);
  });

  test('an existing combined file at the destination is refused, never overwritten', async () => {
    const { deps, destination } = fakeDependencies();
    destination.set(`${REQUEST_FOLDER}/AI Materials/Narrative-Bibliography_1000400.pdf`, { id: 'old', size: 1, buffer: Buffer.from('x') });
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400', destinationLayout: J27 });
    await expect(copyBundleFiles(params([plan[2]]), deps, jest.fn(async () => {}))).rejects.toThrow(/already exists/);
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });
});

describe('manifests prepared before the combined file existed', () => {
  const manifestWith = (count) => ({ plannedFiles: Array(count).fill({}), invariants: { expectedSharePointFiles: count } });

  test('a J27 manifest is valid with the current plan (3) or the earlier plan (2), and nothing else', () => {
    expect(bundleManifestFileCountOk(manifestWith(3), fullBundle(), J27)).toBe(true);
    expect(bundleManifestFileCountOk(manifestWith(2), fullBundle(), J27)).toBe(true);
    expect(bundleManifestFileCountOk(manifestWith(4), fullBundle(), J27)).toBe(false);
    expect(bundleManifestFileCountOk(manifestWith(1), fullBundle(), J27)).toBe(false);
    expect(bundleManifestFileCountOk({ plannedFiles: Array(3).fill({}), invariants: { expectedSharePointFiles: 2 } }, fullBundle(), J27)).toBe(false);
  });

  test('a D26 manifest still needs exactly the bundle documents', () => {
    expect(bundleManifestFileCountOk(manifestWith(2), fullBundle())).toBe(true);
    expect(bundleManifestFileCountOk(manifestWith(3), fullBundle())).toBe(false);
  });

  test('a run copies only what its manifest promised', () => {
    const plan = planBundleFileCopies(fullBundle(), { destinationRequestNumber: '1000400', destinationLayout: J27 });
    expect(filesPromisedByManifest(plan, 2).map((file) => file.kind)).not.toContain(NARRATIVE_BIBLIOGRAPHY_KIND);
    expect(filesPromisedByManifest(plan, 3).at(-1).kind).toBe(NARRATIVE_BIBLIOGRAPHY_KIND);
    for (const bad of [4, -1, undefined, '3']) {
      expect(() => filesPromisedByManifest(plan, bad)).toThrow(expect.objectContaining({ code: 'manifest_digest_mismatch' }));
    }
  });
});
