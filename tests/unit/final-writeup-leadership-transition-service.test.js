import {
  advanceToLeadershipReview,
  getFinalWriteupStatus,
  startFinalWriteup,
} from '../../lib/services/final-writeup/transition-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FINAL_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_FINAL_ID = '77777777-7777-4777-8777-777777777777';
const LEAD_PD_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';
const RESOLVED_ACTOR_ID = '66666666-6666-4666-8666-666666666666';

const LEADERSHIP_FIELDS = Object.freeze({
  wmkf_leadershipreviewstartedat: '2026-09-07T20:00:00.000Z',
  _wmkf_leadershipreviewstartedby_value: LEAD_PD_ID,
});

/**
 * A request whose Final row is already committed in group review (the state the
 * leadership transition starts from), with a Word document that has been edited
 * since the claim so the claim-time observation fields are legitimately stale.
 */
function createHarness({ finalLifecycle = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW, finalOverrides = {} } = {}) {
  const request = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002379',
    _wmkf_programdirector_value: LEAD_PD_ID,
    _wmkf_currentpresitevisit_value: SOURCE_ID,
    _wmkf_currentfinalwriteup_value: FINAL_ID,
    _etag: 'request-etag-1',
  };
  const source = {
    wmkf_requestdocumentid: SOURCE_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    _etag: 'source-etag-1',
  };
  const final = {
    wmkf_requestdocumentid: FINAL_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: finalLifecycle,
    wmkf_sharepointsiteid: 'site-id',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/site-visit.docx',
    wmkf_sharepointversionid: '2.0',
    wmkf_sharepointetag: 'file-etag-2',
    wmkf_sharepointlastmodified: '2026-08-30T19:00:00Z',
    wmkf_filename: '1002379 Pre-Site Visit.docx',
    wmkf_filesize: 1300,
    wmkf_contenthash: 'gdc1:claim-hash',
    wmkf_sourceversionid: '2.0',
    wmkf_sourcecontenthash: 'gdc1:claim-hash',
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: 'gdc1:claim-hash',
    wmkf_milestonecreatedat: '2026-08-30T19:05:00Z',
    wmkf_groupreviewstartedat: '2026-08-30T19:05:00Z',
    _wmkf_groupreviewstartedby_value: LEAD_PD_ID,
    _etag: 'final-etag-1',
    ...finalOverrides,
  };
  const rows = [source, final];
  const metadata = {
    siteId: 'site-id',
    driveId: 'drive-id',
    id: 'item-id',
    name: '1002379 Pre-Site Visit.docx',
    size: 2100,
    webUrl: 'https://sharepoint.test/site-visit.docx',
    eTag: 'file-etag-9',
    versionId: '9.0',
    lastModified: '2026-09-07T19:30:00Z',
  };
  const dependencies = {
    schemaReady: jest.fn().mockReturnValue(true),
    getRequest: jest.fn().mockImplementation(async () => ({ ...request })),
    findByRequest: jest.fn().mockImplementation(async () => ({
      records: rows.map((row) => ({ ...row })),
    })),
    findByGenerationKey: jest.fn(),
    createDocument: jest.fn(),
    updateDocument: jest.fn(),
    commitChangeset: jest.fn().mockImplementation(async (operations) => {
      const finalPatch = operations[0].body;
      Object.assign(final, finalPatch, {
        _wmkf_leadershipreviewstartedby_value: finalPatch['wmkf_LeadershipReviewStartedBy@odata.bind']
          .match(/\(([^)]+)\)/)[1],
        _etag: 'final-etag-2',
      });
      request._etag = 'request-etag-2';
      return { ok: true, operations: [] };
    }),
    getFileMetadataById: jest.fn().mockImplementation(async () => ({ ...metadata })),
    downloadFile: jest.fn().mockResolvedValue({ buffer: Buffer.from('valid-docx') }),
    hashDocx: jest.fn().mockResolvedValue('gdc1:leadership-hash'),
    newClaimToken: jest.fn(),
    now: jest.fn().mockReturnValue(new Date('2026-09-07T20:00:00Z')),
    resolveActor: jest.fn().mockResolvedValue({
      schemaReady: true,
      actorId: RESOLVED_ACTOR_ID,
      reason: null,
    }),
  };
  return { request, source, final, rows, metadata, dependencies };
}

