/**
 * @jest-environment node
 *
 * Pins Wave 23's fail-closed identity, one-observation publication, no-restamp,
 * conditional replacement, and ambiguous-write reconciliation contracts.
 */

import {
  deriveFinalWriteupAcknowledgementState,
  getFinalWriteupAcknowledgementState,
  markFinalWriteupReviewed,
} from '../../lib/services/final-writeup/acknowledgement-service.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FINAL_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_FINAL_ID = '33333333-3333-4333-8333-333333333333';
const REVIEWER_ID = '44444444-4444-4444-8444-444444444444';
const PD_ID = '55555555-5555-4555-8555-555555555555';
const ACK_ID = '66666666-6666-4666-8666-666666666666';

const BASE_OBSERVATION = Object.freeze({
  driveId: 'drive-1',
  id: 'item-1',
  versionId: '1.0',
  eTag: '"graph-1"',
  lastModified: '2026-08-31T12:00:00.000Z',
});

function request(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002788',
    _wmkf_programdirector_value: PD_ID,
    _wmkf_currentfinalwriteup_value: FINAL_ID,
    ...overrides,
  };
}

function finalDocument(overrides = {}) {
  return {
    wmkf_requestdocumentid: FINAL_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_sharepointsiteid: 'site-1',
    wmkf_sharepointdriveid: 'drive-1',
    wmkf_sharepointitemid: 'item-1',
    ...overrides,
  };
}

function acknowledgement(overrides = {}) {
  return {
    wmkf_finalwriteupreviewacknowledgementid: ACK_ID,
    _wmkf_finaldocument_value: FINAL_ID,
    _wmkf_reviewer_value: REVIEWER_ID,
    _wmkf_reviewer_value_formatted: 'Ada Reviewer',
    wmkf_sharepointdriveid: 'drive-1',
    wmkf_sharepointitemid: 'item-1',
    wmkf_publicationversionid: '1.0',
    wmkf_acknowledgedetag: '"stored-graph"',
    wmkf_sharepointlastmodified: '2026-08-31T11:00:00.000Z',
    wmkf_acknowledgedat: '2026-08-31T11:05:00.000Z',
    _etag: 'W/"7"',
    ...overrides,
  };
}

function harness({
  requestRow = request(),
  finalRow = finalDocument(),
  initialAcknowledgement = null,
  observation = BASE_OBSERVATION,
} = {}) {
  let durable = initialAcknowledgement ? { ...initialAcknowledgement } : null;
  const now = jest.fn(() => new Date('2026-08-31T12:05:00.000Z'));
  const dependencies = {
    schemaReady: jest.fn(() => true),
    getRequest: jest.fn(async () => requestRow),
    findDocumentsByRequest: jest.fn(async () => ({ records: [finalRow] })),
    getReviewer: jest.fn(async () => ({
      systemuserid: REVIEWER_ID,
      fullname: 'Ada Reviewer',
      isdisabled: false,
    })),
    getFileMetadataById: jest.fn(async () => ({ ...observation })),
    findAcknowledgement: jest.fn(async () => ({
      records: durable ? [{ ...durable }] : [],
    })),
    findAcknowledgements: jest.fn(async () => ({
      records: durable ? [{ ...durable }] : [],
    })),
    createAcknowledgement: jest.fn(async (payload) => {
      durable = {
        wmkf_finalwriteupreviewacknowledgementid: ACK_ID,
        _wmkf_finaldocument_value: FINAL_ID,
        _wmkf_reviewer_value: REVIEWER_ID,
        _wmkf_reviewer_value_formatted: 'Ada Reviewer',
        ...Object.fromEntries(Object.entries(payload).filter(([key]) => !key.includes('@odata.bind'))),
        _etag: 'W/"1"',
      };
      return { ...durable };
    }),
    updateAcknowledgement: jest.fn(async (_id, patch) => {
      durable = { ...durable, ...patch, _etag: 'W/"8"' };
    }),
    now,
  };
  return { dependencies, now, getDurable: () => durable };
}

