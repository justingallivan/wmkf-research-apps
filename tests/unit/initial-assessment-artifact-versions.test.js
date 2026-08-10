/**
 * @jest-environment node
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  ENTITY_SET_NAME: 'akoya_requests',
  getById: jest.fn(),
  findByIds: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  ENTITY_SET_NAME: 'wmkf_requestdocuments',
  findByGenerationKey: jest.fn(),
  findByRequest: jest.fn(),
  findByCycle: jest.fn(),
  findArtifactCycles: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/changeset.js', () => ({ runChangeset: jest.fn() }));
jest.mock('../../lib/services/execute-prompt.js', () => ({ executePrompt: jest.fn() }));
jest.mock('../../lib/services/workbench-proposal-documents.js', () => ({
  getProposalText: jest.fn(),
}));
jest.mock('../../lib/services/graph-service.js', () => ({
  GraphService: {
    getFileMetadataById: jest.fn(),
    getFileMetadataByPath: jest.fn(),
    ensureFolderPath: jest.fn(),
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    deleteFile: jest.fn(),
    listFileVersions: jest.fn(),
  },
}));
jest.mock('../../lib/utils/sharepoint-buckets.js', () => ({
  getRequestSharePointBuckets: jest.fn(),
}));
jest.mock('../../lib/services/initial-assessment/template.js', () => ({
  renderInitialAssessmentDocx: jest.fn(),
}));

import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { listInitialAssessmentArtifactVersions } from '../../lib/services/initial-assessment/artifact-service.js';
import {
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function readyRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: '44444444-4444-4444-4444-444444444444',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_sharepointsiteid: 'site-from-registry',
    wmkf_sharepointdriveid: 'drive-from-registry',
    wmkf_sharepointitemid: 'item-from-registry',
    createdon: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [readyRow()] });
  GraphService.listFileVersions.mockResolvedValue({
    versions: [
      { versionId: '3.0', lastModified: '2026-08-03T00:00:00Z', lastModifiedBy: 'Justin Gallivan' },
      { versionId: '2.0', lastModified: '2026-08-02T00:00:00Z', lastModifiedBy: 'Justin Gallivan' },
    ],
    hasMore: false,
    limit: 20,
  });
});

it('reads drive and item identity from the registry row, never from the caller', async () => {
  await listInitialAssessmentArtifactVersions({
    requestId: REQUEST_ID,
    // A caller attempting to redirect the read at an arbitrary SharePoint item.
    driveId: 'attacker-drive',
    itemId: 'attacker-item',
  });

  expect(GraphService.listFileVersions).toHaveBeenCalledWith(
    'drive-from-registry',
    'item-from-registry',
    expect.objectContaining({ siteId: 'site-from-registry' }),
  );
});

it('rejects a non-GUID requestId before any adapter call', async () => {
  await expect(
    listInitialAssessmentArtifactVersions({ requestId: "1' or '1'='1" }),
  ).rejects.toMatchObject({ httpStatus: 400 });
  expect(requestDocumentAdapter.findByRequest).not.toHaveBeenCalled();
});

it('404s when the request has no Ready artifact', async () => {
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [readyRow({ wmkf_operationstatus: 100000000 })],
  });

  await expect(
    listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID }),
  ).rejects.toMatchObject({ httpStatus: 404 });
});

it('ignores a superseded row rather than reading its history', async () => {
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [readyRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED })],
  });

  await expect(
    listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID }),
  ).rejects.toMatchObject({ httpStatus: 404 });
  expect(GraphService.listFileVersions).not.toHaveBeenCalled();
});

it('marks only the newest version as current', async () => {
  const result = await listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID });

  expect(result.status).toBe('current');
  expect(result.versions.map((v) => [v.versionId, v.isCurrent])).toEqual([
    ['3.0', true],
    ['2.0', false],
  ]);
});

it('degrades to unavailable when Graph fails, instead of failing the request', async () => {
  GraphService.listFileVersions.mockRejectedValue(new Error('graph 503'));

  const result = await listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID });

  expect(result.status).toBe('unavailable');
  expect(result.versions).toEqual([]);
});

it('reports missing when the registered item is gone', async () => {
  GraphService.listFileVersions.mockResolvedValue(null);

  const result = await listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID });

  expect(result.status).toBe('missing');
});

it('reports unavailable without calling Graph when the row has no SharePoint identity', async () => {
  requestDocumentAdapter.findByRequest.mockResolvedValue({
    records: [readyRow({ wmkf_sharepointitemid: null })],
  });

  const result = await listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID });

  expect(result.status).toBe('unavailable');
  expect(GraphService.listFileVersions).not.toHaveBeenCalled();
});

it('propagates the truncation flag so a capped list is never shown as complete', async () => {
  GraphService.listFileVersions.mockResolvedValue({
    versions: [{ versionId: '3.0', lastModified: '2026-08-03T00:00:00Z' }],
    hasMore: true,
    limit: 1,
  });

  const result = await listInitialAssessmentArtifactVersions({ requestId: REQUEST_ID });

  expect(result.hasMore).toBe(true);
  expect(result.limit).toBe(1);
});
