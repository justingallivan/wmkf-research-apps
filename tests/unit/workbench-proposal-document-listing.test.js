/**
 * @jest-environment node
 */

const listFiles = jest.fn();
const mockSiteVisitFilter = jest.fn();
const mockCreateSiteVisitFilter = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: (...args) => listFiles(...args) },
}));
jest.mock('../../lib/services/site-visit-materials/recursive-reader-filter.js', () => ({
  createSiteVisitMaterialsRecursiveReaderFilter: (...args) => mockCreateSiteVisitFilter(...args),
}));

const getRequestSharePointBuckets = jest.fn();
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: (...args) => getRequestSharePointBuckets(...args),
}));

const getProposalDocumentConfig = jest.fn();
jest.mock('../../shared/config/workbenchProposalDocuments', () => ({
  getProposalDocumentConfig: (...args) => getProposalDocumentConfig(...args),
}));

import { listProposalDocuments } from '../../lib/services/workbench-proposal-documents';

const REQUEST_ID = '54e2b88b-04b9-f011-bbd3-6045bd02b4cc';
const REQUEST_NUMBER = '1002379';
const ROOT = '1002379_54E2B88B04B9F011BBD36045BD02B4CC';
const ACTIVE = { library: 'akoya_request', folder: ROOT, source: 'dynamics' };
const ARCHIVES = ['RequestArchive1', 'RequestArchive2', 'RequestArchive3'].map((library) => ({
  library,
  folder: ROOT,
  source: 'archive',
}));
let consoleError;

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateSiteVisitFilter.mockReturnValue(mockSiteVisitFilter);
  mockSiteVisitFilter.mockImplementation(async (_library, _folder, files) => ({
    files,
    omittedFiles: [],
    error: null,
  }));
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE, ...ARCHIVES]);
  getProposalDocumentConfig.mockReturnValue({
    phaseFolder: 'Phase I',
    excludeFilenames: [],
    slots: [
      { key: 'projectDescription', label: 'Project Description', filename: 'ProjectDescription.pdf' },
    ],
  });
});

afterEach(() => {
  consoleError.mockRestore();
});

test('surfaces only the two exact canonical AI Materials files and ignores expected archive 404s', async () => {
  listFiles.mockImplementation(async (library) => {
    if (library !== 'akoya_request') {
      throw new Error(`Failed to list files in ${library}/${ROOT} (404): itemNotFound`);
    }
    return [
      { name: 'ProjectDescription.pdf', folder: `${ROOT}/Phase I`, size: 10, mimeType: 'application/pdf' },
      { name: 'Proposal_1002379.pdf', folder: `${ROOT}/Phase II`, size: 15, mimeType: 'application/pdf' },
      { name: 'Appendix.pdf', folder: `${ROOT}/Phase II/Supporting`, size: 16, mimeType: 'application/pdf' },
      { name: 'ProposalNarrative_1002379.pdf', folder: `${ROOT}/AI Materials`, size: 20, mimeType: 'application/pdf' },
      { name: 'ProposalBibliography_1002379.pdf', folder: `${ROOT}/AI Materials`, size: 30, mimeType: 'application/pdf' },
      { name: 'Proposal_1002379.pdf', folder: `${ROOT}/AI Materials`, size: 40, mimeType: 'application/pdf' },
    ];
  });

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(listFiles).toHaveBeenCalledWith('akoya_request', ROOT, expect.objectContaining({
    recursive: true,
    excludeApplicantMaterialsBackgroundUploads: true,
  }));
  expect(mockCreateSiteVisitFilter).toHaveBeenCalledWith(REQUEST_ID, REQUEST_NUMBER);
  expect(mockSiteVisitFilter).toHaveBeenCalledWith('akoya_request', ROOT, expect.any(Array));
  expect(result.errors).toEqual([]);
  expect(result.slots[0]).toMatchObject({ found: true, name: 'ProjectDescription.pdf' });
  expect(result.phaseIIDocuments).toEqual([
    expect.objectContaining({
      name: 'Proposal_1002379.pdf',
      library: 'akoya_request',
      folder: `${ROOT}/Phase II`,
    }),
    expect.objectContaining({
      name: 'Appendix.pdf',
      library: 'akoya_request',
      folder: `${ROOT}/Phase II/Supporting`,
    }),
  ]);
  expect(result.aiMaterials).toEqual([
    expect.objectContaining({
      key: 'proposalNarrative',
      label: 'Proposal Narrative',
      filename: 'ProposalNarrative_1002379.pdf',
      found: true,
      library: 'akoya_request',
      folder: `${ROOT}/AI Materials`,
      name: 'ProposalNarrative_1002379.pdf',
    }),
    expect.objectContaining({
      key: 'proposalBibliography',
      label: 'Proposal Bibliography',
      filename: 'ProposalBibliography_1002379.pdf',
      found: true,
      library: 'akoya_request',
      folder: `${ROOT}/AI Materials`,
      name: 'ProposalBibliography_1002379.pdf',
    }),
  ]);
  expect(result.otherDocuments).toEqual([]);
});