const markArgs = (overrides = {}) => ({
  requestId: REQUEST_ID,
  expectedFinalArtifactId: FINAL_ID,
  actingUserSystemId: REVIEWER_ID,
  ...overrides,
});

test('readiness fails closed before any Dataverse or Graph call', async () => {
  const { dependencies } = harness();
  dependencies.schemaReady.mockReturnValue(false);
  const error = await markFinalWriteupReviewed(markArgs(), dependencies).catch((caught) => caught);
  expect(error.httpStatus).toBe(503);
  expect(error.body.code).toBe('final_writeup_acknowledgement_schema_not_ready');
  expect(dependencies.getRequest).not.toHaveBeenCalled();
  expect(dependencies.getFileMetadataById).not.toHaveBeenCalled();
});

test('mark requires an expected-current Final artifact fence', async () => {
  const { dependencies } = harness();
  const error = await markFinalWriteupReviewed(
    markArgs({ expectedFinalArtifactId: undefined }),
    dependencies,
  ).catch((caught) => caught);
  expect(error.httpStatus).toBe(400);
  expect(dependencies.getRequest).not.toHaveBeenCalled();
});

test('responsible PD self-acknowledgement is rejected before Graph or persistence', async () => {
  const { dependencies } = harness({ requestRow: request({ _wmkf_programdirector_value: REVIEWER_ID }) });
  const error = await markFinalWriteupReviewed(markArgs(), dependencies).catch((caught) => caught);
  expect(error.httpStatus).toBe(403);
  expect(error.body.code).toBe('final_writeup_acknowledgement_responsible_pd');
  expect(dependencies.getReviewer).not.toHaveBeenCalled();
  expect(dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(dependencies.createAcknowledgement).not.toHaveBeenCalled();
});

test('disabled or mismatched systemuser identity fails closed', async () => {
  const { dependencies } = harness();
  dependencies.getReviewer.mockResolvedValue({
    systemuserid: REVIEWER_ID,
    fullname: 'Ada Reviewer',
    isdisabled: true,
  });
  const error = await markFinalWriteupReviewed(markArgs(), dependencies).catch((caught) => caught);
  expect(error.httpStatus).toBe(403);
  expect(error.body.code).toBe('final_writeup_acknowledgement_reviewer_unavailable');
  expect(dependencies.getFileMetadataById).not.toHaveBeenCalled();
});

test('same publication version is a no-op that never restamps, even when eTag and last-modified changed', async () => {
  const stored = acknowledgement();
  const { dependencies, now } = harness({ initialAcknowledgement: stored });
  const result = await markFinalWriteupReviewed(markArgs(), dependencies);
  expect(result).toMatchObject({ personalState: 'reviewed', reused: true });
  expect(result.acknowledgedAt).toBe(stored.wmkf_acknowledgedat);
  expect(now).not.toHaveBeenCalled();
  expect(dependencies.createAcknowledgement).not.toHaveBeenCalled();
  expect(dependencies.updateAcknowledgement).not.toHaveBeenCalled();
  expect(dependencies.getFileMetadataById).toHaveBeenCalledTimes(1);
});

test('later publication version updates the same row with If-Match and explicit actor attribution', async () => {
  const { dependencies, getDurable } = harness({
    initialAcknowledgement: acknowledgement(),
    observation: { ...BASE_OBSERVATION, versionId: '2.0', eTag: '"graph-2"' },
  });
  const result = await markFinalWriteupReviewed(markArgs(), dependencies);
  expect(dependencies.updateAcknowledgement).toHaveBeenCalledWith(
    ACK_ID,
    expect.objectContaining({
      wmkf_publicationversionid: '2.0',
      wmkf_acknowledgedetag: '"graph-2"',
      wmkf_acknowledgedat: '2026-08-31T12:05:00.000Z',
    }),
    {
      ifMatch: 'W/"7"',
      actingUserSystemId: REVIEWER_ID,
      noFallback: true,
    },
  );
  expect(result).toMatchObject({ personalState: 'reviewed', reused: false });
  expect(getDurable().wmkf_publicationversionid).toBe('2.0');
  expect(dependencies.getFileMetadataById).toHaveBeenCalledTimes(1);
});

test('new acknowledgement binds only the resolved Final row and session reviewer', async () => {
  const { dependencies } = harness();
  const result = await markFinalWriteupReviewed(markArgs(), dependencies);
  expect(dependencies.createAcknowledgement).toHaveBeenCalledWith(
    expect.objectContaining({
      wmkf_name: '1002788 — Ada Reviewer',
      'wmkf_FinalDocument@odata.bind': `/wmkf_requestdocuments(${FINAL_ID})`,
      'wmkf_Reviewer@odata.bind': `/systemusers(${REVIEWER_ID})`,
      wmkf_publicationversionid: '1.0',
    }),
    { actingUserSystemId: REVIEWER_ID, noFallback: true },
  );
  expect(result).toMatchObject({ personalState: 'reviewed', reused: false });
});

test('a response-loss error after persistence is reconciled without false failure', async () => {
  const { dependencies } = harness({
    initialAcknowledgement: acknowledgement(),
    observation: { ...BASE_OBSERVATION, versionId: '2.0', eTag: '"graph-2"' },
  });
  dependencies.updateAcknowledgement.mockImplementationOnce(async (_id, patch) => {
    const current = (await dependencies.findAcknowledgement()).records[0];
    const committed = { ...current, ...patch, _etag: 'W/"8"' };
    dependencies.findAcknowledgement.mockResolvedValue({ records: [committed] });
    dependencies.findAcknowledgements.mockResolvedValue({ records: [committed] });
    throw new Error('connection closed after commit');
  });
  await expect(markFinalWriteupReviewed(markArgs(), dependencies)).resolves.toMatchObject({
    personalState: 'reviewed',
    reused: true,
  });
});

test('a 412 without the observed durable publication returns a retryable conflict', async () => {
  const { dependencies } = harness({
    initialAcknowledgement: acknowledgement(),
    observation: { ...BASE_OBSERVATION, versionId: '2.0' },
  });
  dependencies.updateAcknowledgement.mockRejectedValue(
    Object.assign(new Error('precondition failed'), { status: 412 }),
  );
  const error = await markFinalWriteupReviewed(markArgs(), dependencies).catch((caught) => caught);
  expect(error.httpStatus).toBe(409);
  expect(error.body.code).toBe('final_writeup_acknowledgement_conflict');
});

test('an incomplete stored acknowledgement fails closed instead of becoming a no-op', async () => {
  const { dependencies } = harness({
    initialAcknowledgement: acknowledgement({ wmkf_acknowledgedat: null }),
  });
  const error = await markFinalWriteupReviewed(markArgs(), dependencies).catch((caught) => caught);
  expect(error.httpStatus).toBe(500);
  expect(error.body.code).toBe('final_writeup_acknowledgement_stored_state_invalid');
  expect(dependencies.createAcknowledgement).not.toHaveBeenCalled();
  expect(dependencies.updateAcknowledgement).not.toHaveBeenCalled();
});

test.each([
  ['versionId', null],
  ['eTag', null],
  ['lastModified', 'not-a-date'],
  ['id', 'different-item'],
  ['id', 'ITEM-1'],
])('missing or contradictory Graph %s fails closed', async (field, value) => {
  const { dependencies } = harness({ observation: { ...BASE_OBSERVATION, [field]: value } });
  const error = await markFinalWriteupReviewed(markArgs(), dependencies).catch((caught) => caught);
  expect(error.body.code).toBe('final_writeup_acknowledgement_publication_unavailable');
  expect(dependencies.createAcknowledgement).not.toHaveBeenCalled();
  expect(dependencies.updateAcknowledgement).not.toHaveBeenCalled();
});

test('wrong expected Final artifact is rejected before reviewer or Graph access', async () => {
  const { dependencies } = harness();
  const error = await markFinalWriteupReviewed(
    markArgs({ expectedFinalArtifactId: OTHER_FINAL_ID }),
    dependencies,
  ).catch((caught) => caught);
  expect(error.body.code).toBe('final_writeup_acknowledgement_stale_final');
  expect(dependencies.getReviewer).not.toHaveBeenCalled();
  expect(dependencies.getFileMetadataById).not.toHaveBeenCalled();
});

test('read state derives updated only from publication-version mismatch and keeps eTag-only change reviewed', async () => {
  const { dependencies } = harness({ initialAcknowledgement: acknowledgement() });
  await expect(getFinalWriteupAcknowledgementState({
    requestId: REQUEST_ID,
    actingUserSystemId: REVIEWER_ID,
  }, dependencies)).resolves.toMatchObject({
    mayAcknowledge: true,
    personalState: 'reviewed',
    publicationLastModified: '2026-08-31T12:00:00.000Z',
    reviewers: [{ reviewerId: REVIEWER_ID, initials: 'AR', state: 'reviewed' }],
  });

  dependencies.getFileMetadataById.mockResolvedValue({ ...BASE_OBSERVATION, versionId: '2.0' });
  await expect(getFinalWriteupAcknowledgementState({
    requestId: REQUEST_ID,
    actingUserSystemId: REVIEWER_ID,
  }, dependencies)).resolves.toMatchObject({ personalState: 'updated' });
});

test('read state treats the responsible PD as not applicable without erasing positive reviewers', async () => {
  const { dependencies } = harness({
    requestRow: request({ _wmkf_programdirector_value: REVIEWER_ID }),
    initialAcknowledgement: acknowledgement({
      _wmkf_reviewer_value: PD_ID,
      _wmkf_reviewer_value_formatted: 'Pat Director',
    }),
  });
  const result = await getFinalWriteupAcknowledgementState({
    requestId: REQUEST_ID,
    actingUserSystemId: REVIEWER_ID,
  }, dependencies);
  expect(result).toMatchObject({
    mayAcknowledge: false,
    personalState: 'not-applicable',
    reviewers: [{ reviewerId: PD_ID, initials: 'PD' }],
  });
});

test('read state rejects duplicate reviewer rows even if the database key is expected to prevent them', async () => {
  const { dependencies } = harness({ initialAcknowledgement: acknowledgement() });
  dependencies.findAcknowledgements.mockResolvedValue({
    records: [acknowledgement(), acknowledgement({
      wmkf_finalwriteupreviewacknowledgementid: '77777777-7777-4777-8777-777777777777',
    })],
  });
  const error = await getFinalWriteupAcknowledgementState({
    requestId: REQUEST_ID,
    actingUserSystemId: REVIEWER_ID,
  }, dependencies).catch((caught) => caught);
  expect(error.httpStatus).toBe(500);
  expect(error.body.code).toBe('final_writeup_acknowledgement_duplicate_key');
});

test('state classifier complement is total for absent, exact, and different publications', () => {
  expect(deriveFinalWriteupAcknowledgementState(null, {
    driveId: 'drive-1', itemId: 'item-1', publicationVersionId: '1.0',
  })).toBe('unreviewed');
  expect(deriveFinalWriteupAcknowledgementState(acknowledgement(), {
    driveId: 'drive-1', itemId: 'item-1', publicationVersionId: '1.0',
  })).toBe('reviewed');
  expect(deriveFinalWriteupAcknowledgementState(acknowledgement(), {
    driveId: 'drive-1', itemId: 'item-1', publicationVersionId: '2.0',
  })).toBe('updated');
  expect(deriveFinalWriteupAcknowledgementState(acknowledgement(), {
    driveId: 'DRIVE-1', itemId: 'item-1', publicationVersionId: '1.0',
  })).toBe('updated');
});
