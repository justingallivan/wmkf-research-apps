/**
 * Automated proposal-text ingestion must use the exact canonical reviewer
 * package and must not fall back to the D26 Phase I Proposal-tab slots.
 *
 * @jest-environment node
 */

const listReviewerMaterials = jest.fn();
jest.mock('../../lib/external/reviewer-materials', () => ({
  listReviewerMaterials: (...args) => listReviewerMaterials(...args),
}));

const downloadFileByPath = jest.fn();
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: {
    downloadFileByPath: (...args) => downloadFileByPath(...args),
  },
}));

const extractTextFromBuffer = jest.fn();
jest.mock('../../lib/utils/file-loader', () => ({
  extractTextFromBuffer: (...args) => extractTextFromBuffer(...args),
}));

import { getProposalText } from '../../lib/services/workbench-proposal-documents';

beforeEach(() => {
  jest.clearAllMocks();
  downloadFileByPath.mockResolvedValue({
    buffer: Buffer.from('%PDF-canonical'),
    mimeType: 'application/pdf',
  });
  extractTextFromBuffer.mockResolvedValue('Canonical Phase II proposal text');
});

test('downloads and extracts the one active canonical reviewer proposal', async () => {
  listReviewerMaterials.mockResolvedValue([{
    id: 'item-1',
    name: 'Proposal_1003109.pdf',
    library: 'akoya_request',
    folder: '1003109_GUID/Reviewer Materials',
    source: 'dynamics',
    mimeType: 'application/pdf',
  }]);

  await expect(getProposalText('request-id', '1003109')).resolves.toEqual({
    text: 'Canonical Phase II proposal text',
    filename: 'Proposal_1003109.pdf',
  });
  expect(listReviewerMaterials).toHaveBeenCalledWith('request-id', '1003109');
  expect(downloadFileByPath).toHaveBeenCalledWith(
    'akoya_request',
    '1003109_GUID/Reviewer Materials',
    'Proposal_1003109.pdf',
  );
});

test('does not substitute an archive copy when the active canonical file is absent', async () => {
  listReviewerMaterials.mockResolvedValue([{
    id: 'archive-item',
    name: 'Proposal_1003109.pdf',
    library: 'RequestArchive1',
    folder: '1003109_GUID/Reviewer Materials',
    source: 'archive',
    mimeType: 'application/pdf',
  }]);

  await expect(getProposalText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(extractTextFromBuffer).not.toHaveBeenCalled();
});

test('fails closed when more than one active canonical proposal resolves', async () => {
  listReviewerMaterials.mockResolvedValue([
    {
      name: 'Proposal_1003109.pdf',
      library: 'akoya_request',
      folder: 'location-a/Reviewer Materials',
      source: 'dynamics',
    },
    {
      name: 'Proposal_1003109.pdf',
      library: 'akoya_request',
      folder: 'location-b/Reviewer Materials',
      source: 'dynamics',
    },
  ]);

  await expect(getProposalText('request-id', '1003109')).resolves.toBeNull();
  expect(downloadFileByPath).not.toHaveBeenCalled();
  expect(extractTextFromBuffer).not.toHaveBeenCalled();
});
