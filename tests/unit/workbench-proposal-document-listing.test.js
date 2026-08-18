/**
 * @jest-environment node
 */

const listFiles = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: (...args) => listFiles(...args) },
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
