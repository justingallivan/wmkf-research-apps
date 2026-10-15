import { commitGroupReviewRegeneration, commitPostVisitRegeneration } from '../../lib/services/pre-site-visit/artifact-lineage.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE as LIFE,
  REQUEST_DOCUMENT_OPERATION_STATUS as OP,
} from '../../shared/config/requestDocument.js';

const REQUEST = '11111111-1111-4111-8111-111111111111';
const OLD_PRE = '22222222-2222-4222-8222-222222222221';
const OLD_FINAL = '22222222-2222-4222-8222-222222222222';
const NEW_PRE = '22222222-2222-4222-8222-222222222223';
const NEW_FINAL = '22222222-2222-4222-8222-222222222224';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);

function harness({ commitError = null } = {}) {
  const request = {
    akoya_requestid: REQUEST,
    _wmkf_currentpresitevisit_value: OLD_PRE,
    _wmkf_currentfinalwriteup_value: OLD_FINAL,
    _wmkf_programdirector_value: ACTOR,
    _etag: 'request-etag',
  };
  const preRows = [
    { wmkf_requestdocumentid: OLD_PRE, _wmkf_request_value: REQUEST, wmkf_lifecycleState: undefined,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
      wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.FINAL, _etag: 'old-pre-etag' },
    { wmkf_requestdocumentid: NEW_PRE, _wmkf_request_value: REQUEST,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
      wmkf_operationstatus: OP.GENERATING, wmkf_lifecyclestate: LIFE.DRAFT,
      wmkf_generationkey: 'regen-key', wmkf_claimtoken: 'claim', wmkf_contenthash: HASH,
      _wmkf_sourcedocument_value: OLD_PRE, _etag: 'new-pre-etag' },
  ];
  const finalRows = [
    { wmkf_requestdocumentid: OLD_FINAL, _wmkf_request_value: REQUEST,
      _wmkf_sourcedocument_value: OLD_PRE, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
      wmkf_operationstatus: OP.READY, wmkf_lifecyclestate: LIFE.REVIEW, _etag: 'old-final-etag' },
    { wmkf_requestdocumentid: NEW_FINAL, _wmkf_request_value: REQUEST,
      _wmkf_sourcedocument_value: NEW_PRE, wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
      wmkf_operationstatus: OP.GENERATING, wmkf_lifecyclestate: LIFE.DRAFT, _etag: 'new-final-etag' },
  ];
  const deps = {
    findByGenerationKey: jest.fn(async () => ({ records: [preRows[1]] })),
    getRequest: jest.fn(async () => request),
    findByRequest: jest.fn(async (_id, { artifactType }) => ({
      records: artifactType === REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT ? preRows : finalRows,
    })),
    getFileMetadataById: jest.fn(async (driveId, id) => ({
      siteId: 'site', driveId, id, versionId: 'v2', eTag: 'etag2',
      lastModified: '2026-10-15T10:00:00Z', size: 100,
    })),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('new docx') })),
    hashDocx: jest.fn(async () => HASH),
    now: () => new Date('2026-10-15T10:00:00Z'),
    commitChangeset: jest.fn(async (operations) => {
      if (commitError) throw commitError;
      for (const op of operations) {
        const row = op.entitySet === 'wmkf_requestdocuments'
          ? [...preRows, ...finalRows].find((candidate) => candidate.wmkf_requestdocumentid === op.key)
          : request;
        Object.assign(row, op.body);
        if (op.body['wmkf_CurrentPreSiteVisit@odata.bind']) request._wmkf_currentpresitevisit_value = NEW_PRE;
        if (op.body['wmkf_CurrentFinalWriteup@odata.bind']) request._wmkf_currentfinalwriteup_value = NEW_FINAL;
      }
      request._etag = 'request-etag-2';
      preRows[0]._etag = 'old-pre-etag-2';
      finalRows[0]._etag = 'old-final-etag-2';
    }),
  };
  return { deps, request, preRows, finalRows };
}

const args = () => ({
  row: { wmkf_requestdocumentid: NEW_PRE, wmkf_generationkey: 'regen-key' },
  finalRow: { wmkf_requestdocumentid: NEW_FINAL },
  metadata: { siteId: 'site', driveId: 'drive', id: 'item', webUrl: 'https://sharepoint.test/new.docx',
    versionId: 'v2', eTag: 'etag2', lastModified: '2026-10-15T10:00:00Z', size: 100 },
  expectedArtifactId: OLD_PRE,
  expectedFinalArtifactId: OLD_FINAL,
  claimToken: 'claim',
  actingUserSystemId: ACTOR,
  isSuperuser: true,
});

