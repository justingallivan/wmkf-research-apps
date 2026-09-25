jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(),
  recordPortalUploadCandidate: jest.fn(),
  renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import {
  finalizeTranscriptUpload,
  getPresentationMaterials,
  mintTranscriptUpload,
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
const STAGING_ID = '88888888-8888-4888-8888-888888888888';
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

function transcript(id, fence, overrides = {}) {
  return {
    wmkf_requestdocumentid: id,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_producer: 'meeting-tracker-post-presentation',
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: 'etag',
    wmkf_sharepointfolderpath: '1003220/Site Visit - Transcript',
    wmkf_filename: `1003220-Transcript-${STAGING_ID}.pdf`,
    wmkf_contenttype: 'application/pdf',
    wmkf_filesize: 8,
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
    getSharePointBuckets: jest.fn(async () => ([{
      source: 'dynamics', library: 'akoya_request', folder: '1003220',
    }])),
    ensureFolderPath: jest.fn(async () => ({})),
    uploadFile: jest.fn(async (_library, _folder, filename, buffer) => ({
      siteId: 'site', driveId: 'drive', id: 'item', name: filename,
      size: buffer.length, versionId: '1.0', eTag: 'etag', webUrl: 'https://example.test/file',
      lastModified: '2026-09-25T12:00:00Z',
    })),
    getFileMetadataById: jest.fn(async (driveId, itemId) => ({
      siteId: 'site', driveId, id: itemId, name: `1003220-Transcript-${STAGING_ID}.pdf`, size: 8,
      eTag: 'etag', versionId: '1.0',
    })),
    getFileMetadataByPath: jest.fn(async () => null),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-1.7') })),
    scanEnabled: jest.fn(() => false),
    scanBytes: jest.fn(async () => ({ scanResult: 'clean' })),
    createPortalUpload: jest.fn(async (args) => ({ stagingId: STAGING_ID, ...args })),
    recordPortalUploadCandidate: jest.fn(async () => ({})),
    renewPortalUploadLease: jest.fn(async () => ({ id: STAGING_ID })),
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
  }, expect.objectContaining({ actorPolicy: 'required', actingUserSystemId: ACTOR_ID }));
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

test('transcript mint reauthorizes the request and uses the exact code-owned staging contract', async () => {
  const d = deps();
  await expect(mintTranscriptUpload({
    requestId: REQUEST_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    filename: 'captions.vtt',
    contentType: 'text/vtt',
    size: 123,
  }, d)).resolves.toMatchObject({ stagingId: STAGING_ID });
  expect(d.findActiveSiteVisit).toHaveBeenCalledWith(REQUEST_ID);
  expect(d.createPortalUpload).toHaveBeenCalledWith(expect.objectContaining({
    scope: 'post_presentation_transcript',
    resourceId: REQUEST_ID,
    actorBinding: 'profile:42',
    filename: 'captions.vtt',
    contentType: 'text/vtt',
    maxBytes: 25 * 1024 * 1024,
  }));
});

test('transcript finalize records the exact Graph candidate before a fenced registry write', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const old = transcript(OLD_ID, 6);
  const current = transcript(NEW_ID, 7);
  const d = deps({
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [old] })
      .mockResolvedValueOnce({ records: [old, current] }),
  });
  const result = await finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf',
      mimeType: 'application/pdf',
      buffer: bytes,
      leaseToken: 'blob-lease',
      candidate: null,
    },
  }, d);

  expect(d.uploadFile).toHaveBeenCalledWith(
    'akoya_request',
    '1003220/Site Visit - Transcript',
    `1003220-Transcript-${STAGING_ID}.pdf`,
    bytes,
    'application/pdf',
    { conflictBehavior: 'fail' },
  );
  expect(d.recordPortalUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    stagingId: STAGING_ID,
    leaseToken: 'blob-lease',
    candidate: expect.objectContaining({
      requestId: REQUEST_ID,
      driveId: 'drive',
      itemId: 'item',
      size: bytes.length,
    }),
  }));
  expect(d.recordPortalUploadCandidate.mock.invocationCallOrder[0])
    .toBeLessThan(d.createDocument.mock.invocationCallOrder[0]);
  expect(d.createDocument).toHaveBeenCalledWith(expect.objectContaining({
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_contenthash: createHash('sha256').update(bytes).digest('hex'),
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
    wmkf_filesize: bytes.length,
    wmkf_slotversion: 7,
  }), expect.objectContaining({ actorPolicy: 'required', actingUserSystemId: ACTOR_ID }));
  expect(d.updateDocument).toHaveBeenCalledWith(OLD_ID, {
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
  }, expect.objectContaining({
    actorPolicy: 'required',
    actorContext: expect.objectContaining({ operation: 'post-presentation-supersede-transcript' }),
    actingUserSystemId: ACTOR_ID,
  }));
  expect(result).toMatchObject({ stagingId: STAGING_ID, requestDocumentId: NEW_ID, replayed: false });
});

