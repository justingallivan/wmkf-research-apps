import {
  generatePreRpBrief,
  projectPreRpBriefArtifact,
} from '../../lib/services/pre-rp-brief/artifact-service.js';
import { reopenSentPreRpBrief } from '../../lib/services/pre-rp-brief/reopen-service.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  PRE_SITE_REOPEN_REASON,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_OPERATION_ID = '77777777-7777-4777-8777-777777777777';
const REQUEST_NUMBER = '1002379';

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
    requestNumber: REQUEST_NUMBER,
    cycleCode: 'D26',
    envelope: ENVELOPE,
    ...overrides,
  };
}

function currentRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
    wmkf_contenttype: PRE_RP_BRIEF_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_producer: PRE_RP_BRIEF_CONTRACT.producer,
    wmkf_generationkey: 'prior-generation-key',
    createdon: '2026-09-10T00:00:00Z',
    modifiedon: '2026-09-10T00:00:00Z',
    _etag: 'row-1',
    ...overrides,
  };
}

function validBody(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    clientOperationId: OPERATION_ID,
    requestNumber: REQUEST_NUMBER,
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The Board received an incomplete draft and it must be corrected.',
    ...overrides,
  };
}

function baseDependencies({ row = currentRow(), request = null, sent = true, attempts = [] } = {}) {
  return {
    resolveCanonicalPreRpBriefRow: jest.fn().mockResolvedValue({
      request: request || {
        akoya_requestid: REQUEST_ID,
        akoya_requestnum: REQUEST_NUMBER,
        _wmkf_currentprerpbrief_value: row?.wmkf_requestdocumentid || null,
        _etag: 'request-1',
      },
      row,
      briefRows: row ? [row] : [],
    }),
    hasSentAttemptForSource: jest.fn().mockResolvedValue(sent),
    listDistributionAttempts: jest.fn().mockResolvedValue(attempts),
    generatePreRpBrief: jest.fn(),
    isGuardedReopenSchemaReady: jest.fn().mockReturnValue(true),
  };
}

