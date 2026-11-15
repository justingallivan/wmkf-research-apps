/** @jest-environment node */
/**
 * Factory narrative and bibliography sources (owner, 2026-11-15): many
 * `AI Materials` copies are broken, so the applicant's originals in the source
 * Request's `Phase II` folder (`Project Narrative.pdf`, `Bibliography.pdf`) are
 * preferred, with the `AI Materials` copy as the fallback. Destinations are
 * unchanged (J27: Submission-Documents; D26: AI Materials).
 */
import { jest } from '@jest/globals';
import { compileBasicCloneFilePlan } from '../../lib/services/test-requests/file-plan.js';
import { discoverTestRequestSourceDocuments } from '../../lib/services/test-requests/admin-preview-service.js';

const HASH = 'a'.repeat(64);
const ROOT = '1002912_ABCDEF';

function sourceDoc(over) {
  return {
    contentHash: HASH, eTag: 'etag-1', library: 'akoya_request', mimeType: 'application/pdf',
    size: 1000, versionId: '1.0', ...over,
  };
}

function plan(documents, layout = null) {
  return compileBasicCloneFilePlan({
    filePolicy: { allowedMimeTypes: ['application/pdf'], maxFileBytes: 20_000_000, maxFiles: 7, maxTotalBytes: 40_000_000 },
    sourceDocuments: documents,
    sourceRequestNumber: '1002912',
    destinationRequestNumber: '1000400',
    ...(layout ? { destinationLayout: layout } : {}),
  }, { selectedDocumentIds: documents.map((document) => document.id) });
}

describe('the planner accepts the Phase II originals', () => {
  const phaseII = [
    sourceDoc({ id: 'n', kind: 'proposalNarrative', folder: `${ROOT}/Phase II`, name: 'Project Narrative.pdf' }),
    sourceDoc({ id: 'b', kind: 'proposalBibliography', folder: `${ROOT}/Phase II`, name: 'Bibliography.pdf' }),
  ];

  test('copied to the J27 destinations in Submission-Documents', () => {
    const result = plan(phaseII, 'single-submission');
    expect(result.blockers).toEqual([]);
    expect(result.plannedFiles.map((file) => [file.kind, file.destination.folder, file.destination.filename]).sort()).toEqual([
      ['proposalBibliography', 'Submission-Documents', 'Bibliography_1000400.pdf'],
      ['proposalNarrative', 'Submission-Documents', 'Project-Narrative_1000400.pdf'],
    ]);
  });

  test('copied to the D26 destinations in AI Materials', () => {
    const result = plan(phaseII);
    expect(result.blockers).toEqual([]);
    expect(result.plannedFiles.map((file) => file.destination.filename).sort())
      .toEqual(['ProposalBibliography_1000400.pdf', 'ProposalNarrative_1000400.pdf']);
  });

  test('the AI Materials copies are still accepted (fallback)', () => {
    const result = plan([
      sourceDoc({ id: 'n', kind: 'proposalNarrative', folder: `${ROOT}/AI Materials`, name: 'ProposalNarrative_1002912.pdf' }),
    ]);
    expect(result.blockers).toEqual([]);
  });

  test.each([
    ['a Phase II name in AI Materials', `${ROOT}/AI Materials`, 'Project Narrative.pdf'],
    ['an AI Materials name in Phase II', `${ROOT}/Phase II`, 'ProposalNarrative_1002912.pdf'],
    ['the Phase II name in Phase I', `${ROOT}/Phase I`, 'Project Narrative.pdf'],
    ['a look-alike name', `${ROOT}/Phase II`, 'Project Narrative (1).pdf'],
  ])('refuses %s', (_label, folder, name) => {
    const result = plan([sourceDoc({ id: 'n', kind: 'proposalNarrative', folder, name })]);
    expect(result.blockers.map((item) => item.code)).toContain('SOURCE_DOCUMENT_MISMATCH');
  });
});

