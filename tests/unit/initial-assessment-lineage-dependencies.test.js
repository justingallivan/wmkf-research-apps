/**
 * @jest-environment node
 *
 * Test Request Factory slice 6b, Stage A, item 1: pins that
 * `commitReadyLineage`/`assertOwnedClaim`/`rereadByGenerationKey`
 * (lib/services/initial-assessment/artifact-lineage.js) and
 * `resolveCanonicalInitialAssessment`
 * (lib/services/initial-assessment/artifact-reader.js) call the SAME
 * module-level adapters they call today when no `dependencies` is passed,
 * and that a caller-supplied `dependencies` object fully replaces those
 * adapters (the seam Stage B's sandbox deps will use).
 */

jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  ENTITY_SET_NAME: 'akoya_requests',
  getById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  ENTITY_SET_NAME: 'wmkf_requestdocuments',
  findByGenerationKey: jest.fn(),
  findByRequest: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/changeset.js', () => ({
  runChangeset: jest.fn(),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { runChangeset } from '../../lib/dataverse/core/changeset.js';
import {
  assertOwnedClaim,
  commitReadyLineage,
  rereadByGenerationKey,
} from '../../lib/services/initial-assessment/artifact-lineage.js';
import { resolveCanonicalInitialAssessment } from '../../lib/services/initial-assessment/artifact-reader.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const ARTIFACT_ID = '44444444-4444-4444-4444-444444444444';

function baseRequest(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    _wmkf_currentinitialassessment_value: null,
    _etag: 'W/"request-1"',
    ...overrides,
  };
}

function baseRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: ARTIFACT_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: 'a'.repeat(64),
    wmkf_claimtoken: 'claim-1',
    _wmkf_request_value: REQUEST_ID,
    _etag: 'W/"row-1"',
    modifiedon: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('default dependencies (no dependencies argument) — pins today\'s wiring', () => {
  it('rereadByGenerationKey calls requestDocumentAdapter.findByGenerationKey directly', async () => {
    const row = baseRow();
    requestDocumentAdapter.findByGenerationKey.mockResolvedValue({ records: [row] });

    const result = await rereadByGenerationKey(row.wmkf_generationkey);

    expect(requestDocumentAdapter.findByGenerationKey).toHaveBeenCalledWith(row.wmkf_generationkey);
    expect(result).toEqual(row);
  });

  it('assertOwnedClaim calls requestDocumentAdapter.findByGenerationKey directly', async () => {
    const row = baseRow();
    requestDocumentAdapter.findByGenerationKey.mockResolvedValue({ records: [row] });

    const result = await assertOwnedClaim(row.wmkf_generationkey, row.wmkf_claimtoken);

    expect(requestDocumentAdapter.findByGenerationKey).toHaveBeenCalledWith(row.wmkf_generationkey);
    expect(result).toEqual(row);
  });

  it('resolveCanonicalInitialAssessment calls grantRequestAdapter.getById and requestDocumentAdapter.findByRequest directly', async () => {
    const row = baseRow({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'item',
    });
    const request = baseRequest({ _wmkf_currentinitialassessment_value: ARTIFACT_ID });
    grantRequestAdapter.getById.mockResolvedValue(request);
    requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [row] });

    const result = await resolveCanonicalInitialAssessment({ requestId: REQUEST_ID });

    expect(grantRequestAdapter.getById).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ select: expect.anything() }));
    expect(requestDocumentAdapter.findByRequest).toHaveBeenCalledWith(REQUEST_ID, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
    expect(result.row).toEqual(row);
  });

  it('commitReadyLineage drives its lineage activation through the module adapters and runChangeset', async () => {
    const state = {
      row: baseRow(),
      request: baseRequest(),
    };
    grantRequestAdapter.getById.mockImplementation(async () => ({ ...state.request }));
    requestDocumentAdapter.findByGenerationKey.mockImplementation(async () => ({
      records: [{ ...state.row }],
    }));
    requestDocumentAdapter.findByRequest.mockImplementation(async () => ({
      records: [{ ...state.row }],
    }));
    runChangeset.mockImplementation(async (operations) => {
      for (const operation of operations) {
        if (operation.entitySet === 'akoya_requests') {
          state.request._wmkf_currentinitialassessment_value = operation.body[
            'wmkf_CurrentInitialAssessment@odata.bind'
          ].match(/\(([^)]+)\)$/)[1];
        } else {
          Object.assign(state.row, operation.body);
        }
      }
      return { ok: true, operations };
    });

    const metadata = {
      siteId: 'site', driveId: 'drive', id: 'item',
      webUrl: 'https://example.sharepoint.com/item', versionId: '1.0', eTag: '"1"',
      size: 10, lastModified: '2026-07-29T12:00:00Z',
    };
    const result = await commitReadyLineage(state.row, { metadata, claimToken: 'claim-1' });

    expect(runChangeset).toHaveBeenCalledTimes(1);
    expect(result.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    expect(state.request._wmkf_currentinitialassessment_value).toBe(ARTIFACT_ID);
  });
});

