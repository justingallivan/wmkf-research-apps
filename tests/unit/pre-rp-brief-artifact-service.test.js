import {
  generatePreRpBrief,
  getPreRpBriefStatus,
  projectPreRpBriefArtifact,
  resolveCurrentPreRpBriefForDistribution,
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

  it('never surfaces a Superseded row as pending (Round-2 finding 4)', async () => {
    // Discriminating: removing the SUPERSEDED exclusion from the pending
    // candidate filter would let this row through — it is otherwise a
    // plausible pending candidate (non-Ready, no pointer set).
    const pointerTarget = briefRow({
      wmkf_requestdocumentid: OLDER_ARTIFACT_ID,
      createdon: '2026-09-10T00:00:00Z',
    });
    const superseded = briefRow({
      wmkf_requestdocumentid: NEWER_ARTIFACT_ID,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
      createdon: '2026-09-16T00:00:00Z',
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: OLDER_ARTIFACT_ID },
      rows: [pointerTarget, superseded],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.pendingArtifact).toBeNull();
  });

  it('never surfaces a row that predates the pointer target as pending (Round-2 finding 4)', async () => {
    // Discriminating: replacing the postdates-the-pointer comparison with
    // `return true` would let this earlier-created row through.
    const pointerTarget = briefRow({
      wmkf_requestdocumentid: NEWER_ARTIFACT_ID,
      createdon: '2026-09-16T00:00:00Z',
    });
    const earlierGenerating = briefRow({
      wmkf_requestdocumentid: OLDER_ARTIFACT_ID,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      createdon: '2026-09-10T00:00:00Z',
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: NEWER_ARTIFACT_ID },
      rows: [pointerTarget, earlierGenerating],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.pendingArtifact).toBeNull();
  });

  it('fails closed on an invalid requestId', async () => {
    await expect(getPreRpBriefStatus({ requestId: 'not-a-guid' }, statusDependencies({ request: null, rows: [] })))
      .rejects.toMatchObject({ code: 'invalid_request_id' });
  });

  it('reports hasBriefRows: false when the request has no brief rows at all (H1/§3.5)', async () => {
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.hasBriefRows).toBe(false);
  });

  it('reports hasBriefRows: true when a brief row exists, even if it is only pending', async () => {
    const generating = briefRow({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    });
    const dependencies = statusDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [generating],
    });
    const status = await getPreRpBriefStatus({ requestId: REQUEST_ID }, dependencies);
    expect(status.hasBriefRows).toBe(true);
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

  it('does not delete the winning claim\'s SharePoint item when a stale claim loses the activation race (Round-2 finding 2)', async () => {
    // Attempt A claims the row, renders, and uploads. Before A can
    // activate, a concurrent winner B (simulated by uploadFile's own mock,
    // standing in for a reclaim that happened between A's lease expiring
    // and A reaching activation) reclaims the SAME row, uploads to the SAME
    // deterministic filename (conflictBehavior: 'replace' returns the same
    // driveItem id), and takes ownership. A's activation then finds its
    // claim lost. Deleting the uploaded item would delete B's now-live,
    // soon-to-be-pointer-referenced item.
    const SHARED_ITEM_ID = 'shared-item';
    let row = null;
    let etag = 1;
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null, _etag: 'request-1' };

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
      findByGenerationKey: jest.fn().mockImplementation(async () => ({ records: row ? [{ ...row }] : [] })),
      findByRequest: jest.fn().mockImplementation(async () => ({ records: row ? [{ ...row }] : [] })),
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
        if (id !== row.wmkf_requestdocumentid) throw new Error('unexpected id');
        if (options?.ifMatch && options.ifMatch !== row._etag) {
          const conflict = new Error('ETag mismatch');
          conflict.status = 412;
          throw conflict;
        }
        Object.assign(row, patch);
        row._etag = `row-${++etag}`;
      }),
      commitChangeset: jest.fn(),
      ensureFolderPath: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn().mockImplementation(async () => {
        // Simulate B reclaiming and adopting this same deterministic item
        // before A's activation reads the row.
        row.wmkf_claimtoken = 'claim-B';
        row.wmkf_sharepointitemid = SHARED_ITEM_ID;
        row._etag = `row-${++etag}`;
        return {
          siteId: 'site-id',
          driveId: 'drive-id',
          id: SHARED_ITEM_ID,
          webUrl: 'https://sharepoint.test/brief.docx',
          versionId: '1.0',
          eTag: 'file-etag',
          size: 1234,
          lastModified: '2026-09-16T12:00:00Z',
        };
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      newClaimToken: jest.fn().mockReturnValue('claim-A'),
    };

    await expect(generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: 'op-1' },
      dependencies,
    )).rejects.toMatchObject({ code: 'claim_lost' });
    expect(dependencies.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes the orphaned SharePoint item when a stale claim loses the activation race and the winner adopted a different item', async () => {
    // Same shape as the round-2 fixture above, except the reclaiming winner
    // uploaded to a DIFFERENT item id (e.g. a different generation cycle),
    // so this attempt's own upload is a genuine orphan that must be cleaned up.
    const UPLOADED_ITEM_ID = 'uploaded-item';
    const WINNER_ITEM_ID = 'winner-item';
    let row = null;
    let etag = 1;
    const request = { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null, _etag: 'request-1' };

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
      findByGenerationKey: jest.fn().mockImplementation(async () => ({ records: row ? [{ ...row }] : [] })),
      findByRequest: jest.fn().mockImplementation(async () => ({ records: row ? [{ ...row }] : [] })),
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
        if (id !== row.wmkf_requestdocumentid) throw new Error('unexpected id');
        if (options?.ifMatch && options.ifMatch !== row._etag) {
          const conflict = new Error('ETag mismatch');
          conflict.status = 412;
          throw conflict;
        }
        Object.assign(row, patch);
        row._etag = `row-${++etag}`;
      }),
      commitChangeset: jest.fn(),
      ensureFolderPath: jest.fn().mockResolvedValue(undefined),
      uploadFile: jest.fn().mockImplementation(async () => {
        // Simulate a winner reclaiming the row and adopting a DIFFERENT
        // item before this attempt's activation reads the row back.
        row.wmkf_claimtoken = 'claim-B';
        row.wmkf_sharepointitemid = WINNER_ITEM_ID;
        row._etag = `row-${++etag}`;
        return {
          siteId: 'site-id',
          driveId: 'drive-id',
          id: UPLOADED_ITEM_ID,
          webUrl: 'https://sharepoint.test/brief.docx',
          versionId: '1.0',
          eTag: 'file-etag',
          size: 1234,
          lastModified: '2026-09-16T12:00:00Z',
        };
      }),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      newClaimToken: jest.fn().mockReturnValue('claim-A'),
    };

    await expect(generatePreRpBrief(
      { requestId: REQUEST_ID, clientOperationId: 'op-1' },
      dependencies,
    )).rejects.toMatchObject({ code: 'claim_lost' });
    expect(dependencies.deleteFile).toHaveBeenCalledTimes(1);
    expect(dependencies.deleteFile).toHaveBeenCalledWith('drive-id', UPLOADED_ITEM_ID);
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

