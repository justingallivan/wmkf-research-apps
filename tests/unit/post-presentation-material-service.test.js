import {
  getPresentationMaterials,
  saveZoomRecording,
} from '../../lib/services/post-presentation-materials/material-service.js';
import { createHash } from 'node:crypto';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const OPERATION_ID = '44444444-4444-4444-8444-444444444444';
const OLD_ID = '55555555-5555-4555-8555-555555555555';
const NEW_ID = '66666666-6666-4666-8666-666666666666';
const ZOOM_URL = 'https://us02web.zoom.us/rec/share/abc?pwd=secret';

function recording(id, fence, overrides = {}) {
  return {
    wmkf_requestdocumentid: id,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: 'meeting-tracker-post-presentation',
    wmkf_externalurl: ZOOM_URL,
    wmkf_slotversion: fence,
    createdon: `2026-09-25T12:00:0${fence}Z`,
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    schemaReady: jest.fn(() => true),
    requestAllowed: jest.fn(() => true),
    getRequest: jest.fn(async () => ({
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: '1003220',
      wmkf_meetingdate: '2026-12-10T00:00:00Z',
    })),
    findActiveSiteVisit: jest.fn(async () => ({ records: [{
      activityid: VISIT_ID,
      _regardingobjectid_value: REQUEST_ID,
    }] })),
    findDocuments: jest.fn(async () => ({ records: [] })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [] })),
    createDocument: jest.fn(async () => ({ wmkf_requestdocumentid: NEW_ID })),
    updateDocument: jest.fn(async () => ({})),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 7 })),
    getSlotLease: jest.fn(async () => null),
    renewSlotLease: jest.fn(async () => ({ fence_version: 7 })),
    releaseSlotLease: jest.fn(async () => ({})),
    recordEvent: jest.fn(async () => ({})),
    randomUUID: jest.fn(() => '77777777-7777-4777-8777-777777777777'),
    now: jest.fn(() => new Date('2026-09-25T12:00:00Z')),
    ...overrides,
  };
}

test('GET fails closed on readiness/access and requires exactly one active visit', async () => {
  await expect(getPresentationMaterials({ requestId: REQUEST_ID }, deps({ schemaReady: () => false })))
    .rejects.toMatchObject({ code: 'post_presentation_schema_not_ready', httpStatus: 503 });
  await expect(getPresentationMaterials({ requestId: REQUEST_ID }, deps({ requestAllowed: () => false })))
    .rejects.toMatchObject({ code: 'post_presentation_not_available', httpStatus: 404 });
  await expect(getPresentationMaterials({ requestId: REQUEST_ID }, deps({
    findActiveSiteVisit: jest.fn(async () => ({ records: [] })),
  }))).rejects.toMatchObject({ code: 'post_presentation_site_visit_required' });
});

test('Zoom save derives all governed fields, fences every mutation, and supersedes only the captured predecessor', async () => {
  const old = recording(OLD_ID, 6);
  const current = recording(NEW_ID, 7);
  const d = deps({
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [old] })
      .mockResolvedValueOnce({ records: [old, current] }),
  });
  const result = await saveZoomRecording({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: `Recording\n${ZOOM_URL}`,
    actingUserSystemId: ACTOR_ID,
  }, d);

  expect(d.createDocument).toHaveBeenCalledWith(expect.objectContaining({
    'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST_ID})`,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_cyclecode: 'D26',
    wmkf_producer: 'meeting-tracker-post-presentation',
    wmkf_externalurl: ZOOM_URL,
    wmkf_slotversion: 7,
  }), expect.objectContaining({
    actorPolicy: 'required',
    actingUserSystemId: ACTOR_ID,
  }));
  const payload = d.createDocument.mock.calls[0][0];
  expect(payload).not.toHaveProperty('wmkf_sharepointdriveid');
  expect(payload).not.toHaveProperty('wmkf_sharepointitemid');
  expect(d.renewSlotLease).toHaveBeenCalledTimes(3);
  expect(d.updateDocument).toHaveBeenCalledTimes(1);
  expect(d.updateDocument).toHaveBeenCalledWith(OLD_ID, {
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
  }, { actingUserSystemId: ACTOR_ID });
  expect(d.releaseSlotLease).toHaveBeenCalledWith(expect.objectContaining({ fenceVersion: 7 }));
  expect(result.materials[0].artifactId).toBe(NEW_ID);
  expect(result.replayed).toBe(false);
});