test('transcript retry reuses and verifies its recorded candidate without another Graph upload', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT}:${STAGING_ID}:${sha256}`)
    .digest('hex');
  const candidate = {
    requestId: REQUEST_ID,
    generationKey,
    sha256,
    contentType: 'application/pdf',
    size: bytes.length,
    siteId: 'site',
    driveId: 'drive',
    itemId: 'item',
    versionId: '1.0',
    eTag: 'etag',
    folderPath: '1003220/Site Visit - Transcript',
    filename: `1003220-Transcript-${STAGING_ID}.pdf`,
    webUrl: 'https://example.test/file',
    lastModified: '2026-09-25T12:00:00Z',
  };
  const recovered = transcript(NEW_ID, 7, {
    wmkf_generationkey: generationKey,
    wmkf_inputfingerprint: sha256,
  });
  const d = deps({
    getFileMetadataById: jest.fn(async () => ({
      driveId: 'drive', id: 'item', name: candidate.filename, size: bytes.length,
      eTag: 'etag', versionId: '1.0',
    })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [recovered] })
      .mockResolvedValueOnce({ records: [recovered] }),
  });
  const result = await finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      leaseToken: 'blob-lease', candidate,
    },
  }, d);
  expect(d.getFileMetadataById).toHaveBeenCalledWith('drive', 'item', { siteId: 'site' });
  expect(d.uploadFile).not.toHaveBeenCalled();
  expect(d.recordPortalUploadCandidate).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
  expect(result.replayed).toBe(true);
});

test('candidate mismatch retains the ledger identity and stops before Graph, slot, or Dataverse writes', async () => {
  const d = deps();
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
      leaseToken: 'blob-lease', candidate: { requestId: REQUEST_ID, generationKey: 'wrong' },
    },
  }, d)).rejects.toMatchObject({ code: 'post_presentation_candidate_mismatch' });
  expect(d.uploadFile).not.toHaveBeenCalled();
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('infected transcript is refused before SharePoint or the slot lease', async () => {
  const d = deps({
    scanEnabled: jest.fn(() => true),
    scanBytes: jest.fn(async () => ({ scanResult: 'infected' })),
  });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
      leaseToken: 'blob-lease', candidate: null,
    },
  }, d)).rejects.toMatchObject({ code: 'scan_infected', httpStatus: 422 });
  expect(d.uploadFile).not.toHaveBeenCalled();
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
});

test('a lost upload response adopts only the matching deterministic-path item before registry creation', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const conflict = Object.assign(new Error('exists'), { status: 409 });
  const filename = `1003220-Transcript-${STAGING_ID}.pdf`;
  const current = transcript(NEW_ID, 7);
  const d = deps({
    uploadFile: jest.fn(async () => { throw conflict; }),
    getFileMetadataByPath: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'item', name: filename,
      size: bytes.length, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/file',
    })),
    downloadFile: jest.fn(async () => ({ buffer: bytes })),
    getFileMetadataById: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'item', name: filename,
      size: bytes.length, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/file',
    })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [current] }),
  });
  await finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      leaseToken: 'blob-lease', candidate: null,
    },
  }, d);
  expect(d.getFileMetadataByPath).toHaveBeenCalledWith(
    'akoya_request', '1003220/Site Visit - Transcript', filename,
  );
  expect(d.downloadFile).toHaveBeenCalledWith('drive', 'item');
  expect(d.recordPortalUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    candidate: expect.objectContaining({ driveId: 'drive', itemId: 'item' }),
  }));
  expect(d.recordPortalUploadCandidate.mock.invocationCallOrder[0])
    .toBeLessThan(d.createDocument.mock.invocationCallOrder[0]);
});

test('a 409 whose exact path is not visible yet remains retryable and records no guessed candidate', async () => {
  const conflict = Object.assign(new Error('exists'), { status: 409 });
  const d = deps({
    uploadFile: jest.fn(async () => { throw conflict; }),
    getFileMetadataByPath: jest.fn(async () => null),
  });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
      leaseToken: 'blob-lease', candidate: null,
    },
  }, d)).rejects.toMatchObject({
    code: 'post_presentation_candidate_unavailable',
    httpStatus: 503,
  });
  expect(d.recordPortalUploadCandidate).not.toHaveBeenCalled();
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
});

test('staging hash mismatch is refused before scan, Graph, slot, or Dataverse writes', async () => {
  const d = deps({ scanEnabled: jest.fn(() => true) });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
      sha256: 'wrong', leaseToken: 'blob-lease', candidate: null,
    },
  }, d)).rejects.toMatchObject({ code: 'post_presentation_content_mismatch' });
  expect(d.scanBytes).not.toHaveBeenCalled();
  expect(d.uploadFile).not.toHaveBeenCalled();
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('candidate reuse rejects same-name same-size content replaced under a new ETag', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT}:${STAGING_ID}:${sha256}`)
    .digest('hex');
  const candidate = {
    requestId: REQUEST_ID, generationKey, sha256, contentType: 'application/pdf', size: bytes.length,
    siteId: 'site', driveId: 'drive', itemId: 'item', versionId: '1.0', eTag: 'old-etag',
    folderPath: '1003220/Site Visit - Transcript', filename: `1003220-Transcript-${STAGING_ID}.pdf`,
  };
  const d = deps({
    getFileMetadataById: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'item', name: candidate.filename,
      size: bytes.length, eTag: 'new-etag', versionId: '2.0',
    })),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-1.6') })),
  });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      sha256, leaseToken: 'blob-lease', candidate,
    },
  }, d)).rejects.toMatchObject({ code: 'post_presentation_candidate_mismatch' });
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('metadata-only ETag/version drift is hash-verified, refreshed in the ledger, and replayed', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT}:${STAGING_ID}:${sha256}`)
    .digest('hex');
  const candidate = {
    requestId: REQUEST_ID, generationKey, sha256, contentType: 'application/pdf', size: bytes.length,
    siteId: 'site', driveId: 'drive', itemId: 'item', versionId: '1.0', eTag: 'old-etag',
    folderPath: '1003220/Site Visit - Transcript', filename: `1003220-Transcript-${STAGING_ID}.pdf`,
  };
  const recovered = transcript(NEW_ID, 7, {
    wmkf_generationkey: generationKey,
    wmkf_inputfingerprint: sha256,
    wmkf_sharepointversionid: '2.0',
    wmkf_sharepointetag: 'new-etag',
  });
  const freshMetadata = {
    siteId: 'site', driveId: 'drive', id: 'item', name: candidate.filename,
    size: bytes.length, eTag: 'new-etag', versionId: '2.0', webUrl: 'https://example.test/file',
  };
  const d = deps({
    getFileMetadataById: jest.fn(async () => freshMetadata),
    downloadFile: jest.fn(async () => ({ buffer: bytes })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [recovered] })
      .mockResolvedValueOnce({ records: [recovered] }),
  });
  const result = await finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      sha256, leaseToken: 'blob-lease', candidate,
    },
  }, d);
  expect(d.downloadFile).toHaveBeenCalledWith('drive', 'item');
  expect(d.recordPortalUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    candidate: expect.objectContaining({ eTag: 'new-etag', versionId: '2.0' }),
  }));
  expect(d.createDocument).not.toHaveBeenCalled();
  expect(result.replayed).toBe(true);
});

test('a candidate with no ETag or version is always byte-verified before reuse', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT}:${STAGING_ID}:${sha256}`)
    .digest('hex');
  const candidate = {
    requestId: REQUEST_ID, generationKey, sha256, contentType: 'application/pdf', size: bytes.length,
    siteId: 'site', driveId: 'drive', itemId: 'item', versionId: null, eTag: null,
    folderPath: '1003220/Site Visit - Transcript', filename: `1003220-Transcript-${STAGING_ID}.pdf`,
  };
  const d = deps({
    getFileMetadataById: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'item', name: candidate.filename,
      size: bytes.length, eTag: null, versionId: null,
    })),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('%PDF-1.6') })),
  });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      sha256, leaseToken: 'blob-lease', candidate,
    },
  }, d)).rejects.toMatchObject({ code: 'post_presentation_candidate_mismatch' });
  expect(d.downloadFile).toHaveBeenCalledWith('drive', 'item');
  expect(d.acquireSlotLease).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('the per-claim Blob lease token owns the Transcript slot and a second claim stays busy', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const d = deps({
    acquireSlotLease: jest.fn(async () => null),
    getSlotLease: jest.fn(async () => ({
      fence_version: 7,
      lease_token: 'first-claim-lease',
      lease_expires_at: '2026-09-25T12:05:00Z',
    })),
  });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      leaseToken: 'second-claim-lease', candidate: null,
    },
  }, d)).rejects.toMatchObject({ code: 'post_presentation_slot_busy' });
  expect(d.acquireSlotLease).toHaveBeenCalledWith(expect.objectContaining({
    leaseToken: 'second-claim-lease',
  }));
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('loss of the staging claim after candidate recording stops before Dataverse create', async () => {
  const lost = Object.assign(new Error('lost'), { code: 'finalize_lease_lost' });
  const d = deps({
    renewPortalUploadLease: jest.fn()
      .mockResolvedValueOnce({ id: STAGING_ID })
      .mockResolvedValueOnce({ id: STAGING_ID })
      .mockRejectedValueOnce(lost),
  });
  await expect(finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7'),
      leaseToken: 'blob-lease', candidate: null,
    },
  }, d)).rejects.toMatchObject({ code: 'finalize_lease_lost' });
  expect(d.recordPortalUploadCandidate).toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
  expect(d.updateDocument).not.toHaveBeenCalled();
});