test('group-review replacement atomically supersedes and rebinds both document pointers', async () => {
  const h = harness();
  const result = await commitGroupReviewRegeneration(args(), h.deps);
  expect(result).toMatchObject({
    wmkf_requestdocumentid: NEW_PRE,
    wmkf_lifecyclestate: LIFE.FINAL,
    wmkf_operationstatus: OP.READY,
  });
  expect(h.deps.commitChangeset).toHaveBeenCalledTimes(1);
  const operations = h.deps.commitChangeset.mock.calls[0][0];
  expect(h.deps.hashDocx).toHaveBeenCalledWith(Buffer.from('new docx'));
  expect(operations).toHaveLength(5);
  expect(operations.find((op) => op.entitySet === 'akoya_requests').body).toMatchObject({
    'wmkf_CurrentPreSiteVisit@odata.bind': `/wmkf_requestdocuments(${NEW_PRE})`,
    'wmkf_CurrentFinalWriteup@odata.bind': `/wmkf_requestdocuments(${NEW_FINAL})`,
  });
  expect(h.request).toMatchObject({
    _wmkf_currentpresitevisit_value: NEW_PRE,
    _wmkf_currentfinalwriteup_value: NEW_FINAL,
  });
  expect(h.preRows[0].wmkf_lifecyclestate).toBe(LIFE.SUPERSEDED);
  expect(h.finalRows[0].wmkf_lifecyclestate).toBe(LIFE.SUPERSEDED);
  expect(h.finalRows[1]).toMatchObject({
    wmkf_lifecyclestate: LIFE.REVIEW,
    wmkf_operationstatus: OP.READY,
    _wmkf_sourcedocument_value: NEW_PRE,
    wmkf_groupreviewstartedat: '2026-10-15T10:00:00.000Z',
  });
});

test('group-review replacement has a default clock when dependencies do not inject one', async () => {
  const h = harness();
  delete h.deps.now;
  await expect(commitGroupReviewRegeneration(args(), h.deps)).resolves.toMatchObject({
    wmkf_requestdocumentid: NEW_PRE,
    wmkf_lifecyclestate: LIFE.FINAL,
  });
  expect(Number.isFinite(Date.parse(h.finalRows[1].wmkf_groupreviewstartedat))).toBe(true);
});

test('lost commit response is recovered only when both successor pointers and old states read back', async () => {
  const h = harness({ commitError: new Error('response lost') });
  h.deps.commitChangeset.mockImplementationOnce(async (operations) => {
    for (const op of operations) {
      const row = op.entitySet === 'wmkf_requestdocuments'
        ? [...h.preRows, ...h.finalRows].find((candidate) => candidate.wmkf_requestdocumentid === op.key)
        : h.request;
      Object.assign(row, op.body);
      if (op.body['wmkf_CurrentPreSiteVisit@odata.bind']) h.request._wmkf_currentpresitevisit_value = NEW_PRE;
      if (op.body['wmkf_CurrentFinalWriteup@odata.bind']) h.request._wmkf_currentfinalwriteup_value = NEW_FINAL;
    }
    h.request._etag = 'request-etag-2';
  });
  await expect(commitGroupReviewRegeneration(args(), h.deps)).resolves.toMatchObject({
    wmkf_requestdocumentid: NEW_PRE, wmkf_lifecyclestate: LIFE.FINAL,
  });
});

test('a changed old pointer refuses activation and does not mutate any row', async () => {
  const h = harness();
  h.request._wmkf_currentfinalwriteup_value = '22222222-2222-4222-8222-222222222229';
  await expect(commitGroupReviewRegeneration(args(), h.deps)).rejects.toMatchObject({
    code: 'pre_site_visit_regeneration_stage_changed', httpStatus: 409,
  });
  expect(h.deps.commitChangeset).not.toHaveBeenCalled();
  expect(h.preRows[0].wmkf_lifecyclestate).toBe(LIFE.FINAL);
  expect(h.finalRows[0].wmkf_lifecyclestate).toBe(LIFE.REVIEW);
});

test('activation rechecks the current lead after generation and before either stage can commit', async () => {
  const group = harness();
  group.request._wmkf_programdirector_value = '44444444-4444-4444-8444-444444444444';
  await expect(commitGroupReviewRegeneration({ ...args(), isSuperuser: false }, group.deps)).rejects.toMatchObject({
    code: 'pre_site_writeup_lead_only', httpStatus: 403,
  });
  expect(group.deps.commitChangeset).not.toHaveBeenCalled();

  const postVisit = harness();
  postVisit.request._wmkf_programdirector_value = '44444444-4444-4444-8444-444444444444';
  await expect(commitPostVisitRegeneration({
    row: { wmkf_generationkey: 'regen-key' }, metadata: {}, expectedArtifactId: OLD_PRE,
    claimToken: 'claim', actingUserSystemId: ACTOR, isSuperuser: false,
  }, postVisit.deps)).rejects.toMatchObject({ code: 'pre_site_writeup_lead_only', httpStatus: 403 });
});

test('invalid download or content hash refuses before the paired changeset', async () => {
  const invalid = harness();
  invalid.deps.downloadFile.mockResolvedValueOnce({ body: Buffer.from('wrong shape') });
  await expect(commitGroupReviewRegeneration(args(), invalid.deps)).rejects.toMatchObject({
    code: 'pre_site_visit_regeneration_download_invalid',
  });
  expect(invalid.deps.commitChangeset).not.toHaveBeenCalled();

  const changed = harness();
  changed.deps.hashDocx.mockResolvedValueOnce('wrong-hash');
  await expect(commitGroupReviewRegeneration(args(), changed.deps)).rejects.toMatchObject({
    code: 'pre_site_visit_regeneration_file_changed',
  });
  expect(changed.deps.commitChangeset).not.toHaveBeenCalled();
});
