import { renderDossierDocuments, renderIndividualDossierDocuments } from '../../lib/services/cycle-dossier-documents.js';
import { PDFDocument, PDFName } from 'pdf-lib';
import { inflateSync } from 'zlib';

const entry = {
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  requestNumber: 'D26-001',
  title: 'Quantum α proposal',
  institution: 'Example University',
  pi: 'Dr PI',
  programDirector: 'PD',
  entry: {
    projectAtAGlance: 'A concise project description.',
    whyItMatters: 'Why it matters to the field.',
    fieldAroundIt: 'The surrounding research landscape.',
    backgroundForOutsideField: 'Context for a scientist outside the field.',
    references: [{ sourceId: 'oa-1', title: 'A paper', url: 'https://example.test/paper', retrievedAt: '2026-09-07T00:00:00.000Z' }],
  },
};

test('renders individual Word and PDF bytes from the same payload and hashes them', async () => {
  const result = await renderIndividualDossierDocuments(entry);
  expect(Buffer.isBuffer(result.docx)).toBe(true);
  expect(result.docx.length).toBeGreaterThan(100);
  expect(result.pdf.length).toBeGreaterThan(100);
  expect(result.docxSha256).toHaveLength(64);
  expect(result.pdfSha256).toHaveLength(64);
});

test('renders combined artifacts and visibly discloses partial coverage', async () => {
  const result = await renderDossierDocuments({ title: 'D26 Dossier', partial: true, gaps: [{ source: 'pubmed', reason: 'unavailable' }], entries: [entry, { ...entry, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', requestNumber: 'D26-002', programDirector: 'Another PD' }] });
  expect(result.individual).toHaveLength(2);
  expect(result.combined.docx.length).toBeGreaterThan(100);
  expect(result.combined.pdf.length).toBeGreaterThan(100);
  expect(result.sourceManifestHash).toHaveLength(64);
});

test('rendering rejects entries without the frozen payload', async () => {
  await expect(renderDossierDocuments({ entries: [{ requestId: entry.requestId }] })).rejects.toThrow(/invalid entry/i);
});

test('long paragraphs paginate, references have link annotations, and Delta remains visible', async () => {
  const longEntry = { ...entry, title: 'Delta Δ response', entry: { ...entry.entry, projectAtAGlance: 'A scientific mechanism with measured uncertainty. '.repeat(400) } };
  const result = await renderIndividualDossierDocuments(longEntry);
  const pdf = await PDFDocument.load(result.pdf);
  expect(pdf.getPageCount()).toBeGreaterThan(3);
  const pages = pdf.getPages();
  expect(pages.some(page => page.node.lookup(PDFName.of('Annots'))?.size() > 0)).toBe(true);
  const operators = pages.flatMap(page => {
    const contents = page.node.Contents();
    return contents.asArray().map(ref => inflateSync(pdf.context.lookup(ref).contents).toString());
  }).join('\n');
  // Text is encoded in hexadecimal in pdf-lib streams. The visible spelling
  // prevents Standard Symbol's blank Delta glyph from silently losing meaning.
  expect(operators.toUpperCase()).toContain(Buffer.from('[Delta]').toString('hex').toUpperCase());
});