test('surfaces only the exact reviewer PDF while excluding internal and wrong-request files beside it', async () => {
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE]);
  listFiles.mockResolvedValue([
    { name: 'Proposal_1002379.pdf', folder: `${ROOT}/Reviewer Materials`, size: 40, mimeType: 'application/pdf' },
    { name: 'Research Phase I Application_20260818.pdf', folder: `${ROOT}/Reviewer Materials`, size: 50, mimeType: 'application/pdf' },
    { name: 'Proposal_1009999.pdf', folder: `${ROOT}/Reviewer Materials`, size: 60, mimeType: 'application/pdf' },
    { name: 'Proposal_1002379.pdf', folder: `${ROOT}/Reviewer Materials/Internal`, size: 70, mimeType: 'application/pdf' },
  ]);

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(result.reviewerMaterials).toEqual([
    {
      name: 'Proposal_1002379.pdf',
      library: 'akoya_request',
      folder: `${ROOT}/Reviewer Materials`,
      size: 40,
      mimeType: 'application/pdf',
    },
  ]);
});

test('returns an empty Phase II collection when the folder has no files', async () => {
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE]);
  listFiles.mockResolvedValue([
    { name: 'ProjectDescription.pdf', folder: `${ROOT}/Phase I`, mimeType: 'application/pdf' },
  ]);

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(result.phaseIIDocuments).toEqual([]);
});

test('wrong filename casing or a nested folder does not masquerade as a canonical AI input', async () => {
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE]);
  listFiles.mockResolvedValue([
    { name: 'proposalNarrative_1002379.pdf', folder: `${ROOT}/AI Materials`, mimeType: 'application/pdf' },
    { name: 'ProposalBibliography_1002379.pdf', folder: `${ROOT}/AI Materials/Old`, mimeType: 'application/pdf' },
  ]);

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(result.aiMaterials).toEqual([
    expect.objectContaining({ key: 'proposalNarrative', found: false }),
    expect.objectContaining({ key: 'proposalBibliography', found: false }),
  ]);
});

test('active-folder failures and non-404 archive failures still surface as warnings', async () => {
  listFiles.mockImplementation(async (library) => {
    if (library === 'akoya_request') {
      throw new Error(`Failed to list files in ${library}/${ROOT} (404): itemNotFound`);
    }
    if (library === 'RequestArchive1') {
      throw new Error(`Failed to list files in ${library}/${ROOT} (404): itemNotFound`);
    }
    if (library === 'RequestArchive2') {
      throw new Error(`Failed to list files in ${library}/${ROOT} (403): accessDenied`);
    }
    return [];
  });

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(result.errors).toEqual([
    { library: 'akoya_request', folder: ROOT },
    { library: 'RequestArchive2', folder: ROOT },
  ]);
  expect(result.aiMaterials.every((item) => item.found === false)).toBe(true);
});

test('multiple active request roots fail closed for canonical AI Materials display', async () => {
  const second = { library: 'akoya_request', folder: `${ROOT}_DUPLICATE`, source: 'dynamics' };
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE, second]);
  listFiles.mockImplementation(async (_library, folder) => ([
    { name: 'ProposalNarrative_1002379.pdf', folder: `${folder}/AI Materials`, mimeType: 'application/pdf' },
    { name: 'ProposalBibliography_1002379.pdf', folder: `${folder}/AI Materials`, mimeType: 'application/pdf' },
  ]));

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(result.aiMaterials.every((item) => item.found === false)).toBe(true);
});


test('reports material-status uncertainty while retaining unrelated proposal files', async () => {
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE]);
  const candidate = { id: 'uncertain', name: 'Presentation.pptx', folder: `${ROOT}/Site Visit - Slides` };
  const proposal = { id: 'proposal', name: 'ProjectDescription.pdf', folder: `${ROOT}/Phase I` };
  listFiles.mockResolvedValue([candidate, proposal]);
  mockSiteVisitFilter.mockResolvedValueOnce({
    files: [proposal], omittedFiles: [candidate],
    error: { code: 'site_visit_materials_status_unavailable', message: 'Status unavailable.' },
  });

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'D26');

  expect(result.errors).toEqual([{ library: ACTIVE.library, folder: ROOT }]);
  expect(result.slots[0]).toMatchObject({ found: true, name: proposal.name });
});