describe('reopenSentPreRpBrief — refusals (1a-1f)', () => {
  it.each([
    ['a non-GUID requestId', validBody({ requestId: 'not-a-guid' })],
    ['a non-GUID clientOperationId', validBody({ clientOperationId: 'not-a-guid' })],
  ])('1a refuses %s (brief_reopen_invalid_identity, 400)', async (_label, body) => {
    const dependencies = baseDependencies();
    await expect(reopenSentPreRpBrief(body, {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_invalid_identity',
      httpStatus: 400,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
    expect(dependencies.resolveCanonicalPreRpBriefRow).not.toHaveBeenCalled();
  });

  it('1a refuses an unknown reason code (brief_reopen_reason_invalid, 400)', async () => {
    const dependencies = baseDependencies();
    await expect(reopenSentPreRpBrief(
      validBody({ reasonCode: 'not-a-real-reason' }),
      {},
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_reopen_reason_invalid', httpStatus: 400 });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1a refuses a too-short reason note (brief_reopen_note_invalid, 400)', async () => {
    const dependencies = baseDependencies();
    await expect(reopenSentPreRpBrief(
      validBody({ reasonNote: 'short' }),
      {},
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_reopen_note_invalid', httpStatus: 400 });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1b refuses 503 brief_reopen_schema_not_ready when the guarded-reopen schema is not ready', async () => {
    const dependencies = baseDependencies();
    dependencies.isGuardedReopenSchemaReady.mockReturnValue(false);
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_schema_not_ready',
      httpStatus: 503,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
    expect(dependencies.resolveCanonicalPreRpBriefRow).not.toHaveBeenCalled();
  });

  it('1c refuses 409 brief_reopen_stale when expectedArtifactId is not the current row', async () => {
    const dependencies = baseDependencies({ row: currentRow({ wmkf_requestdocumentid: 'a-different-row' }) });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_stale',
      httpStatus: 409,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1c refuses 409 brief_reopen_stale when there is no current row at all', async () => {
    const dependencies = baseDependencies({ row: null });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_stale',
      httpStatus: 409,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1c refuses 409 brief_reopen_not_shared when the current row is Draft (not locked for Share)', async () => {
    const dependencies = baseDependencies({
      row: currentRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT }),
    });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_not_shared',
      httpStatus: 409,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1c refuses 409 brief_reopen_not_shared when the current row is not Ready', async () => {
    const dependencies = baseDependencies({
      row: currentRow({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING }),
    });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_not_shared',
      httpStatus: 409,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1d refuses 409 brief_reopen_request_number_mismatch when the typed number does not match', async () => {
    const dependencies = baseDependencies();
    await expect(reopenSentPreRpBrief(
      validBody({ requestNumber: '9999999' }),
      {},
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_reopen_request_number_mismatch', httpStatus: 409 });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1e refuses 409 brief_reopen_not_sent when the current brief has never been sent', async () => {
    const dependencies = baseDependencies({ sent: false });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_not_sent',
      httpStatus: 409,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1f refuses 409 brief_reopen_in_flight when a distribution attempt for the source is in progress', async () => {
    const dependencies = baseDependencies({
      sent: true,
      attempts: [{ source_document_id: ARTIFACT_ID, state: 'send_requested', lease_token: 'send-lease' }],
    });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_reopen_in_flight',
      httpStatus: 409,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1f refuses 503 brief_distribution_state_unavailable when the distribution reader throws', async () => {
    const dependencies = baseDependencies();
    dependencies.listDistributionAttempts.mockRejectedValue(new Error('postgres unavailable'));
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_distribution_state_unavailable',
      httpStatus: 503,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });

  it('1f refuses 503 brief_distribution_state_unavailable at a full (>=100) distribution page', async () => {
    const dependencies = baseDependencies({
      sent: true,
      attempts: Array.from({ length: 100 }, (_, index) => ({
        source_document_id: `unrelated-${index}`,
        state: 'delivered',
      })),
    });
    await expect(reopenSentPreRpBrief(validBody(), {}, dependencies)).rejects.toMatchObject({
      code: 'brief_distribution_state_unavailable',
      httpStatus: 503,
    });
    expect(dependencies.generatePreRpBrief).not.toHaveBeenCalled();
  });
});

describe('reopenSentPreRpBrief — success and idempotent retry', () => {
  function createHarness() {
    let row = null;
    const prior = currentRow();
    const request = {
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: REQUEST_NUMBER,
      _wmkf_currentprerpbrief_value: prior.wmkf_requestdocumentid,
      _etag: 'request-1',
    };
    let etag = 1;

    function applyPatch(target, patch) {
      Object.assign(target, patch);
      target._etag = `row-${++etag}`;
      target.modifiedon = new Date().toISOString();
    }

    const artifactDependencies = {
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
        records: [...(row ? [{ ...row }] : []), { ...prior }],
      })),
      hasSentAttemptForSource: jest.fn().mockResolvedValue(true),
      listDistributionAttempts: jest.fn().mockResolvedValue([]),
      createDocument: jest.fn().mockImplementation(async (payload) => {
        row = {
          ...payload,
          wmkf_requestdocumentid: 'new-row-id',
          _wmkf_request_value: REQUEST_ID,
          _etag: `row-${etag}`,
          createdon: new Date().toISOString(),
          modifiedon: new Date().toISOString(),
        };
        delete row['wmkf_Request@odata.bind'];
        return 'new-row-id';
      }),
      updateDocument: jest.fn().mockImplementation(async (id, patch, options) => {
        const target = id === row?.wmkf_requestdocumentid ? row : (id === prior.wmkf_requestdocumentid ? prior : null);
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
      uploadFile: jest.fn().mockImplementation(async () => ({
        siteId: 'site-id',
        driveId: 'drive-id',
        id: 'uploaded-item',
        webUrl: 'https://sharepoint.test/brief.docx',
        versionId: '1.0',
        eTag: 'file-etag',
        size: 1234,
        lastModified: '2026-09-16T12:00:00Z',
      })),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      newClaimToken: jest.fn().mockReturnValue('claim-1'),
    };

    const reopenDependencies = {
      resolveCanonicalPreRpBriefRow: jest.fn().mockImplementation(async () => ({
        request: { ...request },
        row: row || prior,
        briefRows: row ? [row] : [prior],
      })),
      hasSentAttemptForSource: jest.fn().mockResolvedValue(true),
      listDistributionAttempts: jest.fn().mockResolvedValue([]),
      generatePreRpBrief: jest.fn().mockImplementation(
        (args) => generatePreRpBrief(args, artifactDependencies),
      ),
      isGuardedReopenSchemaReady: jest.fn().mockReturnValue(true),
    };

    return {
      artifactDependencies,
      reopenDependencies,
      get row() { return row; },
      get prior() { return prior; },
      get request() { return request; },
    };
  }

  it('creates an audited successor, supersedes the prior row, and moves the pointer', async () => {
    const harness = createHarness();
    const result = await reopenSentPreRpBrief(validBody(), { actingUserSystemId: 'user-1' }, harness.reopenDependencies);

    expect(result.reused).toBe(false);
    expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
    expect(harness.row.wmkf_reopencycleid).toBe(OPERATION_ID);
    expect(harness.row.wmkf_reopenreasoncode).toBe(PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF);
    expect(harness.row.wmkf_reopenreasonnote).toBe(validBody().reasonNote);
    expect(harness.prior.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED);
    expect(harness.request._wmkf_currentprerpbrief_value).toBe(harness.row.wmkf_requestdocumentid);
    expect(harness.reopenDependencies.hasSentAttemptForSource)
      .toHaveBeenCalledWith(REQUEST_ID, ARTIFACT_ID);
  });

  it('is idempotent: an exact retry with the same clientOperationId reuses the row without a second upload', async () => {
    const harness = createHarness();
    const first = await reopenSentPreRpBrief(validBody(), { actingUserSystemId: 'user-1' }, harness.reopenDependencies);
    expect(first.reused).toBe(false);
    expect(harness.artifactDependencies.uploadFile).toHaveBeenCalledTimes(1);

    const retry = await reopenSentPreRpBrief(validBody(), { actingUserSystemId: 'user-1' }, harness.reopenDependencies);
    expect(retry.reused).toBe(true);
    expect(retry.artifact.artifactId).toBe(projectPreRpBriefArtifact(harness.row).artifactId);
    expect(harness.artifactDependencies.uploadFile).toHaveBeenCalledTimes(1);
    expect(harness.reopenDependencies.generatePreRpBrief).toHaveBeenCalledTimes(1);
  });
});