describe('caller-supplied dependencies fully replace the module adapters', () => {
  it('rereadByGenerationKey/assertOwnedClaim never touch the module adapters when dependencies is supplied', async () => {
    const row = baseRow();
    const dependencies = {
      findByGenerationKey: jest.fn().mockResolvedValue({ records: [row] }),
    };

    await rereadByGenerationKey(row.wmkf_generationkey, dependencies);
    await assertOwnedClaim(row.wmkf_generationkey, row.wmkf_claimtoken, dependencies);

    expect(dependencies.findByGenerationKey).toHaveBeenCalledTimes(2);
    expect(requestDocumentAdapter.findByGenerationKey).not.toHaveBeenCalled();
  });

  it('resolveCanonicalInitialAssessment never touches the module adapters when dependencies is supplied', async () => {
    const row = baseRow({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_sharepointdriveid: 'drive',
      wmkf_sharepointitemid: 'item',
    });
    const request = baseRequest({ _wmkf_currentinitialassessment_value: ARTIFACT_ID });
    const dependencies = {
      getRequest: jest.fn().mockResolvedValue(request),
      findByRequest: jest.fn().mockResolvedValue({ records: [row] }),
    };

    const result = await resolveCanonicalInitialAssessment(
      { requestId: REQUEST_ID },
      { dependencies },
    );

    expect(dependencies.getRequest).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ select: expect.anything() }));
    expect(dependencies.findByRequest).toHaveBeenCalledWith(REQUEST_ID, {
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.INITIAL_ASSESSMENT,
    });
    expect(result.row).toEqual(row);
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
    expect(requestDocumentAdapter.findByRequest).not.toHaveBeenCalled();
  });

  it('commitReadyLineage drives its lineage activation entirely through a caller-supplied dependencies object', async () => {
    const state = {
      row: baseRow(),
      request: baseRequest(),
    };
    const dependencies = {
      getRequest: jest.fn(async () => ({ ...state.request })),
      findByGenerationKey: jest.fn(async () => ({ records: [{ ...state.row }] })),
      findByRequest: jest.fn(async () => ({ records: [{ ...state.row }] })),
      runChangeset: jest.fn(async (operations) => {
        for (const operation of operations) {
          if (operation.entitySet === 'akoya_requests') {
            state.request._wmkf_currentinitialassessment_value = operation.body[
              'wmkf_CurrentInitialAssessment@odata.bind'
            ].match(/\(([^)]+)\)$/)[1];
          } else {
            Object.assign(state.row, operation.body);
          }
        }
        return { ok: true, operations };
      }),
    };

    const metadata = {
      siteId: 'site', driveId: 'drive', id: 'item',
      webUrl: 'https://example.sharepoint.com/item', versionId: '1.0', eTag: '"1"',
      size: 10, lastModified: '2026-07-29T12:00:00Z',
    };
    const result = await commitReadyLineage(
      state.row,
      { metadata, claimToken: 'claim-1', dependencies },
    );

    expect(dependencies.runChangeset).toHaveBeenCalledTimes(1);
    expect(result.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    expect(state.request._wmkf_currentinitialassessment_value).toBe(ARTIFACT_ID);
    // Nothing routed through the module-level (production) adapters.
    expect(grantRequestAdapter.getById).not.toHaveBeenCalled();
    expect(requestDocumentAdapter.findByGenerationKey).not.toHaveBeenCalled();
    expect(requestDocumentAdapter.findByRequest).not.toHaveBeenCalled();
    expect(runChangeset).not.toHaveBeenCalled();
  });
});