test('J27 GOApply names fill the AI Materials slots; both D26 and J27 names present fails closed', async () => {
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE]);
  listFiles.mockResolvedValue([
    { name: 'Project-Narrative_1002379.pdf', folder: `${ROOT}/AI Materials`, mimeType: 'application/pdf' },
    { name: 'Bibliography_1002379.pdf', folder: `${ROOT}/AI Materials`, mimeType: 'application/pdf' },
    { name: 'ProposalBibliography_1002379.pdf', folder: `${ROOT}/AI Materials`, mimeType: 'application/pdf' },
  ]);

  const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'J27');

  expect(result.aiMaterials).toEqual([
    expect.objectContaining({ key: 'proposalNarrative', found: true, name: 'Project-Narrative_1002379.pdf', filename: 'Project-Narrative_1002379.pdf' }),
    expect.objectContaining({ key: 'proposalBibliography', found: false, filename: 'ProposalBibliography_1002379.pdf' }),
  ]);
});

describe('single-submission layout (J27 onward)', () => {
  const AI = `${ROOT}/AI Materials`;
  const pdf = (name, folder = AI) => ({ name, folder, mimeType: 'application/pdf' });

  beforeEach(() => {
    getRequestSharePointBuckets.mockResolvedValue([ACTIVE]);
    getProposalDocumentConfig.mockReturnValue({
      layout: 'single-submission',
      phaseFolder: null,
      excludeFilenames: [],
      slots: [],
    });
  });

  test('lists the six individual files in order and leaves the front matter out', async () => {
    listFiles.mockResolvedValue([
      pdf('Project-Narrative_1002379.pdf'),
      pdf('Bibliography_1002379.pdf'),
      pdf('Biosketches_1002379.pdf'),
      pdf('Other-Support_1002379.pdf'),
      pdf('Collaboration-Letters_1002379.pdf'),
      { name: 'Graphical-Abstract_1002379.png', folder: AI, mimeType: 'image/png' },
      pdf('PhaseI-Cover-Page_1002379.pdf'),
      pdf('Abstract_1002379.pdf'),
      pdf('Graphical-Abstract-Page_1002379.pdf'),
    ]);

    const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'J27');

    expect(result.layout).toBe('single-submission');
    expect(result.slots).toEqual([]);
    expect(result.otherDocuments).toEqual([]);
    expect(result.aiMaterials.map((item) => [item.label, item.found, item.name])).toEqual([
      ['Project Narrative', true, 'Project-Narrative_1002379.pdf'],
      ['Bibliography', true, 'Bibliography_1002379.pdf'],
      ['Biosketches', true, 'Biosketches_1002379.pdf'],
      ['Other Support', true, 'Other-Support_1002379.pdf'],
      ['Collaboration Letters', true, 'Collaboration-Letters_1002379.pdf'],
      ['Graphical Abstract', true, 'Graphical-Abstract_1002379.png'],
    ]);
    expect(result.aiMaterials[2]).toMatchObject({ library: 'akoya_request', folder: AI });
  });

  test('a missing file is reported as not found, with the name that is expected', async () => {
    listFiles.mockResolvedValue([pdf('Project-Narrative_1002379.pdf')]);

    const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'J27');

    expect(result.aiMaterials.map((item) => [item.key, item.found, item.filename])).toEqual([
      ['proposalNarrative', true, 'Project-Narrative_1002379.pdf'],
      ['proposalBibliography', false, 'Bibliography_1002379.pdf'],
      ['biosketches', false, 'Biosketches_1002379.pdf'],
      ['otherSupport', false, 'Other-Support_1002379.pdf'],
      ['collaborationLetters', false, 'Collaboration-Letters_1002379.pdf'],
      ['graphicalAbstract', false, null],
    ]);
  });

  test('the graphical abstract page is not taken for the graphical abstract; two images are ambiguous', async () => {
    listFiles.mockResolvedValue([pdf('Graphical-Abstract-Page_1002379.pdf')]);
    let result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'J27');
    expect(result.aiMaterials.find((item) => item.key === 'graphicalAbstract').found).toBe(false);

    listFiles.mockResolvedValue([
      { name: 'Graphical-Abstract_1002379.png', folder: AI },
      { name: 'Graphical-Abstract_1002379.jpg', folder: AI },
    ]);
    result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'J27');
    expect(result.aiMaterials.find((item) => item.key === 'graphicalAbstract').found).toBe(false);
  });

  test('files outside the active AI Materials folder, another request\'s files and both narrative names do not fill a row', async () => {
    listFiles.mockResolvedValue([
      pdf('Biosketches_1002379.pdf', `${ROOT}/Submission-Documents`),
      pdf('Other-Support_1009999.pdf'),
      pdf('Project-Narrative_1002379.pdf'),
      pdf('ProposalNarrative_1002379.pdf'),
    ]);

    const result = await listProposalDocuments(REQUEST_ID, REQUEST_NUMBER, 'J27');

    expect(result.aiMaterials.every((item) => item.found === false)).toBe(true);
    // No phase folder is configured, so nothing is swept into "Other documents".
    expect(result.otherDocuments).toEqual([]);
  });
});
