/**
 * Governed proposal-text ingestion must use the exact AI narrative and must
 * not fall back to the reviewer package, D26 Phase I slots, or archives.
 *
 * @jest-environment node
 */

const getRequestSharePointBuckets = jest.fn();
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: (...args) => getRequestSharePointBuckets(...args),
}));

const getFileMetadataByPath = jest.fn();
const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    getFileMetadataByPath: (...args) => getFileMetadataByPath(...args),
    downloadFileByPath: (...args) => downloadFileByPath(...args),
  },
}));

const extractTextFromBuffer = jest.fn();
jest.mock('../../lib/utils/file-loader', () => ({
  extractTextFromBuffer: (...args) => extractTextFromBuffer(...args),
}));

import {
  expectedProposalNarrativeFilename,
  getAiProposalNarrativeText,
} from '../../lib/services/workbench-proposal-documents';

const ACTIVE_BUCKET = {
  library: 'akoya_request',
  folder: '1003109_GUID',
  source: 'dynamics',
};

beforeEach(() => {
  jest.clearAllMocks();
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE_BUCKET]);
  getFileMetadataByPath.mockResolvedValue({
    id: 'narrative-item',
    name: 'ProposalNarrative_1003109.pdf',
    mimeType: 'application/pdf',
  });
  downloadFileByPath.mockResolvedValue({
    buffer: Buffer.from('%PDF-narrative'),
    mimeType: 'application/pdf',
  });
  extractTextFromBuffer.mockResolvedValue('Phase II proposal narrative text');
});

test('builds the exact request-bound narrative filename', () => {
  expect(expectedProposalNarrativeFilename(' 1003109 '))
    .toBe('ProposalNarrative_1003109.pdf');
  expect(expectedProposalNarrativeFilename('')).toBeNull();
});

test('downloads and extracts the exact narrative in the positively resolved active request folder', async () => {
  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toEqual({
    text: 'Phase II proposal narrative text',
    filename: 'ProposalNarrative_1003109.pdf',
  });
  expect(getRequestSharePointBuckets).toHaveBeenCalledWith(
    'request-id',
    '1003109',
    { requireResolvedParents: true },
  );
  expect(getFileMetadataByPath).toHaveBeenCalledWith(
    'akoya_request',
    '1003109_GUID/AI Materials',
    'ProposalNarrative_1003109.pdf',
  );
  expect(downloadFileByPath).toHaveBeenCalledWith(
    'akoya_request',
    '1003109_GUID/AI Materials',
    'ProposalNarrative_1003109.pdf',
  );
});

test('does not substitute a present reviewer package when the AI narrative is absent', async () => {
  getFileMetadataByPath.mockImplementation(async (_library, folder, filename) => {
    if (folder.endsWith('/Reviewer Materials') && filename === 'Proposal_1003109.pdf') {
      return { name: filename, id: 'reviewer-package' };
    }
    return null;
  });

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(getFileMetadataByPath).toHaveBeenCalledTimes(1);
  expect(getFileMetadataByPath).toHaveBeenCalledWith(
    'akoya_request',
    '1003109_GUID/AI Materials',
    'ProposalNarrative_1003109.pdf',
  );
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(extractTextFromBuffer).not.toHaveBeenCalled();
});

test('ignores an archive narrative when the active narrative is absent', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    ACTIVE_BUCKET,
    {
      library: 'RequestArchive1',
      folder: '1003109_GUID',
      source: 'archive',
    },
  ]);
  getFileMetadataByPath.mockResolvedValue(null);

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(getFileMetadataByPath).toHaveBeenCalledTimes(1);
  expect(getFileMetadataByPath).toHaveBeenCalledWith(
    'akoya_request',
    '1003109_GUID/AI Materials',
    'ProposalNarrative_1003109.pdf',
  );
  expect(downloadFileByPath).not.toHaveBeenCalled();
});

test('fails closed before Graph lookup when more than one active request folder resolves', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    ACTIVE_BUCKET,
    { ...ACTIVE_BUCKET, folder: '1003109_OTHER' },
  ]);

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(getFileMetadataByPath).not.toHaveBeenCalled();
  expect(downloadFileByPath).not.toHaveBeenCalled();
});

test('fails closed when Graph resolves a differently cased or named file', async () => {
  getFileMetadataByPath.mockResolvedValue({
    id: 'wrong-name',
    name: 'proposalNarrative_1003109.pdf',
  });

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFileByPath).not.toHaveBeenCalled();
});
