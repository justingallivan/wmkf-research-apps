import { lockPreRpBriefForShare } from '../../lib/services/pre-rp-brief/share-lock-service.js';
import {
  PRE_RP_BRIEF_CONTRACT,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';

function briefRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: PRE_RP_BRIEF_CONTRACT.artifactType,
    wmkf_contenttype: PRE_RP_BRIEF_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointsiteid: 'site-id',
    _etag: 'row-1',
    ...overrides,
  };
}

function fileMetadataFixture(overrides = {}) {
  return {
    siteId: 'site-id',
    driveId: 'drive-id',
    id: 'item-id',
    webUrl: 'https://sharepoint.test/brief.docx',
    versionId: '1.0',
    eTag: 'file-etag',
    size: 1234,
    lastModified: '2026-09-16T12:00:00Z',
    name: 'Pre-RP-Brief_1002379_abcd1234.docx',
    ...overrides,
  };
}

function dependenciesFixture({ row }) {
  const request = { akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: row.wmkf_requestdocumentid };
  let etag = 1;
  return {
    getRequest: jest.fn(async () => ({ ...request })),
    findByRequest: jest.fn(async () => ({ records: [{ ...row }] })),
    updateDocument: jest.fn(async (id, patch, options) => {
      if (id !== row.wmkf_requestdocumentid) throw new Error('unexpected id');
      if (options.ifMatch !== row._etag) {
        const conflict = new Error('ETag mismatch');
        conflict.status = 412;
        throw conflict;
      }
      Object.assign(row, patch);
      row._etag = `row-${++etag}`;
    }),
    getFileMetadataById: jest.fn(async () => fileMetadataFixture()),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('docx-bytes') })),
    hashDocx: jest.fn(async () => 'gdc1:governed-hash'),
    now: () => new Date('2026-09-16T13:00:00Z'),
    resolveActor: jest.fn(async () => ({ schemaReady: false, actorId: null, reason: 'schema-not-ready' })),
    recordActorNotCaptured: jest.fn(async () => {}),
  };
}

describe('lockPreRpBriefForShare', () => {
  it('locks a Draft brief into Review, recording the milestone', async () => {
    const row = briefRow();
    const dependencies = dependenciesFixture({ row });
    const result = await lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    );
    expect(result.reused).toBe(false);
    expect(row.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
    expect(row.wmkf_milestoneversionid).toBe('1.0');
    expect(row.wmkf_milestonecontenthash).toBe('gdc1:governed-hash');
    expect(row.wmkf_milestonecreatedat).toBe('2026-09-16T13:00:00.000Z');
  });

  it('is idempotent when already Review with a complete milestone', async () => {
    const row = briefRow({
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      wmkf_milestoneversionid: '1.0',
      wmkf_milestonecontenthash: 'gdc1:governed-hash',
      wmkf_milestonecreatedat: '2026-09-16T13:00:00.000Z',
    });
    const dependencies = dependenciesFixture({ row });
    const result = await lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    );
    expect(result.reused).toBe(true);
    expect(dependencies.updateDocument).not.toHaveBeenCalled();
    expect(dependencies.downloadFile).not.toHaveBeenCalled();
  });

  it('fails closed when already Review but the milestone is incomplete', async () => {
    const row = briefRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW });
    const dependencies = dependenciesFixture({ row });
    await expect(lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_milestone_incomplete' });
  });

  it('rejects a Superseded artifact', async () => {
    const row = briefRow({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED });
    const dependencies = dependenciesFixture({ row });
    // Superseded is not READY-and-editable in resolveCurrent's own check
    // when it IS the pointer target (a data anomaly), so the pointer
    // resolution itself fails closed first.
    await expect(lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_pointer_invalid' });
  });

  it('rejects an unknown/BOARD_READY lifecycle as ineligible', async () => {
    const row = briefRow();
    const dependencies = dependenciesFixture({ row });
    // Pointer resolution accepts DRAFT/REVIEW only; BOARD_READY (a
    // distribution-snapshot lifecycle) never reaches the eligibility check
    // as a pointer target, so it also fails at pointer resolution.
    dependencies.findByRequest = jest.fn(async () => ({
      records: [{ ...row, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY }],
    }));
    await expect(lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_pointer_invalid' });
  });

  it('fails closed when the SharePoint version changes mid-lock (version race)', async () => {
    const row = briefRow();
    const dependencies = dependenciesFixture({ row });
    dependencies.getFileMetadataById = jest.fn()
      .mockResolvedValueOnce(fileMetadataFixture({ versionId: '1.0' }))
      .mockResolvedValueOnce(fileMetadataFixture({ versionId: '2.0' }));
    await expect(lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_sharepoint_version_changed' });
    expect(row.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT);
  });

  it('rejects a stale expectedArtifactId', async () => {
    const row = briefRow();
    const dependencies = dependenciesFixture({ row });
    await expect(lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: '99999999-9999-4999-8999-999999999999' },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_stale_artifact' });
  });

  it('fails closed on invalid identity inputs', async () => {
    const row = briefRow();
    const dependencies = dependenciesFixture({ row });
    await expect(lockPreRpBriefForShare(
      { requestId: 'not-a-guid', expectedArtifactId: ARTIFACT_ID },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_invalid_identity' });
  });

  it('fails closed when there is no current brief pointer', async () => {
    const dependencies = {
      getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, _wmkf_currentprerpbrief_value: null })),
      findByRequest: jest.fn(async () => ({ records: [] })),
    };
    await expect(lockPreRpBriefForShare(
      { requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID },
      dependencies,
    )).rejects.toMatchObject({ code: 'brief_current_draft_missing' });
  });
});
