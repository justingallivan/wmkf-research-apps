import {
  generatePreRpBrief,
  getPreRpBriefStatus,
  projectPreRpBriefArtifact,
} from '../../lib/services/pre-rp-brief/artifact-service.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  PRE_SITE_DISTRIBUTION_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_REQUEST_ID = '99999999-9999-4999-8999-999999999999';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const OLDER_ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';
const NEWER_ARTIFACT_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_ID = '55555555-5555-4555-8555-555555555555';

const ENVELOPE = Object.freeze({
  schemaVersion: 1,
  artifactType: 'pre-rp-brief',
  request: {
    institutionName: 'Applicant University',
    projectTitle: 'A test project',
    principalInvestigator: 'Ada Lovelace',
    programDirector: 'Pat Director',
    abstract: 'This project studies a phenomenon of interest.',
  },
  reviews: [],
});

function inputsFixture(overrides = {}) {
  return {
    requestNumber: '1002379',
    cycleCode: 'D26',
    envelope: ENVELOPE,
    ...overrides,
  };
}

function briefRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
    wmkf_contenttype: PRE_RP_BRIEF_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: PRE_RP_BRIEF_CONTRACT.producer,
    createdon: '2026-09-16T10:00:00Z',
    modifiedon: '2026-09-16T10:00:00Z',
    _etag: 'row-1',
    ...overrides,
  };
}

describe('getPreRpBriefStatus', () => {
  function statusDependencies({ request, rows }) {
    return {
      getRequest: jest.fn(async () => request),
      findByRequest: jest.fn(async () => ({ records: rows })),
    };
  }

  it('resolves the older of two rows when the pointer names it (never a newest-row fallback)', async () => {
    const older = briefRow({
      wmkf_requestdocumentid: OLDER_ARTIFACT_ID,
      createdon: '2026-09-10T00:00:00Z',
    });
    const newer = briefRow({
      wmkf_requestdocumentid: NEWER_ARTIFACT_ID,
      createdon: '2026-09-16T00:00:00Z',
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: OLDER_ARTIFACT_ID },
      rows: [newer, older],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.currentArtifact.artifactId).toBe(OLDER_ARTIFACT_ID);
  });

  it('fails closed (brief_pointer_invalid) when a Ready row exists with no current pointer', async () => {
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [briefRow()],
    });
    await expect(getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies))
      .rejects.toMatchObject({ code: 'brief_pointer_invalid', httpStatus: 409 });
  });

  it('fails closed when the pointer names a distribution snapshot row', async () => {
    const snapshot = briefRow({
      wmkf_producer: `${PRE_SITE_DISTRIBUTION_CONTRACT.producerPrefix}-docx`,
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: ARTIFACT_ID },
      rows: [snapshot],
    });
    await expect(getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies))
      .rejects.toMatchObject({ code: 'brief_pointer_invalid' });
  });

  it('fails closed when the pointer names a row belonging to a different request', async () => {
    const otherRequestRow = briefRow({ _wmkf_request_value: OTHER_REQUEST_ID });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: ARTIFACT_ID },
      rows: [otherRequestRow],
    });
    await expect(getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies))
      .rejects.toMatchObject({ code: 'brief_pointer_invalid' });
  });

  it('surfaces a generating first attempt as pending when there is no pointer yet', async () => {
    const generating = briefRow({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [generating],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.currentArtifact).toBeNull();
    expect(status.pendingArtifact.artifactId).toBe(ARTIFACT_ID);
    expect(status.pendingArtifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING);
  });

  it('surfaces a failed first attempt as pending when there is no pointer yet', async () => {
    const failed = briefRow({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
      wmkf_lasterrorcode: 'pre_rp_brief_failed',
      wmkf_lasterrormessage: 'boom',
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [failed],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.pendingArtifact.artifactId).toBe(ARTIFACT_ID);
    expect(status.pendingArtifact.retryable).toBe(true);
  });

  it('fails closed on an invalid requestId', async () => {
    await expect(getPreRpBriefStatus({ requestId: 'not-a-guid' }, statusDependencies({ request: null, rows: [] })))
      .rejects.toMatchObject({ code: 'invalid_request_id' });
  });
});