describe('the lookup prefers Phase II and falls back to AI Materials', () => {
  function discover(files) {
    return discoverTestRequestSourceDocuments({ akoya_requestid: 'req-1', akoya_requestnum: '1002912' }, {
      getRequestSharePointBuckets: jest.fn(async () => [{ library: 'akoya_request', folder: ROOT, source: 'active' }]),
      listFiles: jest.fn(async () => files.map(([folder, name], index) => ({
        id: `item-${index}`, folder: `${ROOT}/${folder}`, name, size: 10, mimeType: 'application/pdf',
      }))),
    });
  }

  test('with both present, only the Phase II originals are offered', async () => {
    const { documents } = await discover([
      ['AI Materials', 'ProposalNarrative_1002912.pdf'],
      ['AI Materials', 'ProposalBibliography_1002912.pdf'],
      ['Phase II', 'Project Narrative.pdf'],
      ['Phase II', 'Bibliography.pdf'],
    ]);
    const byKind = Object.fromEntries(documents.map((document) => [document.kind, document]));
    expect(documents.filter((document) => document.kind === 'proposalNarrative')).toHaveLength(1);
    expect(byKind.proposalNarrative).toMatchObject({ name: 'Project Narrative.pdf', label: 'Proposal narrative (Phase II original)' });
    expect(byKind.proposalBibliography).toMatchObject({ name: 'Bibliography.pdf' });
    expect(documents.some((document) => 'preferred' in document)).toBe(false);
  });

  test('a kind without a Phase II original falls back to its AI Materials copy', async () => {
    const { documents } = await discover([
      ['AI Materials', 'ProposalNarrative_1002912.pdf'],
      ['AI Materials', 'ProposalBibliography_1002912.pdf'],
      ['Phase II', 'Bibliography.pdf'],
    ]);
    const names = documents.map((document) => document.name).sort();
    expect(names).toEqual(['Bibliography.pdf', 'ProposalNarrative_1002912.pdf']);
  });

  test('other Phase II files are not offered', async () => {
    const { documents } = await discover([['Phase II', 'Budget.pdf'], ['Phase II', 'Project Narrative.docx']]);
    expect(documents).toEqual([]);
  });
});

describe('one source per kind, across libraries and folders (Codex findings)', () => {
  const ARCHIVE_ROOT = '1002912_ARCHIVE';
  function discoverBuckets(byBucket) {
    return discoverTestRequestSourceDocuments({ akoya_requestid: 'req-1', akoya_requestnum: '1002912' }, {
      getRequestSharePointBuckets: jest.fn(async () => [
        { library: 'akoya_request', folder: ROOT, source: 'active' },
        { library: 'RequestArchive1', folder: ARCHIVE_ROOT, source: 'archive' },
      ]),
      listFiles: jest.fn(async (library, folder) => (byBucket[library] || []).map(([sub, name], index) => ({
        id: `${library}-${index}`, folder: `${folder}/${sub}`, name, size: 10, mimeType: 'application/pdf',
      }))),
    });
  }

  test('a Phase II original in both libraries offers only the active one', async () => {
    const { documents } = await discoverBuckets({
      akoya_request: [['Phase II', 'Project Narrative.pdf']],
      RequestArchive1: [['Phase II', 'Project Narrative.pdf']],
    });
    expect(documents.filter((d) => d.kind === 'proposalNarrative').map((d) => d.library)).toEqual(['akoya_request']);
  });

  test('an archive Phase II original beats an active AI Materials copy', async () => {
    const { documents } = await discoverBuckets({
      akoya_request: [['AI Materials', 'ProposalNarrative_1002912.pdf']],
      RequestArchive1: [['Phase II', 'Project Narrative.pdf']],
    });
    expect(documents.filter((d) => d.kind === 'proposalNarrative').map((d) => [d.library, d.name]))
      .toEqual([['RequestArchive1', 'Project Narrative.pdf']]);
  });

  test('a nested copy of Phase II is not a source', async () => {
    const { documents } = await discoverBuckets({
      akoya_request: [['backup/Phase II', 'Project Narrative.pdf'], ['AI Materials', 'ProposalNarrative_1002912.pdf']],
    });
    expect(documents.filter((d) => d.kind === 'proposalNarrative').map((d) => d.name)).toEqual(['ProposalNarrative_1002912.pdf']);
  });
});
