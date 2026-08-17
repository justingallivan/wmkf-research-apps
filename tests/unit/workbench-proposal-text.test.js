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
const downloadFile = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    getFileMetadataByPath: (...args) => getFileMetadataByPath(...args),
    downloadFile: (...args) => downloadFile(...args),
  },
}));

const extractTextFromBuffer = jest.fn();
jest.mock('../../lib/utils/file-loader', () => ({
  extractTextFromBuffer: (...args) => extractTextFromBuffer(...args),
}));

import {
  expectedProposalBibliographyFilename,
  expectedProposalNarrativeFilename,
  getAiProposalMaterialsText,
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
  getFileMetadataByPath.mockImplementation(async (_library, _folder, filename) => ({
    id: filename.startsWith('ProposalNarrative_') ? 'narrative-item' : 'bibliography-item',
    name: filename,
    siteId: 'site-id',
    driveId: 'drive-id',
    versionId: filename.startsWith('ProposalNarrative_') ? 'narrative-v1' : 'bibliography-v1',
    mimeType: 'application/pdf',
  }));
  downloadFile.mockImplementation(async (_driveId, itemId) => ({
    buffer: Buffer.from(itemId === 'narrative-item'
      ? '%PDF-narrative'
      : '%PDF-bibliography'),
    mimeType: 'application/pdf',
    filename: itemId === 'narrative-item'
      ? 'ProposalNarrative_1003109.pdf'
      : 'ProposalBibliography_1003109.pdf',
  }));
  extractTextFromBuffer.mockImplementation(async (_buffer, filename) => (
    filename.startsWith('ProposalNarrative_')
      ? 'Phase II proposal narrative text'
      : 'References and bibliography text'
  ));
});

test('builds the exact request-bound narrative filename', () => {
  expect(expectedProposalNarrativeFilename(' 1003109 '))
    .toBe('ProposalNarrative_1003109.pdf');
  expect(expectedProposalNarrativeFilename('')).toBeNull();
});

test('builds the exact request-bound bibliography filename', () => {
  expect(expectedProposalBibliographyFilename(' 1003109 '))
    .toBe('ProposalBibliography_1003109.pdf');
  expect(expectedProposalBibliographyFilename('')).toBeNull();
});

test('downloads and extracts the exact narrative in the positively resolved active request folder', async () => {
  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toEqual({
    text: 'Phase II proposal narrative text',
    filename: 'ProposalNarrative_1003109.pdf',
    siteId: 'site-id',
    driveId: 'drive-id',
    itemId: 'narrative-item',
    versionId: 'narrative-v1',
    contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
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
  expect(downloadFile).toHaveBeenCalledWith(
    'drive-id',
    'narrative-item',
  );
});

test('loads narrative and bibliography separately from the exact AI Materials names', async () => {
  const materials = await getAiProposalMaterialsText('request-id', '1003109');

  expect(materials).toMatchObject({
    narrative: {
      filename: 'ProposalNarrative_1003109.pdf',
      text: 'Phase II proposal narrative text',
      itemId: 'narrative-item',
      versionId: 'narrative-v1',
    },
    bibliography: {
      filename: 'ProposalBibliography_1003109.pdf',
      text: 'References and bibliography text',
      itemId: 'bibliography-item',
      versionId: 'bibliography-v1',
    },
  });
  expect(getFileMetadataByPath.mock.calls).toEqual(expect.arrayContaining([
    ['akoya_request', '1003109_GUID/AI Materials', 'ProposalNarrative_1003109.pdf'],
    ['akoya_request', '1003109_GUID/AI Materials', 'ProposalBibliography_1003109.pdf'],
  ]));
  expect(downloadFile).toHaveBeenCalledTimes(2);
});

test('surfaces a missing bibliography without substituting another PDF', async () => {
  getFileMetadataByPath.mockImplementation(async (_library, _folder, filename) => (
    filename === 'ProposalNarrative_1003109.pdf'
      ? {
        id: 'narrative-item',
        name: filename,
        siteId: 'site-id',
        driveId: 'drive-id',
        versionId: 'narrative-v1',
      }
      : null
  ));

  await expect(getAiProposalMaterialsText('request-id', '1003109')).resolves.toMatchObject({
    narrative: { filename: 'ProposalNarrative_1003109.pdf' },
    bibliography: null,
  });
  expect(downloadFile).toHaveBeenCalledTimes(1);
});

test('discards bytes when the SharePoint version changes during download', async () => {
  getFileMetadataByPath
    .mockResolvedValueOnce({
      id: 'narrative-item',
      name: 'ProposalNarrative_1003109.pdf',
      siteId: 'site-id',
      driveId: 'drive-id',
      versionId: 'narrative-v1',
    })
    .mockResolvedValueOnce({
      id: 'narrative-item',
      name: 'ProposalNarrative_1003109.pdf',
      siteId: 'site-id',
      driveId: 'drive-id',
      versionId: 'narrative-v2',
    });

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFile).toHaveBeenCalledTimes(1);
  expect(extractTextFromBuffer).not.toHaveBeenCalled();
});

test('discards bytes when the SharePoint eTag changes without a version-label change', async () => {
  getFileMetadataByPath
    .mockResolvedValueOnce({
      id: 'narrative-item',
      name: 'ProposalNarrative_1003109.pdf',
      siteId: 'site-id',
      driveId: 'drive-id',
      versionId: 'narrative-v1',
      eTag: 'etag-before',
    })
    .mockResolvedValueOnce({
      id: 'narrative-item',
      name: 'ProposalNarrative_1003109.pdf',
      siteId: 'site-id',
      driveId: 'drive-id',
      versionId: 'narrative-v1',
      eTag: 'etag-after',
    });

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFile).toHaveBeenCalledTimes(1);
  expect(extractTextFromBuffer).not.toHaveBeenCalled();
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
  expect(downloadFile).not.toHaveBeenCalled();
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
  expect(downloadFile).not.toHaveBeenCalled();
});

test('fails closed before Graph lookup when more than one active request folder resolves', async () => {
  getRequestSharePointBuckets.mockResolvedValue([
    ACTIVE_BUCKET,
    { ...ACTIVE_BUCKET, folder: '1003109_OTHER' },
  ]);

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(getFileMetadataByPath).not.toHaveBeenCalled();
  expect(downloadFile).not.toHaveBeenCalled();
});

test('fails closed when Graph resolves a differently cased or named file', async () => {
  getFileMetadataByPath.mockResolvedValue({
    id: 'wrong-name',
    name: 'proposalNarrative_1003109.pdf',
  });

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFile).not.toHaveBeenCalled();
});
