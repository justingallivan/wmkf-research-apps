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

const D26_NAMES = new Set(['ProposalNarrative_1003109.pdf', 'ProposalBibliography_1003109.pdf']);

const ACTIVE_BUCKET = {
  library: 'akoya_request',
  folder: '1003109_GUID',
  source: 'dynamics',
};

beforeEach(() => {
  jest.clearAllMocks();
  getRequestSharePointBuckets.mockResolvedValue([ACTIVE_BUCKET]);
  getFileMetadataByPath.mockImplementation(async (_library, _folder, filename) => (D26_NAMES.has(filename) ? {
    id: filename.startsWith('ProposalNarrative_') ? 'narrative-item' : 'bibliography-item',
    name: filename,
    siteId: 'site-id',
    driveId: 'drive-id',
    versionId: filename.startsWith('ProposalNarrative_') ? 'narrative-v1' : 'bibliography-v1',
    mimeType: 'application/pdf',
  } : null));
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
    .mockResolvedValueOnce(null)
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
    .mockResolvedValueOnce(null)
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
  expect(getFileMetadataByPath.mock.calls).toEqual([
    ['akoya_request', '1003109_GUID/AI Materials', 'ProposalNarrative_1003109.pdf'],
    ['akoya_request', '1003109_GUID/AI Materials', 'Project-Narrative_1003109.pdf'],
  ]);
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
  expect(getFileMetadataByPath.mock.calls).toEqual([
    ['akoya_request', '1003109_GUID/AI Materials', 'ProposalNarrative_1003109.pdf'],
    ['akoya_request', '1003109_GUID/AI Materials', 'Project-Narrative_1003109.pdf'],
  ]);
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
  getFileMetadataByPath.mockImplementation(async (_library, _folder, filename) => (
    filename === 'ProposalNarrative_1003109.pdf'
      ? { id: 'wrong-name', name: 'proposalNarrative_1003109.pdf' }
      : null
  ));

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFile).not.toHaveBeenCalled();
});

const J27_META = {
  'Project-Narrative_1003109.pdf': { id: 'narrative-item', versionId: 'narrative-v1' },
  'Bibliography_1003109.pdf': { id: 'bibliography-item', versionId: 'bibliography-v1' },
};

test('resolves the J27 GOApply names when they are the only accepted names present', async () => {
  getFileMetadataByPath.mockImplementation(async (_library, _folder, filename) => (
    J27_META[filename]
      ? { ...J27_META[filename], name: filename, siteId: 'site-id', driveId: 'drive-id' }
      : null
  ));
  downloadFile.mockImplementation(async (_driveId, itemId) => ({
    buffer: Buffer.from(`%PDF-${itemId}`),
    mimeType: 'application/pdf',
    filename: itemId === 'narrative-item' ? 'Project-Narrative_1003109.pdf' : 'Bibliography_1003109.pdf',
  }));

  await expect(getAiProposalMaterialsText('request-id', '1003109')).resolves.toMatchObject({
    narrative: { filename: 'Project-Narrative_1003109.pdf', itemId: 'narrative-item' },
    bibliography: { filename: 'Bibliography_1003109.pdf', itemId: 'bibliography-item' },
  });
});

test('fails closed when both the D26 and J27 narrative names are present', async () => {
  getFileMetadataByPath.mockImplementation(async (_library, _folder, filename) => ({
    id: `item-${filename}`,
    name: filename,
    siteId: 'site-id',
    driveId: 'drive-id',
    versionId: 'v1',
  }));

  await expect(getAiProposalNarrativeText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFile).not.toHaveBeenCalled();
});