test('lost-response replay validates the row and reprojects instead of creating a duplicate', async () => {
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${OPERATION_ID}`)
    .digest('hex');
  const inputFingerprint = createHash('sha256').update(ZOOM_URL).digest('hex');
  const recovered = recording(NEW_ID, 7, {
    wmkf_generationkey: generationKey,
    wmkf_inputfingerprint: inputFingerprint,
  });
  const retry = deps({
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [recovered] })
      .mockResolvedValueOnce({ records: [recovered] }),
  });
  const result = await saveZoomRecording({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: ZOOM_URL,
    actingUserSystemId: ACTOR_ID,
  }, retry);
  expect(retry.createDocument).not.toHaveBeenCalled();
  expect(result.replayed).toBe(true);
  expect(result.materials[0].artifactId).toBe(NEW_ID);
});

test('an old operation retried after a newer winner reprojects that winner and cannot supersede it', async () => {
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${OPERATION_ID}`)
    .digest('hex');
  const inputFingerprint = createHash('sha256').update(ZOOM_URL).digest('hex');
  const recovered = recording(OLD_ID, 7, {
    wmkf_generationkey: generationKey,
    wmkf_inputfingerprint: inputFingerprint,
  });
  const newer = recording(NEW_ID, 8, {
    wmkf_externalurl: 'https://zoom.us/rec/share/newer?pwd=x',
  });
  const d = deps({
    acquireSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn(async () => ({ records: [recovered, newer] })),
  });
  const result = await saveZoomRecording({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: ZOOM_URL,
    actingUserSystemId: ACTOR_ID,
  }, d);
  expect(result.replayed).toBe(true);
  expect(result.materials[0].artifactId).toBe(NEW_ID);
  expect(d.createDocument).not.toHaveBeenCalled();
  expect(d.updateDocument).not.toHaveBeenCalled();
});

test('lease loss after create records reconciliation and cannot supersede predecessors', async () => {
  const d = deps({
    findDocuments: jest.fn(async () => ({ records: [recording(OLD_ID, 6)] })),
    renewSlotLease: jest.fn()
      .mockResolvedValueOnce({ fence_version: 7 })
      .mockResolvedValueOnce(null),
  });
  await expect(saveZoomRecording({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: ZOOM_URL,
    actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code: 'post_presentation_slot_lease_lost' });
  expect(d.updateDocument).not.toHaveBeenCalled();
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_material_reconciliation_required',
    stage: 'post-create-lease-lost',
  }));
});

test('an expired maximum fence fails closed and records a critical operational event', async () => {
  const d = deps({
    acquireSlotLease: jest.fn(async () => null),
    getSlotLease: jest.fn(async () => ({
      fence_version: 2147483647,
      lease_token: '99999999-9999-4999-8999-999999999999',
      lease_expires_at: '2026-01-01T00:00:00Z',
    })),
  });
  await expect(saveZoomRecording({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: ZOOM_URL,
    actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code: 'post_presentation_slot_fence_exhausted', httpStatus: 503 });
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_slot_fence_exhausted',
    severity: 'critical',
  }));
});

test('a reconciliation-event outage never replaces the successful material result', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const current = recording(NEW_ID, 7);
  const d = deps({
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [current, recording(OLD_ID, 6)] }),
    recordEvent: jest.fn(async () => { throw new Error('events unavailable'); }),
  });
  await expect(saveZoomRecording({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    zoomText: ZOOM_URL,
    actingUserSystemId: ACTOR_ID,
  }, d)).resolves.toMatchObject({
    materials: [expect.objectContaining({ artifactId: NEW_ID })],
    reconciliationRequired: true,
  });
  expect(warn).toHaveBeenCalledWith(
    '[post-presentation-materials] reconciliation event failed:',
    'events unavailable',
  );
  warn.mockRestore();
});
