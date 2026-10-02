/** @jest-environment node */

const mockListFiles = jest.fn();
const mockGetBuckets = jest.fn();
const mockFilter = jest.fn();
const mockCreateFilter = jest.fn();

jest.mock('../../lib/services/dynamics-explorer/tools/get-entity', () => ({ getEntity: jest.fn() }));
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: (...args) => mockGetBuckets(...args),
}));
jest.mock('../../lib/services/graph-service', () => ({
  GraphService: { listFiles: (...args) => mockListFiles(...args) },
}));
jest.mock('../../lib/services/site-visit-materials/recursive-reader-filter.js', () => ({
  createSiteVisitMaterialsRecursiveReaderFilter: (...args) => mockCreateFilter(...args),
}));

import { listDocuments } from '../../lib/services/dynamics-explorer/tools/documents.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBuckets.mockResolvedValue([
    { library: 'RequestArchive1', folder: '1001_root', source: 'archive' },
  ]);
  mockListFiles.mockResolvedValue([{ id: 'old', name: 'old.pptx', folder: '1001_root/Site Visit - Slides' }]);
  mockCreateFilter.mockReturnValue(mockFilter);
  mockFilter.mockImplementation(async () => ({
    files: [],
    omittedFiles: [{ id: 'old', name: 'old.pptx' }],
    error: { code: 'site_visit_materials_status_unavailable', message: 'Site Visit status unavailable.' },
  }));
});

test('retains a sanitized status error for an empty archive bucket after candidate files are omitted', async () => {
  const result = await listDocuments({ request_id: REQUEST_ID, request_number: '1001' });

  expect(result.documentCount).toBe(0);
  expect(result.libraries).toEqual([{
    library: 'RequestArchive1',
    folder: '1001_root',
    count: 0,
    error: 'Site Visit status unavailable.',
  }]);
});