function advance(harness, overrides = {}) {
  return advanceToLeadershipReview({
    requestId: REQUEST_ID,
    expectedFinalArtifactId: FINAL_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
    ...overrides,
  }, harness.dependencies);
}

function expectNoWrite(harness) {
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
}

describe('status projection at both stages', () => {
  test('a committed group-review Final reports canAdvance for the lead PD only', async () => {
    const harness = createHarness();
    const asLead = await getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: false, actingUserSystemId: LEAD_PD_ID },
      harness.dependencies,
    );
    expect(asLead).toMatchObject({ phase: 'group-review', canStart: false, canAdvance: true });
    const asOther = await getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: false, actingUserSystemId: OTHER_USER_ID },
      harness.dependencies,
    );
    expect(asOther).toMatchObject({ phase: 'group-review', canAdvance: false });
    const asSuperuser = await getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: true, actingUserSystemId: OTHER_USER_ID },
      harness.dependencies,
    );
    expect(asSuperuser).toMatchObject({ canAdvance: true });
  });

  test('a Final row in lifecycle FINAL with the complete checkpoint is the leadership-review phase', async () => {
    const harness = createHarness({
      finalLifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      finalOverrides: LEADERSHIP_FIELDS,
    });
    const status = await getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: false, actingUserSystemId: LEAD_PD_ID },
      harness.dependencies,
    );
    expect(status).toMatchObject({
      phase: 'leadership-review',
      canStart: false,
      canAdvance: false,
      artifact: {
        artifactId: FINAL_ID,
        lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        leadershipReview: {
          startedAt: LEADERSHIP_FIELDS.wmkf_leadershipreviewstartedat,
          startedById: LEAD_PD_ID,
        },
      },
    });
  });

  test.each([
    ['wmkf_leadershipreviewstartedat'],
    ['_wmkf_leadershipreviewstartedby_value'],
    ['wmkf_sharepointversionid'],
    ['wmkf_sharepointetag'],
    ['wmkf_sharepointlastmodified'],
    ['wmkf_filesize'],
    ['wmkf_contenthash'],
  ])('a FINAL row missing %s is not committed and reports for reconciliation', async (field) => {
    const harness = createHarness({
      finalLifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      finalOverrides: { ...LEADERSHIP_FIELDS, [field]: null },
    });
    await expect(getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: false, actingUserSystemId: LEAD_PD_ID },
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'final_writeup_committed_state_invalid', httpStatus: 500 });
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'final_writeup_committed_state_invalid',
    });
    expectNoWrite(harness);
  });

  test.each([
    ['blank leadership time', { wmkf_leadershipreviewstartedat: '   ' }],
    ['malformed leadership time', { wmkf_leadershipreviewstartedat: 'not-a-date' }],
    ['non-GUID leadership actor', { _wmkf_leadershipreviewstartedby_value: 'someone' }],
    ['blank version id', { wmkf_sharepointversionid: '' }],
    ['blank eTag', { wmkf_sharepointetag: ' ' }],
    ['malformed lastModified', { wmkf_sharepointlastmodified: 'yesterday' }],
    ['negative filesize', { wmkf_filesize: -1 }],
    ['non-numeric filesize', { wmkf_filesize: 'big' }],
    ['blank content hash', { wmkf_contenthash: '' }],
  ])('a FINAL row with %s is not committed', async (_label, overrides) => {
    const harness = createHarness({
      finalLifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      finalOverrides: { ...LEADERSHIP_FIELDS, ...overrides },
    });
    await expect(getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: false, actingUserSystemId: LEAD_PD_ID },
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'final_writeup_committed_state_invalid' });
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'final_writeup_committed_state_invalid',
    });
    expectNoWrite(harness);
  });

  test.each([
    REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    REQUEST_DOCUMENT_LIFECYCLE_STATE.BOARD_READY,
    REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
  ])('a current Final row in lifecycle %s is still rejected', async (lifecycle) => {
    const harness = createHarness({ finalLifecycle: lifecycle, finalOverrides: LEADERSHIP_FIELDS });
    await expect(getFinalWriteupStatus(
      { requestId: REQUEST_ID, isSuperuser: false, actingUserSystemId: LEAD_PD_ID },
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'final_writeup_committed_state_invalid' });
  });

  test('startFinalWriteup exact retry converges on a leadership-stage Final without writes', async () => {
    const harness = createHarness({
      finalLifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      finalOverrides: LEADERSHIP_FIELDS,
    });
    const result = await startFinalWriteup({
      requestId: REQUEST_ID,
      expectedArtifactId: SOURCE_ID,
      isSuperuser: false,
      actingUserSystemId: LEAD_PD_ID,
    }, harness.dependencies);
    expect(result).toMatchObject({ reused: true, inProgress: false });
    expect(result.artifact.lifecycleState).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL);
    expectNoWrite(harness);
    expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  });
});