test('an old transcript retry supersedes only its recovered row and preserves the newer winner', async () => {
  const bytes = Buffer.from('%PDF-1.7');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const generationKey = createHash('sha256')
    .update(`meeting-tracker-post-presentation:${REQUEST_ID}:${REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT}:${STAGING_ID}:${sha256}`)
    .digest('hex');
  const candidate = {
    requestId: REQUEST_ID, generationKey, sha256, contentType: 'application/pdf', size: bytes.length,
    siteId: 'site', driveId: 'drive', itemId: 'item', versionId: '1.0', eTag: 'etag',
    folderPath: '1003220/Site Visit - Transcript', filename: `1003220-Transcript-${STAGING_ID}.pdf`,
  };
  const recovered = transcript(OLD_ID, 7, {
    wmkf_generationkey: generationKey, wmkf_inputfingerprint: sha256,
  });
  const newer = transcript(NEW_ID, 8, { wmkf_sharepointitemid: 'newer-item' });
  const d = deps({
    acquireSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [recovered, newer] })
      .mockResolvedValueOnce({ records: [{
        ...recovered, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
      }, newer] }),
  });
  const result = await finalizeTranscriptUpload({
    requestId: REQUEST_ID,
    stagingId: STAGING_ID,
    actorProfileId: 42,
    actingUserSystemId: ACTOR_ID,
    file: {
      filename: 'transcript.pdf', mimeType: 'application/pdf', buffer: bytes,
      sha256, leaseToken: 'blob-lease', candidate,
    },
  }, d);
  expect(d.updateDocument).toHaveBeenCalledTimes(1);
  expect(d.updateDocument).toHaveBeenCalledWith(OLD_ID, {
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
  }, expect.objectContaining({
    actorPolicy: 'required',
    actorContext: expect.objectContaining({ operation: 'post-presentation-supersede-stale-transcript-retry' }),
  }));
  expect(result.materials[0].artifactId).toBe(NEW_ID);
  expect(result.reconciliationRequired).toBe(false);
});