describe('generatePreRpBrief', () => {
  function createHarness({ currentPointerRow = null } = {}) {
    let row = null;
    const prior = currentPointerRow ? { ...currentPointerRow } : null;
    const request = {
      akoya_requestid: REQUEST_ID,
      _wmkf_currentprerpbrief_value: prior?.wmkf_requestdocumentid || null,
      _etag: 'request-1',
    };
    let etag = 1;
    let uploaded = null;

    function applyPatch(target, patch) {
      Object.assign(target, patch);
      target._etag = `row-${++etag}`;
      target.modifiedon = new Date().toISOString();
    }

    const dependencies = {
      loadInputs: jest.fn().mockResolvedValue(inputsFixture()),
      renderDocx: jest.fn().mockResolvedValue({ docx: Buffer.from('rendered-docx') }),
      hashDocx: jest.fn().mockResolvedValue('gdc1:governed-hash'),
      getRequest: jest.fn().mockImplementation(async () => ({ ...request })),
      getBuckets: jest.fn().mockResolvedValue([{
        source: 'dynamics',
        library: 'akoya_request',
        folder: 'Requests/1002379',
      }]),
      findByGenerationKey: jest.fn().mockImplementation(async () => ({
        records: row ? [{ ...row }] : [],
      })),
      findByRequest: jest.fn().mockImplementation(async () => ({
        records: [...(row ? [{ ...row }] : []), ...(prior ? [{ ...prior }] : [])],
      })),
      createDocument: jest.fn().mockImplementation(async (payload) => {
        row = {
          ...payload,
          wmkf_requestdocumentid: ARTIFACT_ID,
          _wmkf_request_value: REQUEST_ID,
          _etag: `row-${etag}`,
          createdon: new Date().toISOString(),
          modifiedon: new Date().toISOString(),
        };
        delete row['wmkf_Request@odata.bind'];
        return ARTIFACT_ID;
      }),
      updateDocument: jest.fn().mockImplementation(async (id, patch, options) => {
        const target = id === row?.wmkf_requestdocumentid ? row : (id === prior?.wmkf_requestdocumentid ? prior : null);
        if (!target) throw new Error(`document row ${id} not found`);
        if (options?.ifMatch && options.ifMatch !== target._etag) {
          const conflict = new Error('ETag mismatch');
          conflict.status = 412;
          throw conflict;
        }
        applyPatch(target, patch);
      }),
      commitChangeset: jest.fn().mockImplementation(async (operations) => {
        for (const operation of operations) {
          if (operation.entitySet === 'wmkf_requestdocuments') {
            const target = [row, prior].find((candidate) => candidate?.wmkf_requestdocumentid === operation.key);
            if (!target) throw new Error(`document row ${operation.key} not found`);
            applyPatch(target, operation.body);
          } else if (operation.entitySet === 'akoya_requests') {
            request._wmkf_currentprerpbrief_value = operation.body['wmkf_CurrentPreRPBrief@odata.bind']
              .match(/\(([^)]+)\)/)?.[1];
            request._etag = 'request-2';
          }
        }
      }),
      ensureFolderPath: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn().mockImplementation(async () => {
        uploaded = {
          siteId: 'site-id',
          driveId: 'drive-id',
          id: 'uploaded-item',
          webUrl: 'https://sharepoint.test/brief.docx',
          versionId: '1.0',
          eTag: 'file-etag',
          size: 1234,
          lastModified: '2026-09-16T12:00:00Z',
        };
        return uploaded;
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      newClaimToken: jest.fn().mockReturnValue(CLAIM_ID),
    };

    return {
      dependencies,
      get row() { return row; },
      get prior() { return prior; },
      get request() { return request; },
    };
  }

  it('generates a fresh brief and activates it (Ready, pointer set)', async () => {
    const harness = createHarness();
    const result = await generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: 'op-1' },
      harness.dependencies,
    );
    expect(result.reused).toBe(false);
    expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    expect(result.artifact.lifecycleState).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT);
    expect(harness.request._wmkf_currentprerpbrief_value).toBe(ARTIFACT_ID);
    expect(harness.row.wmkf_cyclecode).toBe('D26');
    expect(harness.row.wmkf_inputfingerprint).toBeTruthy();
  });

  it('reuses the exact same row on an unchanged retry (same fingerprint and clientOperationId)', async () => {
    const existing = briefRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY });
    const harness = createHarness({ currentPointerRow: existing });
    // Point findByGenerationKey/findByRequest at the existing row directly.
    harness.dependencies.findByGenerationKey.mockImplementation(async () => ({ records: [existing] }));
    const result = await generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: 'op-1' },
      harness.dependencies,
    );
    expect(result.reused).toBe(true);
    expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
    expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
  });

  it('regenerate (a different clientOperationId) supersedes the prior row and moves the pointer', async () => {
    const prior = briefRow({
      wmkf_requestdocumentid: OLDER_ARTIFACT_ID,
      wmkf_generationkey: 'prior-generation-key',
    });
    const harness = createHarness({ currentPointerRow: prior });
    const result = await generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: 'op-2' },
      harness.dependencies,
    );
    expect(result.reused).toBe(false);
    expect(result.artifact.artifactId).toBe(ARTIFACT_ID);
    expect(harness.prior.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED);
    expect(harness.request._wmkf_currentprerpbrief_value).toBe(ARTIFACT_ID);
  });

  it('reuses without rendering when a GENERATING lease is still active', async () => {
    const generating = briefRow({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      modifiedon: new Date().toISOString(),
    });
    const harness = createHarness();
    harness.dependencies.findByGenerationKey.mockImplementation(async () => ({ records: [generating] }));
    const result = await generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: 'op-1' },
      harness.dependencies,
    );
    expect(result.reused).toBe(true);
    expect(harness.dependencies.renderDocx).not.toHaveBeenCalled();
    expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
  });

  it('fails closed on an invalid requestId before loading inputs', async () => {
    const harness = createHarness();
    await expect(generatePreRpBrief(
      { requestId: 'not-a-guid', clientOperationId: 'op-1' },
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'invalid_request_id' });
    expect(harness.dependencies.loadInputs).not.toHaveBeenCalled();
  });

  it('fails closed on a missing clientOperationId before loading inputs', async () => {
    const harness = createHarness();
    await expect(generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: '' },
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'invalid_client_operation_id' });
    expect(harness.dependencies.loadInputs).not.toHaveBeenCalled();
  });
});

describe('projectPreRpBriefArtifact', () => {
  it('rejects a row that is not a governed Pre-RP Brief document', () => {
    expect(() => projectPreRpBriefArtifact(briefRow({ wmkf_contenttype: 'application/pdf' })))
      .toThrow(/not a governed Pre-RP Brief document/);
  });
});