describe('advanceToLeadershipReview', () => {
  test('moves the current Final row to leadership review in one fenced changeset', async () => {
    const harness = createHarness();
    const result = await advance(harness);

    expect(harness.dependencies.resolveActor).toHaveBeenCalledWith({
      actingUserSystemId: LEAD_PD_ID,
      policy: 'required',
    });
    expect(harness.dependencies.downloadFile).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.commitChangeset).toHaveBeenCalledTimes(1);
    const [operations, options] = harness.dependencies.commitChangeset.mock.calls[0];
    expect(options).toEqual({ actingUserSystemId: RESOLVED_ACTOR_ID });
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      method: 'PATCH',
      key: FINAL_ID,
      ifMatch: 'final-etag-1',
      body: {
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        wmkf_leadershipreviewstartedat: '2026-09-07T20:00:00.000Z',
        'wmkf_LeadershipReviewStartedBy@odata.bind': `/systemusers(${RESOLVED_ACTOR_ID})`,
        wmkf_sharepointversionid: '9.0',
        wmkf_sharepointetag: 'file-etag-9',
        wmkf_sharepointlastmodified: '2026-09-07T19:30:00Z',
        wmkf_filesize: 2100,
        wmkf_contenthash: 'gdc1:leadership-hash',
      },
    });
    const finalBodyKeys = Object.keys(operations[0].body);
    expect(finalBodyKeys.some((key) => /milestone/i.test(key))).toBe(false);
    expect(operations[1]).toMatchObject({
      method: 'PATCH',
      key: REQUEST_ID,
      ifMatch: 'request-etag-1',
      body: { 'wmkf_CurrentFinalWriteup@odata.bind': `/wmkf_requestdocuments(${FINAL_ID})` },
    });
    expect(result).toMatchObject({
      phase: 'leadership-review',
      reused: false,
      artifact: {
        artifactId: FINAL_ID,
        lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
        leadershipReview: { startedById: RESOLVED_ACTOR_ID },
        file: { versionId: '9.0', size: 2100 },
      },
    });
    expect(harness.final.wmkf_milestoneversionid).toBe('2.0');
    expect(harness.final._wmkf_milestonecreatedby_value).toBeUndefined();
  });

  test('exact retry on an already-advanced row returns the committed state without Graph or writes', async () => {
    const harness = createHarness({
      finalLifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
      finalOverrides: LEADERSHIP_FIELDS,
    });
    const result = await advance(harness);
    expect(result).toMatchObject({ phase: 'leadership-review', reused: true });
    expectNoWrite(harness);
    expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  });

  test.each([
    ['no current Final', (h) => { h.request._wmkf_currentfinalwriteup_value = null; }],
    ['a stale fence', () => {}, { expectedFinalArtifactId: OTHER_FINAL_ID }],
    ['an already-advanced row', (h) => {
      h.final.wmkf_lifecyclestate = REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL;
      Object.assign(h.final, LEADERSHIP_FIELDS);
    }],
  ])('a non-lead caller sees only 403 against %s, before any state inspection', async (_label, mutate, overrides = {}) => {
    const harness = createHarness();
    mutate(harness);
    await expect(advance(harness, { actingUserSystemId: OTHER_USER_ID, ...overrides }))
      .rejects.toMatchObject({ httpStatus: 403, code: 'final_writeup_leadership_forbidden' });
    expect(harness.dependencies.resolveActor).not.toHaveBeenCalled();
    expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
    expectNoWrite(harness);
  });

  test('a superuser may advance when the request has no lead PD; a non-superuser may not', async () => {
    const harness = createHarness();
    harness.request._wmkf_programdirector_value = null;
    await expect(advance(harness, { actingUserSystemId: OTHER_USER_ID }))
      .rejects.toMatchObject({ code: 'final_writeup_leadership_forbidden' });
    const result = await advance(harness, { isSuperuser: true, actingUserSystemId: OTHER_USER_ID });
    expect(result.phase).toBe('leadership-review');
  });

  test('a missing actor identity fails closed even for a superuser', async () => {
    const harness = createHarness();
    await expect(advance(harness, { isSuperuser: true, actingUserSystemId: null }))
      .rejects.toMatchObject({ httpStatus: 403, code: 'final_writeup_actor_required' });
    expect(harness.dependencies.getRequest).not.toHaveBeenCalled();
  });

  test('a stale or disabled actor is the resolver 403 with no Graph or Dataverse work', async () => {
    const harness = createHarness();
    harness.dependencies.resolveActor.mockRejectedValueOnce(Object.assign(
      new Error('identity unavailable'),
      { httpStatus: 403, code: 'request_document_actor_unavailable' },
    ));
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'request_document_actor_unavailable',
    });
    expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
    expectNoWrite(harness);
  });

  test('with the Wave 24 flag off the raw session id is the actor, as group review does', async () => {
    const harness = createHarness();
    harness.dependencies.resolveActor.mockResolvedValueOnce({
      schemaReady: false, actorId: null, reason: 'schema-not-ready',
    });
    await advance(harness);
    const [operations, options] = harness.dependencies.commitChangeset.mock.calls[0];
    expect(operations[0].body['wmkf_LeadershipReviewStartedBy@odata.bind'])
      .toBe(`/systemusers(${LEAD_PD_ID})`);
    expect(options).toEqual({ actingUserSystemId: LEAD_PD_ID });
  });

  test('the stale fence and missing pointer are distinct 409s for an authorized caller', async () => {
    const stale = createHarness();
    await expect(advance(stale, { expectedFinalArtifactId: OTHER_FINAL_ID }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'final_writeup_leadership_stale_final' });
    const missing = createHarness();
    missing.request._wmkf_currentfinalwriteup_value = null;
    await expect(advance(missing))
      .rejects.toMatchObject({ httpStatus: 409, code: 'final_writeup_leadership_final_missing' });
    expectNoWrite(stale);
    expectNoWrite(missing);
  });

  test('schema off performs no Dataverse work', async () => {
    const harness = createHarness();
    harness.dependencies.schemaReady.mockReturnValue(false);
    await expect(advance(harness)).rejects.toMatchObject({
      httpStatus: 503, code: 'final_writeup_schema_not_ready',
    });
    expect(harness.dependencies.getRequest).not.toHaveBeenCalled();
  });

  test('a Word change during verification writes nothing', async () => {
    const harness = createHarness();
    harness.dependencies.getFileMetadataById
      .mockResolvedValueOnce({ ...harness.metadata })
      .mockResolvedValueOnce({ ...harness.metadata, versionId: '10.0', eTag: 'file-etag-10' });
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'final_writeup_leadership_source_changed',
    });
    expectNoWrite(harness);
  });

  test('a Word change between verification and commit writes nothing', async () => {
    const harness = createHarness();
    harness.dependencies.getFileMetadataById
      .mockResolvedValueOnce({ ...harness.metadata })
      .mockResolvedValueOnce({ ...harness.metadata })
      .mockResolvedValueOnce({ ...harness.metadata, versionId: '10.0', eTag: 'file-etag-10' });
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'final_writeup_leadership_source_changed',
    });
    expectNoWrite(harness);
  });

  test('a current-Final pointer move between the initial read and commit writes nothing', async () => {
    const harness = createHarness();
    let reads = 0;
    harness.dependencies.getRequest.mockImplementation(async () => {
      reads += 1;
      return reads >= 2
        ? { ...harness.request, _wmkf_currentfinalwriteup_value: OTHER_FINAL_ID, _etag: 'request-etag-3' }
        : { ...harness.request };
    });
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'final_writeup_leadership_conflict',
    });
    expectNoWrite(harness);
  });

  test('a Final row version change between the initial read and commit writes nothing', async () => {
    const harness = createHarness();
    let reads = 0;
    harness.dependencies.findByRequest.mockImplementation(async () => {
      reads += 1;
      return {
        records: harness.rows.map((row) => (
          reads >= 2 && row.wmkf_requestdocumentid === FINAL_ID
            ? { ...row, _etag: 'final-etag-moved' }
            : { ...row }
        )),
      };
    });
    await expect(advance(harness)).rejects.toMatchObject({
      code: 'final_writeup_leadership_conflict',
    });
    expectNoWrite(harness);
  });

  test('a concurrent advance observed at commit time converges without a second write', async () => {
    const harness = createHarness();
    let reads = 0;
    harness.dependencies.findByRequest.mockImplementation(async () => {
      reads += 1;
      return {
        records: harness.rows.map((row) => (
          reads >= 2 && row.wmkf_requestdocumentid === FINAL_ID
            ? {
              ...row,
              wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL,
              ...LEADERSHIP_FIELDS,
              _etag: 'final-etag-other',
            }
            : { ...row }
        )),
      };
    });
    const result = await advance(harness);
    expect(result).toMatchObject({ phase: 'leadership-review', reused: true });
    expectNoWrite(harness);
  });

  test('a 412 from the changeset is the reload-and-retry conflict unless this call\'s write landed', async () => {
    const rejected = createHarness();
    rejected.dependencies.commitChangeset.mockRejectedValueOnce(Object.assign(new Error('412'), { status: 412 }));
    await expect(advance(rejected)).rejects.toMatchObject({
      code: 'final_writeup_leadership_conflict',
    });
    expect(rejected.final.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);

    const ambiguous = createHarness();
    const commit = ambiguous.dependencies.commitChangeset.getMockImplementation();
    ambiguous.dependencies.commitChangeset.mockImplementationOnce(async (operations, options) => {
      await commit(operations, options);
      throw Object.assign(new Error('response lost'), { status: 502 });
    });
    const result = await advance(ambiguous);
    expect(result).toMatchObject({ phase: 'leadership-review', reused: true });
    expect(ambiguous.dependencies.commitChangeset).toHaveBeenCalledTimes(1);
  });

  test('a changeset that resolves without the expected row state is an unconfirmed 500', async () => {
    const harness = createHarness();
    harness.dependencies.commitChangeset.mockResolvedValueOnce({ ok: true, operations: [] });
    await expect(advance(harness)).rejects.toMatchObject({
      httpStatus: 500, code: 'final_writeup_leadership_unconfirmed',
    });

    const drifted = createHarness();
    const commit = drifted.dependencies.commitChangeset.getMockImplementation();
    drifted.dependencies.commitChangeset.mockImplementationOnce(async (operations, options) => {
      await commit(operations, options);
      drifted.final.wmkf_sharepointversionid = '11.0';
    });
    await expect(advance(drifted)).rejects.toMatchObject({
      code: 'final_writeup_leadership_unconfirmed',
    });
  });

  test('invalid identities are rejected before any read', async () => {
    const harness = createHarness();
    await expect(advance(harness, { expectedFinalArtifactId: 'latest' }))
      .rejects.toMatchObject({ httpStatus: 400, code: 'final_writeup_invalid_identity' });
    expect(harness.dependencies.getRequest).not.toHaveBeenCalled();
  });
});