describe('resolveCurrentPreRpBriefForDistribution', () => {
  function distDependencies({ request, rows }) {
    return {
      getRequest: jest.fn(async () => request),
      findByRequest: jest.fn(async () => ({ records: rows })),
    };
  }

  it('resolves a Review-locked pointer target matching the expected artifact id', async () => {
    const row = briefRow({
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      wmkf_sharepointdriveid: 'drive-id',
      wmkf_sharepointitemid: 'item-id',
      wmkf_sharepointfolderpath: 'Requests/1002379/Artifacts/Pre-Research Presentation Brief',
    });
    const dependencies = distDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: ARTIFACT_ID },
      rows: [row],
    });
    const { row: resolved } = await resolveCurrentPreRpBriefForDistribution(REQUEST_ID, ARTIFACT_ID, dependencies);
    expect(resolved.wmkf_requestdocumentid).toBe(ARTIFACT_ID);
  });

  it('fails closed as distribution_stale_source when the expected artifact id does not match the pointer', async () => {
    const row = briefRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW });
    const dependencies = distDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: ARTIFACT_ID },
      rows: [row],
    });
    await expect(resolveCurrentPreRpBriefForDistribution(REQUEST_ID, OLDER_ARTIFACT_ID, dependencies))
      .rejects.toMatchObject({ code: 'distribution_stale_source' });
  });

  it('fails closed as distribution_source_ineligible when the pointer target is still Draft (not locked for Share)', async () => {
    const row = briefRow({
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_sharepointdriveid: 'drive-id',
      wmkf_sharepointitemid: 'item-id',
      wmkf_sharepointfolderpath: 'Requests/1002379/Artifacts/Pre-Research Presentation Brief',
    });
    const dependencies = distDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: ARTIFACT_ID },
      rows: [row],
    });
    await expect(resolveCurrentPreRpBriefForDistribution(REQUEST_ID, ARTIFACT_ID, dependencies))
      .rejects.toMatchObject({ code: 'distribution_source_ineligible' });
  });

  it('fails closed as distribution_stale_source when no brief has been generated yet (no pointer, no orphan)', async () => {
    const dependencies = distDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [],
    });
    await expect(resolveCurrentPreRpBriefForDistribution(REQUEST_ID, ARTIFACT_ID, dependencies))
      .rejects.toMatchObject({ code: 'distribution_stale_source' });
  });

  it('fails closed as brief_pointer_invalid when the pointer is broken (reused from the status resolver)', async () => {
    // A Ready row exists but no pointer names it — a real reconciliation
    // problem, distinct from "nothing generated yet".
    const orphan = briefRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY });
    const dependencies = distDependencies({
      request: { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null },
      rows: [orphan],
    });
    await expect(resolveCurrentPreRpBriefForDistribution(REQUEST_ID, ARTIFACT_ID, dependencies))
      .rejects.toMatchObject({ code: 'brief_pointer_invalid' });
  });
});

describe('projectPreRpBriefArtifact', () => {
  it('rejects a row that is not a governed Pre-RP Brief document', () => {
    expect(() => projectPreRpBriefArtifact(briefRow({ wmkf_contenttype: 'application/pdf' })))
      .toThrow(/not a governed Pre-RP Brief document/);
  });

  it('counts only received reviews from the stored input snapshot (H3a/B10 client mirror)', () => {
    const snapshot = JSON.stringify({
      reviews: [
        { reviewReceivedAt: '2026-09-01T00:00:00Z' },
        { reviewReceivedAt: null },
        { reviewReceivedAt: '2026-09-02T00:00:00Z' },
      ],
    });
    const artifact = projectPreRpBriefArtifact(briefRow({ wmkf_presiteinputsnapshotjson: snapshot }));
    expect(artifact.receivedReviewCount).toBe(2);
  });

  it('reads zero received reviews when the snapshot is missing or malformed', () => {
    const missing = projectPreRpBriefArtifact(briefRow({ wmkf_presiteinputsnapshotjson: null }));
    expect(missing.receivedReviewCount).toBe(0);
    const malformed = projectPreRpBriefArtifact(briefRow({ wmkf_presiteinputsnapshotjson: '{not json' }));
    expect(malformed.receivedReviewCount).toBe(0);
  });
});
