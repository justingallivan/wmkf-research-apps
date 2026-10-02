jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(),
  recordPortalUploadCandidate: jest.fn(),
  renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import {
  finalizeMp4Upload,
  finalizeTranscriptUpload,
  getMp4UploadStatus,
  getPresentationMaterials,
  mintMp4Upload,
  mintTranscriptUpload,
  prepareMeetingTranscriptBundlePublication,
  publishMeetingTranscriptBundle,
  saveZoomRecording,
} from '../../lib/services/post-presentation-materials/material-service.js';
import { createHash } from 'node:crypto';
import { buildMeetingTranscriptFiles } from '../../lib/services/meeting-tracker-transcription/bundle.js';
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
const SUPERVISED_REQUEST_ID = '4236c2b3-b053-f111-bec7-6045bd015cb0';
const SUPERVISED_VISIT_ID = '38bf47c0-c1aa-46fc-b9d0-167aa76ad962';

function withSupervisedTestEnv(callback, overrides = {}) {
  const keys = [
    'MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED', 'VERCEL_PROJECT_ID', 'VERCEL_ENV', 'NODE_ENV',
    'MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE', 'NEXTAUTH_URL', 'DYNAMICS_URL', 'DYNAMICS_SANDBOX_URL',
    'MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY', 'MEETING_TRACKER_TRANSCRIPTION_ACCESS',
    'POST_PRESENTATION_MATERIALS_SCHEMA_READY', 'POST_PRESENTATION_MATERIALS_ACCESS',
    'MEETING_TRANSCRIPTION_REHEARSAL_ENABLED', 'TRANSCRIPTION_PILOT_ENABLED', 'TRANSCRIPTION_SUBMISSIONS_ENABLED',
    'AUTH_REQUIRED', 'EMERGENCY_AUTH_BYPASS', 'AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET',
    'AZURE_AD_TENANT_ID', 'NEXTAUTH_SECRET',
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED: 'on',
    VERCEL_PROJECT_ID: 'prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB',
    VERCEL_ENV: 'preview',
    NODE_ENV: 'production',
    MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: 'meeting-transcription-test',
    NEXTAUTH_URL: 'https://wmkf-meeting-transcription-test.vercel.app',
    DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com',
    DYNAMICS_SANDBOX_URL: 'https://orgd9e66399.crm.dynamics.com',
    MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY: 'on',
    MEETING_TRACKER_TRANSCRIPTION_ACCESS: `test:${SUPERVISED_REQUEST_ID}`,
    POST_PRESENTATION_MATERIALS_SCHEMA_READY: 'on',
    POST_PRESENTATION_MATERIALS_ACCESS: `test:${SUPERVISED_REQUEST_ID}`,
    AUTH_REQUIRED: 'true',
    EMERGENCY_AUTH_BYPASS: 'false',
    AZURE_AD_CLIENT_ID: 'configured',
    AZURE_AD_CLIENT_SECRET: 'configured',
    AZURE_AD_TENANT_ID: 'configured',
    NEXTAUTH_SECRET: 'unit-test-secret-that-is-long-enough',
    MEETING_TRANSCRIPTION_REHEARSAL_ENABLED: 'off',
    TRANSCRIPTION_PILOT_ENABLED: 'false',
    TRANSCRIPTION_SUBMISSIONS_ENABLED: 'false',
    ...overrides,
  });
  return Promise.resolve().then(callback).finally(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

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

function mp4Recording(id, fence, overrides = {}) {
  return recording(id, fence, {
    wmkf_externalurl: null,
    wmkf_generationkey: 'b'.repeat(64),
    wmkf_inputfingerprint: 'a'.repeat(64),
    wmkf_sharepointsiteid: 'site',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: 'etag',
    wmkf_sharepointfolderpath: '1003220/Post Site Visit Materials',
    wmkf_filename: `1003220-Recording-${OPERATION_ID}.mp4`,
    wmkf_contenttype: 'video/mp4',
    wmkf_filesize: 100,
    ...overrides,
  });
}

function mp4Intent(overrides = {}) {
  return {
    id: OPERATION_ID,
    request_id: REQUEST_ID,
    site_visit_id: VISIT_ID,
    actor_id: ACTOR_ID,
    artifact_type: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    original_display_filename: 'recording.mp4',
    validated_mime_type: 'video/mp4',
    declared_size: 100,
    client_resume_fingerprint: 'a'.repeat(64),
    library_name: 'akoya_request',
    folder_path: '1003220/Post Site Visit Materials',
    physical_filename: `1003220-Recording-${OPERATION_ID}.mp4`,
    generation_key: 'b'.repeat(64),
    state: 'initiated',
    upload_url_ciphertext: 'sealed-upload-url',
    upload_session_expires_at: '2026-09-25T11:00:00Z',
    intent_expires_at: '2026-09-28T12:00:00Z',
    candidate_item_id: null,
    request_document_id: null,
    created_at: '2026-09-25T12:00:00Z',
    updated_at: '2026-09-25T12:00:00Z',
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
    ensureFolderPath: jest.fn(async () => ({ siteId: 'site', driveId: 'drive' })),
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
    createBrowserUploadSession: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', uploadUrl: 'https://upload.example/session',
      expiresAt: '2026-09-25T13:00:00Z', nextExpectedRanges: ['0-'],
    })),
    getBrowserUploadSessionStatus: jest.fn(async () => ({
      expiresAt: '2026-09-25T14:00:00Z', nextExpectedRanges: ['10-'],
    })),
    readMediaRange: jest.fn(async () => ({
      mimeType: 'video/mp4', malware: null,
      bytes: Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(24)]),
    })),
    scanEnabled: jest.fn(() => false),
    scanBytes: jest.fn(async () => ({ scanResult: 'clean' })),
    createPortalUpload: jest.fn(async (args) => ({ stagingId: STAGING_ID, ...args })),
    recordPortalUploadCandidate: jest.fn(async () => ({})),
    renewPortalUploadLease: jest.fn(async () => ({ id: STAGING_ID })),
    getUploadIntent: jest.fn(async () => null),
    listUploadIntents: jest.fn(async () => []),
    insertUploadIntent: jest.fn(async (row) => ({ ...row, state: 'initiated' })),
    recordUploadSession: jest.fn(async () => ({ id: OPERATION_ID })),
    refreshUploadSession: jest.fn(async () => ({ id: OPERATION_ID })),
    markUploadFailed: jest.fn(async () => ({})),
    markUploadSessionClosed: jest.fn(async () => ({})),
    recordUploadCandidate: jest.fn(async () => ({ id: OPERATION_ID })),
    claimUploadIntent: jest.fn(async () => ({ state: 'not_found' })),
    renewUploadLease: jest.fn(async () => ({ id: OPERATION_ID })),
    releaseUploadIntent: jest.fn(async () => ({})),
    completeUploadIntent: jest.fn(async () => ({ id: OPERATION_ID, state: 'finalized' })),
    sealUploadUrl: jest.fn(() => 'sealed-upload-url'),
    openUploadUrl: jest.fn(() => 'https://upload.example/session'),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 7 })),
    getSlotLease: jest.fn(async () => null),
    renewSlotLease: jest.fn(async () => ({ fence_version: 7 })),
    releaseSlotLease: jest.fn(async () => ({})),
    recordEvent: jest.fn(async () => ({})),
    randomUUID: jest.fn(() => '77777777-7777-4777-8777-777777777777'),
    now: jest.fn(() => new Date('2026-09-25T12:00:00Z')),
    sleep: jest.fn(async () => {}),
    ...overrides,
  };
}

test('meeting transcript preparation freezes the exact real SharePoint destination before writes', async () => {
  const d = deps();
  const prepared = await prepareMeetingTranscriptBundlePublication({
    requestId: REQUEST_ID, operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID,
  }, d);
  expect(prepared.candidatePaths).toEqual({
    txt: `1003220/Site Visit - Transcript/1003220-Transcript-${OPERATION_ID}.txt`,
    vtt: `1003220/Site Visit - Transcript/1003220-Transcript-${OPERATION_ID}.vtt`,
    source: `1003220/Site Visit - Transcript/1003220-Transcript-${OPERATION_ID}.json`,
  });
  expect(d.ensureFolderPath).not.toHaveBeenCalled();
  expect(d.uploadFile).not.toHaveBeenCalled();
});

test('supervised publication prepares only the pinned test folder and rejects wrong request, visit, or host', async () => {
  await withSupervisedTestEnv(async () => {
    const d = deps({
      getRequest: jest.fn(async () => ({ akoya_requestid: SUPERVISED_REQUEST_ID, akoya_requestnum: '1000334', wmkf_meetingdate: '2026-12-10T00:00:00Z' })),
      findActiveSiteVisit: jest.fn(async () => ({ records: [{ activityid: SUPERVISED_VISIT_ID,
        _regardingobjectid_value: SUPERVISED_REQUEST_ID }] })),
      getSharePointBuckets: jest.fn(async () => ([{ source: 'dynamics', library: 'akoya_request', folder: '1000334' }])),
    });
    const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: SUPERVISED_REQUEST_ID,
      operationId: OPERATION_ID, siteVisitActivityId: SUPERVISED_VISIT_ID }, d);
    expect(prepared.folderPath).toBe(`1000334/TEST - Transcription Pilot/${OPERATION_ID}`);
    expect(prepared.candidatePaths.txt).toBe(`1000334/TEST - Transcription Pilot/${OPERATION_ID}/1000334-Transcript-${OPERATION_ID}.txt`);
    expect(d.ensureFolderPath).not.toHaveBeenCalled();
    expect(d.uploadFile).not.toHaveBeenCalled();

    await expect(prepareMeetingTranscriptBundlePublication({ requestId: REQUEST_ID,
      operationId: OPERATION_ID, siteVisitActivityId: SUPERVISED_VISIT_ID }, d))
      .rejects.toMatchObject({ code: 'meeting_transcription_supervised_test_binding_mismatch' });
    await expect(withSupervisedTestEnv(() => prepareMeetingTranscriptBundlePublication({
      requestId: SUPERVISED_REQUEST_ID, operationId: OPERATION_ID, siteVisitActivityId: SUPERVISED_VISIT_ID,
    }, d), { DYNAMICS_URL: 'https://wmkf.crm.dynamics.com' }))
      .rejects.toMatchObject({ code: 'meeting_transcription_supervised_test_misconfigured' });
    d.findActiveSiteVisit.mockResolvedValue({ records: [{ activityid: VISIT_ID,
      _regardingobjectid_value: SUPERVISED_REQUEST_ID }] });
    await expect(prepareMeetingTranscriptBundlePublication({ requestId: SUPERVISED_REQUEST_ID,
      operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID }, d))
      .rejects.toMatchObject({ code: 'meeting_transcription_supervised_test_binding_mismatch' });
    expect(d.ensureFolderPath).not.toHaveBeenCalled();
  });
});

test('supervised publication refuses a newly present current transcript before acquiring a slot or writing', async () => {
  await withSupervisedTestEnv(async () => {
    const d = deps({
      getRequest: jest.fn(async () => ({ akoya_requestid: SUPERVISED_REQUEST_ID, akoya_requestnum: '1000334', wmkf_meetingdate: '2026-12-10T00:00:00Z' })),
      findActiveSiteVisit: jest.fn(async () => ({ records: [{ activityid: SUPERVISED_VISIT_ID,
        _regardingobjectid_value: SUPERVISED_REQUEST_ID }] })),
      findDocuments: jest.fn(async () => ({ records: [transcript(OLD_ID, 1, { _wmkf_request_value: SUPERVISED_REQUEST_ID })] })),
      getSharePointBuckets: jest.fn(async () => ([{ source: 'dynamics', library: 'akoya_request', folder: '1000334' }])),
    });
    const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: SUPERVISED_REQUEST_ID,
      operationId: OPERATION_ID, siteVisitActivityId: SUPERVISED_VISIT_ID }, d);
    const oldSchemaFlag = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
    try {
      await expect(publishMeetingTranscriptBundle({ requestId: SUPERVISED_REQUEST_ID,
        operationId: OPERATION_ID, actorProfileId: 12, actingUserSystemId: ACTOR_ID,
        identity: { requestId: SUPERVISED_REQUEST_ID, siteVisitActivityId: SUPERVISED_VISIT_ID,
          revisionId: OPERATION_ID, operationId: OPERATION_ID, sourceRevisionId: null, formatterVersion: '1' },
        files: Object.fromEntries(['txt', 'vtt', 'source'].map(role => [role, {
          bytes: Buffer.from(role), sha256: createHash('sha256').update(role).digest('hex'), contentType: 'text/plain',
        }])), frozenInputSha256: 'a'.repeat(64), expectedCurrentArtifactId: null,
        expectedCurrentFingerprint: null, prepared, candidatePaths: prepared.candidatePaths,
        callbacks: { renew: jest.fn(async () => true), recordCandidate: jest.fn(async () => true),
          bindSlotFence: jest.fn(async () => true) },
      }, d)).rejects.toMatchObject({ code: 'meeting_transcription_supervised_test_transcript_exists' });
      expect(d.acquireSlotLease).not.toHaveBeenCalled();
      expect(d.ensureFolderPath).not.toHaveBeenCalled();
      expect(d.uploadFile).not.toHaveBeenCalled();
      expect(d.createDocument).not.toHaveBeenCalled();
    } finally {
      if (oldSchemaFlag === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
      else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = oldSchemaFlag;
    }
  });
});

test('bundle writer refuses to upload without mandatory durable receipt callbacks', async () => {
  const d = deps();
  const prepared = await prepareMeetingTranscriptBundlePublication({
    requestId: REQUEST_ID, operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID,
  }, d);
  const prior = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  try {
    await expect(publishMeetingTranscriptBundle({
      requestId: REQUEST_ID, operationId: OPERATION_ID, actorProfileId: 1, actingUserSystemId: ACTOR_ID,
      identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID }, prepared,
      candidatePaths: prepared.candidatePaths,
      files: Object.fromEntries(['txt','vtt','source'].map(role => [role, { bytes: Buffer.from(role), sha256: createHash('sha256').update(role).digest('hex'), contentType: 'text/plain' }])),
      frozenInputSha256: 'a'.repeat(64),
    }, d)).rejects.toMatchObject({ code: 'meeting_transcript_receipt_required' });
    expect(d.uploadFile).not.toHaveBeenCalled();
  } finally {
    if (prior === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = prior;
  }
});

test('publishes all three byte-verified files only after each exact candidate is recorded in the receipt', async () => {
  const stored = new Map();
  let registered = null;
  const d = deps({
    findDocuments: jest.fn(async () => ({ records: registered ? [registered] : [] })),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    releaseSlotLease: jest.fn(async () => ({})),
    reacquireSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    findMeetingTranscriptDocumentByGenerationKey: jest.fn(async () => ({ records: [] })),
    uploadFile: jest.fn(async (_library, _folder, filename, bytes) => {
      const role = filename.endsWith('.json') ? 'source' : filename.endsWith('.vtt') ? 'vtt' : 'txt';
      const itemId = `item-${role}`;
      const descriptor = { siteId: 'site', driveId: 'drive', id: itemId, name: filename,
        size: bytes.length, versionId: 'version-1', eTag: `etag-${role}`, webUrl: `https://example.test/${filename}` };
      stored.set(itemId, { descriptor, bytes });
      return descriptor;
    }),
    getFileMetadataById: jest.fn(async (_driveId, itemId) => stored.get(itemId)?.descriptor || null),
    downloadFile: jest.fn(async (_driveId, itemId, options) => {
      expect(options).toEqual({ maxBytes: 4_000_000 });
      return { buffer: stored.get(itemId).bytes };
    }),
    createDocument: jest.fn(async payload => {
      registered = transcript(NEW_ID, 17, { ...payload, _wmkf_request_value: REQUEST_ID, wmkf_requestdocumentid: NEW_ID });
      return registered;
    }),
  });
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: REQUEST_ID,
    operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID }, d);
  const generated = buildMeetingTranscriptFiles({
    content: { text: '', utterances: [{ speaker: 'A', start: 1000, end: 2000, text: 'Hello.' }] },
    speakerNames: { A: 'Chair' },
    identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID,
      revisionId: OPERATION_ID, operationId: OPERATION_ID, sourceRevisionId: null },
  });
  const receipt = [];
  const recordCandidate = jest.fn(async (role, candidatePath, descriptor) => {
    receipt.push({ role, candidatePath, descriptor });
    return true;
  });
  const oldFlag = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  try {
    const result = await publishMeetingTranscriptBundle({ requestId: REQUEST_ID, operationId: OPERATION_ID,
      actorProfileId: 12, actingUserSystemId: ACTOR_ID,
      identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: OPERATION_ID,
        operationId: OPERATION_ID, sourceRevisionId: null, formatterVersion: '1' },
      files: generated.files, frozenInputSha256: generated.inputSha256,
      expectedCurrentArtifactId: null, expectedCurrentFingerprint: null,
      prepared, candidatePaths: prepared.candidatePaths,
      callbacks: { renew: jest.fn(async () => true), bindSlotFence: jest.fn(async () => true), recordCandidate },
    }, d);
    expect(result).toMatchObject({ artifactId: NEW_ID, fingerprint: generated.inputSha256, bundleEditable: true });
    expect(receipt.map(item => item.role)).toEqual(['txt','vtt','source']);
    expect(receipt.map(item => item.candidatePath)).toEqual(['txt','vtt','source'].map(role => prepared.candidatePaths[role]));
    expect(recordCandidate.mock.invocationCallOrder.at(-1)).toBeLessThan(d.createDocument.mock.invocationCallOrder[0]);
    expect(d.uploadFile).toHaveBeenCalledTimes(3);
    expect(d.downloadFile).toHaveBeenCalledTimes(3);
    const generationKey = createHash('sha256').update([
      'meeting-tracker-post-presentation', REQUEST_ID.toLowerCase(),
      String(REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT), OPERATION_ID.toLowerCase(), generated.inputSha256,
    ].join(':')).digest('hex');
    expect(registered.wmkf_generationkey).toBe(generationKey);
  } finally {
    if (oldFlag === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = oldFlag;
  }
});

test('a candidate that the durable receipt does not confirm prevents registry creation', async () => {
  const stored = new Map();
  const d = deps({
    acquireSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    uploadFile: jest.fn(async (_library, _folder, filename, bytes) => {
      const role = filename.endsWith('.json') ? 'source' : filename.endsWith('.vtt') ? 'vtt' : 'txt';
      const descriptor = { siteId: 'site', driveId: 'drive', id: `item-${role}`, name: filename,
        size: bytes.length, versionId: 'version-1', eTag: `etag-${role}` };
      stored.set(descriptor.id, { descriptor, bytes });
      return descriptor;
    }),
    getFileMetadataById: jest.fn(async (_drive, id) => stored.get(id)?.descriptor || null),
    downloadFile: jest.fn(async (_drive, id, options) => {
      expect(options).toEqual({ maxBytes: 4_000_000 });
      return { buffer: stored.get(id).bytes };
    }),
  });
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: REQUEST_ID,
    operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID }, d);
  const generated = buildMeetingTranscriptFiles({
    content: { text: '', utterances: [{ speaker: 'A', start: 1000, end: 2000, text: 'Hello.' }] },
    speakerNames: { A: 'Chair' },
    identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID,
      revisionId: OPERATION_ID, operationId: OPERATION_ID, sourceRevisionId: null },
  });
  const receipt = [];
  const recordCandidate = jest.fn(async (role, candidatePath, descriptor) => {
    if (role === 'vtt') return undefined;
    receipt.push({ role, candidatePath, descriptor });
    return true;
  });
  const prior = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  try {
    await expect(publishMeetingTranscriptBundle({ requestId: REQUEST_ID, operationId: OPERATION_ID,
      actorProfileId: 12, actingUserSystemId: ACTOR_ID,
      identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: OPERATION_ID,
        operationId: OPERATION_ID, sourceRevisionId: null, formatterVersion: '1' },
      files: generated.files, frozenInputSha256: generated.inputSha256, expectedCurrentArtifactId: null,
      expectedCurrentFingerprint: null, prepared, candidatePaths: prepared.candidatePaths,
      callbacks: { renew: jest.fn(async () => true), bindSlotFence: jest.fn(async () => true), recordCandidate },
    }, d)).rejects.toMatchObject({ code: 'meeting_transcript_receipt_candidate_conflict' });
    expect(receipt.map(item => item.role)).toEqual(['txt']);
    expect(stored.size).toBe(2); // Remote files are retained for operator recovery.
    expect(d.uploadFile).toHaveBeenCalledTimes(2);
    expect(d.createDocument).not.toHaveBeenCalled();
    expect(d.downloadFile).toHaveBeenCalledTimes(2);
  } finally {
    if (prior === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = prior;
  }
});

test('a registry error after remote commit retains all receipt-bound files without deleting them', async () => {
  const stored = new Map();
  const receipt = [];
  let remotelyCommitted = null;
  const d = deps({
    acquireSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    findMeetingTranscriptDocumentByGenerationKey: jest.fn(async () => ({ records: [] })),
    uploadFile: jest.fn(async (_library, _folder, filename, bytes) => {
      const role = filename.endsWith('.json') ? 'source' : filename.endsWith('.vtt') ? 'vtt' : 'txt';
      const descriptor = { siteId: 'site', driveId: 'drive', id: `item-${role}`, name: filename,
        size: bytes.length, versionId: 'version-1', eTag: `etag-${role}` };
      stored.set(descriptor.id, { descriptor, bytes });
      return descriptor;
    }),
    getFileMetadataById: jest.fn(async (_drive, id) => stored.get(id)?.descriptor || null),
    downloadFile: jest.fn(async (_drive, id, options) => {
      expect(options).toEqual({ maxBytes: 4_000_000 });
      return { buffer: stored.get(id).bytes };
    }),
    createDocument: jest.fn(async payload => {
      remotelyCommitted = transcript(NEW_ID, 17, { ...payload,
        _wmkf_request_value: REQUEST_ID, wmkf_requestdocumentid: NEW_ID });
      const error = new Error('Response lost after remote registry commit');
      error.code = 'remote_commit_response_lost';
      throw error;
    }),
  });
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: REQUEST_ID,
    operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID }, d);
  const generated = buildMeetingTranscriptFiles({
    content: { text: '', utterances: [{ speaker: 'A', start: 1000, end: 2000, text: 'Hello.' }] },
    speakerNames: { A: 'Chair' },
    identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID,
      revisionId: OPERATION_ID, operationId: OPERATION_ID, sourceRevisionId: null },
  });
  const recordCandidate = jest.fn(async (role, candidatePath, descriptor) => {
    receipt.push({ role, candidatePath, descriptor });
    return true;
  });
  const prior = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  try {
    await expect(publishMeetingTranscriptBundle({ requestId: REQUEST_ID, operationId: OPERATION_ID,
      actorProfileId: 12, actingUserSystemId: ACTOR_ID,
      identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: OPERATION_ID,
        operationId: OPERATION_ID, sourceRevisionId: null, formatterVersion: '1' },
      files: generated.files, frozenInputSha256: generated.inputSha256, expectedCurrentArtifactId: null,
      expectedCurrentFingerprint: null, prepared, candidatePaths: prepared.candidatePaths,
      callbacks: { renew: jest.fn(async () => true), bindSlotFence: jest.fn(async () => true), recordCandidate },
    }, d)).rejects.toMatchObject({ code: 'remote_commit_response_lost' });
    expect(remotelyCommitted.wmkf_generationkey).toBe(createHash('sha256').update([
      'meeting-tracker-post-presentation', REQUEST_ID.toLowerCase(),
      String(REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT), OPERATION_ID.toLowerCase(), generated.inputSha256,
    ].join(':')).digest('hex'));
    expect(receipt.map(item => item.role)).toEqual(['txt', 'vtt', 'source']);
    expect(d.downloadFile).toHaveBeenCalledTimes(3);
    expect([...stored.keys()]).toEqual(['item-txt', 'item-vtt', 'item-source']);
    expect([...stored.values()].map(({ bytes }) => bytes)).toEqual([
      generated.files.txt.bytes, generated.files.vtt.bytes, generated.files.source.bytes,
    ]);
    expect(d.updateDocument).not.toHaveBeenCalled();
  } finally {
    if (prior === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = prior;
  }
});

test('recovery denied at the original fence cannot replace or supersede a newer winner', async () => {
  const newer = transcript(OLD_ID, 18, { wmkf_inputfingerprint: 'f'.repeat(64) });
  const d = deps({
    findDocuments: jest.fn(async () => ({ records: [newer] })),
    reacquireSlotLease: jest.fn(async () => null),
    uploadFile: jest.fn(),
    updateDocument: jest.fn(),
    createDocument: jest.fn(),
  });
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: REQUEST_ID,
    operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID }, d);
  const prior = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  try {
    await expect(publishMeetingTranscriptBundle({ requestId: REQUEST_ID, operationId: OPERATION_ID,
      actorProfileId: 12, actingUserSystemId: ACTOR_ID,
      identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: OPERATION_ID,
        operationId: OPERATION_ID, sourceRevisionId: null, formatterVersion: '1' },
      frozenInputSha256: 'a'.repeat(64), expectedCurrentArtifactId: OLD_ID,
      expectedCurrentFingerprint: 'f'.repeat(64), prepared, candidatePaths: prepared.candidatePaths,
      resumeVerifiedFiles: { txt: {}, vtt: {}, source: {} }, originalSlotFenceVersion: 17,
      callbacks: { renew: jest.fn(async () => true) },
    }, d)).rejects.toMatchObject({ code: 'meeting_transcript_original_fence_lost' });
    expect(d.reacquireSlotLease).toHaveBeenCalledWith({ requestId: REQUEST_ID,
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, leaseToken: OPERATION_ID, fenceVersion: 17 });
    expect(d.uploadFile).not.toHaveBeenCalled();
    expect(d.createDocument).not.toHaveBeenCalled();
    expect(d.updateDocument).not.toHaveBeenCalled();
    expect(newer.wmkf_requestdocumentid).toBe(OLD_ID);
  } finally {
    if (prior === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = prior;
  }
});

test.each(['versionId', 'eTag', 'siteId'])('bundle recovery rejects changed %s even when bytes are identical', async changedField => {
  let registered = null;
  const identity = { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID,
    revisionId: OPERATION_ID, operationId: OPERATION_ID, sourceRevisionId: null };
  const generated = buildMeetingTranscriptFiles({ identity,
    content: { text: 'Synthetic.', utterances: [{ speaker: 'A', start: 0, end: 1000, text: 'Synthetic.' }] },
    speakerNames: {} });
  const d = deps({
    findDocuments: jest.fn(async () => ({ records: registered ? [registered] : [] })),
    reacquireSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 17 })),
    findMeetingTranscriptDocumentByGenerationKey: jest.fn(async () => ({ records: [] })),
    createDocument: jest.fn(async payload => {
      registered = transcript(NEW_ID, 17, { ...payload, _wmkf_request_value: REQUEST_ID, wmkf_requestdocumentid: NEW_ID });
      return registered;
    }),
  });
  const prepared = await prepareMeetingTranscriptBundlePublication({ requestId: REQUEST_ID,
    operationId: OPERATION_ID, siteVisitActivityId: VISIT_ID }, d);
  const descriptors = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: 'version-1', eTag: `etag-${role}`,
    filename: prepared.filenames[role], contentType: file.contentType, size: file.bytes.length, sha256: file.sha256,
  }]));
  d.getFileMetadataById = jest.fn(async (_drive, role) => ({ ...descriptors[role],
    id: role, name: descriptors[role].filename, ...(role === 'txt' ? { [changedField]: 'changed' } : {}) }));
  d.downloadFile = jest.fn(async (_drive, role) => ({ buffer: generated.files[role].bytes }));
  const prior = process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  try {
    await expect(publishMeetingTranscriptBundle({ requestId: REQUEST_ID, operationId: OPERATION_ID,
      actorProfileId: 12, actingUserSystemId: ACTOR_ID, identity,
      frozenInputSha256: generated.inputSha256, expectedCurrentArtifactId: null,
      expectedCurrentFingerprint: null, prepared, candidatePaths: prepared.candidatePaths,
      resumeVerifiedFiles: descriptors, originalSlotFenceVersion: 17,
      callbacks: { renew: jest.fn(async () => true) },
    }, d)).rejects.toMatchObject({ code: 'meeting_transcript_receipt_candidate_conflict' });
    expect(d.downloadFile).toHaveBeenCalledWith('drive', 'txt', { maxBytes: 4_000_000 });
    expect(d.createDocument).not.toHaveBeenCalled();
    expect(d.updateDocument).not.toHaveBeenCalled();
    expect(d.uploadFile).not.toHaveBeenCalled();
  } finally {
    if (prior === undefined) delete process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY;
    else process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = prior;
  }
});

test('GET fails closed on readiness/access and requires exactly one active visit', async () => {
  await expect(getPresentationMaterials({ requestId: REQUEST_ID }, deps({ schemaReady: () => false })))
    .rejects.toMatchObject({ code: 'post_presentation_schema_not_ready', httpStatus: 503 });
  await expect(getPresentationMaterials({ requestId: REQUEST_ID }, deps({ requestAllowed: () => false })))
    .rejects.toMatchObject({ code: 'post_presentation_not_available', httpStatus: 404 });
  await expect(getPresentationMaterials({ requestId: REQUEST_ID }, deps({
    findActiveSiteVisit: jest.fn(async () => ({ records: [] })),
  }))).rejects.toMatchObject({ code: 'post_presentation_site_visit_required' });
});

test('GET exposes an expired finalizer for recovery but not a live finalizer', async () => {
  const d = deps({
    listUploadIntents: jest.fn(async () => ([
      mp4Intent({
        state: 'finalizing',
        lease_expires_at: '2026-09-25T11:59:59Z',
      }),
      mp4Intent({
        id: '99999999-9999-4999-8999-999999999999',
        state: 'finalizing',
        lease_expires_at: '2026-09-25T12:05:00Z',
      }),
    ])),
  });
  const result = await getPresentationMaterials({
    requestId: REQUEST_ID,
    actingUserSystemId: ACTOR_ID,
  }, d);
  expect(result.uploads).toEqual([
    expect.objectContaining({ uploadId: OPERATION_ID, state: 'finalizing', canFinalize: true }),
    expect.objectContaining({
      uploadId: '99999999-9999-4999-8999-999999999999',
      state: 'finalizing',
      canFinalize: false,
    }),
  ]);
});

test('failed uploads retain Retry after cleanup changes the terminal error label', async () => {
  const d = deps({ listUploadIntents: jest.fn(async () => [mp4Intent({
    state: 'failed', last_error: 'closed_session_inspect_only',
    upload_url_ciphertext: 'sealed-upload-url',
    lease_token: null,
  })]) });
  const result = await getPresentationMaterials({ requestId: REQUEST_ID, actingUserSystemId: ACTOR_ID }, d);
  expect(result.uploads[0]).toMatchObject({ canCancel: true, canRetry: true });
});

test('a permanently rejected MP4 is absent from unfinished uploads and cannot be checked again', async () => {
  const rejected = mp4Intent({ state: 'failed', candidate_item_id: 'item', last_error: 'post_presentation_mp4_signature_invalid' });
  const d = deps({
    listUploadIntents: jest.fn(async () => [rejected]),
    getUploadIntent: jest.fn(async () => rejected),
  });
  const projection = await getPresentationMaterials({ requestId: REQUEST_ID, actingUserSystemId: ACTOR_ID }, d);
  expect(projection.uploads).toEqual([]);
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID, uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID, resumeFingerprint: 'a'.repeat(64),
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_rejected' });
  expect(d.getFileMetadataByPath).not.toHaveBeenCalled();
  expect(d.recordUploadCandidate).not.toHaveBeenCalled();
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

test('MP4 begin persists the actor/request/visit/file intent before exposing a Graph session URL', async () => {
  const d = deps();
  const result = await mintMp4Upload({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    filename: 'recording.mp4',
    contentType: 'video/mp4',
    size: 100,
    resumeFingerprint: 'a'.repeat(64),
  }, d);
  expect(d.insertUploadIntent).toHaveBeenCalledWith(expect.objectContaining({
    id: OPERATION_ID,
    requestId: REQUEST_ID,
    siteVisitId: VISIT_ID,
    actorId: ACTOR_ID,
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    declaredSize: 100,
    clientResumeFingerprint: 'a'.repeat(64),
    physicalFilename: `1003220-Recording-${OPERATION_ID}.mp4`,
  }));
  expect(d.insertUploadIntent.mock.invocationCallOrder[0])
    .toBeLessThan(d.createBrowserUploadSession.mock.invocationCallOrder[0]);
  expect(d.recordUploadSession).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: OPERATION_ID,
    uploadUrlCiphertext: 'sealed-upload-url',
    expiresAt: '2026-09-25T13:00:00.000Z',
    intentExpiresAt: '2026-09-28T13:00:00.000Z',
  }));
  expect(result).toMatchObject({
    uploadId: OPERATION_ID,
    uploadUrl: 'https://upload.example/session',
    nextExpectedRanges: ['0-'],
    chunkBytes: 10 * 1024 * 1024,
  });
});

test('MP4 begin reports a failed session-creation replay as terminal instead of resumable', async () => {
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent({
      state: 'failed',
      upload_url_ciphertext: null,
    })),
  });
  await expect(mintMp4Upload({
    requestId: REQUEST_ID,
    operationId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    filename: 'recording.mp4',
    contentType: 'video/mp4',
    size: 100,
    resumeFingerprint: 'a'.repeat(64),
  }, d)).rejects.toMatchObject({
    code: 'post_presentation_upload_failed',
    httpStatus: 409,
    body: expect.objectContaining({ retryable: false }),
  });
  expect(d.createBrowserUploadSession).not.toHaveBeenCalled();
});

test('MP4 resume accepts Graph bounded remaining range and refreshes review-after', async () => {
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent()),
    getBrowserUploadSessionStatus: jest.fn(async () => ({
      expiresAt: '2026-09-25T14:00:00.000Z',
      nextExpectedRanges: ['10-99'],
    })),
  });
  const result = await getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d);
  expect(d.getBrowserUploadSessionStatus).toHaveBeenCalledWith('https://upload.example/session');
  expect(d.refreshUploadSession).toHaveBeenCalledWith({
    uploadId: OPERATION_ID,
    requestId: REQUEST_ID,
    actorId: ACTOR_ID,
    uploadUrlCiphertext: 'sealed-upload-url',
    expiresAt: '2026-09-25T14:00:00.000Z',
    intentExpiresAt: '2026-09-28T14:00:00.000Z',
  });
  expect(result).toMatchObject({
    complete: false,
    uploadUrl: 'https://upload.example/session',
    nextExpectedRanges: ['10-99'],
  });
});

test('MP4 resume continues to accept Graph open-ended remaining range', async () => {
  const d = deps({ getUploadIntent: jest.fn(async () => mp4Intent()) });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d)).resolves.toMatchObject({
    complete: false,
    nextExpectedRanges: ['10-'],
  });
  expect(d.refreshUploadSession).toHaveBeenCalled();
});

test.each(['10-98', '10-100'])(
  'MP4 resume rejects bounded range %s whose end does not match the declared file',
  async (nextRange) => {
    const d = deps({
      getUploadIntent: jest.fn(async () => mp4Intent()),
      getBrowserUploadSessionStatus: jest.fn(async () => ({
        expiresAt: '2026-09-25T14:00:00.000Z',
        nextExpectedRanges: [nextRange],
      })),
    });
    await expect(getMp4UploadStatus({
      requestId: REQUEST_ID,
      uploadId: OPERATION_ID,
      actingUserSystemId: ACTOR_ID,
      resumeFingerprint: 'a'.repeat(64),
    }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_range_invalid', httpStatus: 502 });
    expect(d.refreshUploadSession).not.toHaveBeenCalled();
  },
);

test('MP4 resume rejects a different edge fingerprint before Graph or path access', async () => {
  const d = deps({ getUploadIntent: jest.fn(async () => mp4Intent()) });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'c'.repeat(64),
  }, d)).rejects.toMatchObject({ code: 'post_presentation_resume_fingerprint_mismatch' });
  expect(d.getFileMetadataByPath).not.toHaveBeenCalled();
  expect(d.getBrowserUploadSessionStatus).not.toHaveBeenCalled();
});

test('MP4 resume exposes Finish saving when the exact full-size item is stable', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/item',
    lastModified: '2026-09-25T12:30:00Z',
  };
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent()),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({ ...pathItem })),
  });
  const result = await getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d);
  expect(result).toMatchObject({ complete: true, canFinalize: true, uploadId: OPERATION_ID });
  expect(d.recordUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: OPERATION_ID,
    candidate: expect.objectContaining({ driveId: 'drive', itemId: 'item', size: 100 }),
    leaseToken: null,
  }));
  expect(d.getBrowserUploadSessionStatus).not.toHaveBeenCalled();
});

test('MP4 status refuses to overwrite an active finalizer candidate', async () => {
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent({
      state: 'finalizing',
      lease_token: 'live-finalizer',
      lease_expires_at: '2026-09-25T12:05:00Z',
    })),
  });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d)).rejects.toMatchObject({
    code: 'post_presentation_finalize_in_progress',
    body: expect.objectContaining({ retryable: true }),
  });
  expect(d.getFileMetadataByPath).not.toHaveBeenCalled();
  expect(d.recordUploadCandidate).not.toHaveBeenCalled();
});

test('stale Resume explains when another tab already cancelled the upload', async () => {
  const d = deps({ getUploadIntent: jest.fn(async () => mp4Intent({
    state: 'abandoned', upload_url_ciphertext: null,
  })) });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID, uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID, resumeFingerprint: 'a'.repeat(64),
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_cancelled', httpStatus: 409 });
  expect(d.getFileMetadataByPath).not.toHaveBeenCalled();
});

test('MP4 status recovers an expired finalizer when the exact item is stable', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/item',
  };
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent({
      state: 'finalizing',
      lease_token: 'expired-finalizer',
      lease_expires_at: '2026-09-25T11:59:59Z',
    })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({ ...pathItem })),
  });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d)).resolves.toMatchObject({ complete: true, canFinalize: true });
  expect(d.recordUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: OPERATION_ID,
    leaseToken: null,
  }));
});

test('MP4 stability uses cTag locally when the stable read has no publication version', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', cTag: 'ctag-version', versionId: 'ctag-version',
    webUrl: 'https://example.test/item',
  };
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent()),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({
      ...pathItem,
      versionId: null,
      cTag: 'ctag-version',
    })),
  });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d)).resolves.toMatchObject({ complete: true, canFinalize: true });
  expect(d.recordUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    candidate: expect.objectContaining({ versionId: 'ctag-version' }),
  }));
});

test('Graph-confirmed MP4 session expiry is persisted as terminal only after exact-item rechecks', async () => {
  const gone = Object.assign(new Error('gone'), { status: 410 });
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent()),
    getBrowserUploadSessionStatus: jest.fn(async () => { throw gone; }),
  });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
    resumeFingerprint: 'a'.repeat(64),
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_session_expired', httpStatus: 410 });
  expect(d.getFileMetadataByPath).toHaveBeenCalledTimes(3);
  expect(d.sleep).toHaveBeenNthCalledWith(1, 2_000);
  expect(d.sleep).toHaveBeenNthCalledWith(2, 8_000);
  expect(d.markUploadSessionClosed).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: OPERATION_ID,
    lastError: 'session_expired',
  }));
});

test('Graph 410 with a visible partial placeholder remains uncertain and does not enable Retry', async () => {
  const d = deps({
    getUploadIntent: jest.fn(async () => mp4Intent()),
    getFileMetadataByPath: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'partial',
      name: `1003220-Recording-${OPERATION_ID}.mp4`, size: 20,
    })),
    getBrowserUploadSessionStatus: jest.fn(async () => {
      throw Object.assign(new Error('expired'), { status: 410 });
    }),
  });
  await expect(getMp4UploadStatus({
    requestId: REQUEST_ID, uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID, resumeFingerprint: 'a'.repeat(64),
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_reconciliation_pending' });
  expect(d.markUploadSessionClosed).toHaveBeenCalledWith(expect.objectContaining({
    uploadUrlCiphertext: 'sealed-upload-url', lastError: 'session_closed_unknown',
  }));
});

test('MP4 finalize validates the bounded signature and records the candidate before Dataverse', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/item',
    lastModified: '2026-09-25T12:30:00Z',
  };
  const claimed = mp4Intent({ state: 'finalizing', lease_token: 'intent-lease' });
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({ state: 'claimed', row: claimed, leaseToken: 'intent-lease' })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({ ...pathItem })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [] })
      .mockResolvedValueOnce({ records: [] }),
  });
  const result = await finalizeMp4Upload({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
  }, d);
  expect(d.readMediaRange).toHaveBeenCalledWith('drive', 'item', { start: 0, end: 31 });
  expect(d.recordUploadCandidate.mock.invocationCallOrder[0])
    .toBeLessThan(d.createDocument.mock.invocationCallOrder[0]);
  expect(d.acquireSlotLease).toHaveBeenCalledWith(expect.objectContaining({
    requestId: REQUEST_ID,
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING,
    leaseToken: OPERATION_ID,
  }));
  expect(d.createDocument).toHaveBeenCalledWith(expect.objectContaining({
    wmkf_contenttype: 'video/mp4',
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
    wmkf_filesize: 100,
  }), expect.objectContaining({ actorPolicy: 'required' }));
  expect(d.completeUploadIntent).toHaveBeenCalledWith({
    uploadId: OPERATION_ID,
    leaseToken: 'intent-lease',
    requestDocumentId: NEW_ID,
  });
  expect(result).toMatchObject({ uploadId: OPERATION_ID, requestDocumentId: NEW_ID });
});

test('MP4 finalize refuses an incomplete placeholder before Request Document creation', async () => {
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({
      state: 'claimed', row: mp4Intent({ state: 'finalizing' }), leaseToken: 'intent-lease',
    })),
    getFileMetadataByPath: jest.fn(async () => ({
      siteId: 'site', driveId: 'drive', id: 'partial',
      name: `1003220-Recording-${OPERATION_ID}.mp4`, size: 50,
    })),
  });
  await expect(finalizeMp4Upload({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_incomplete' });
  expect(d.createDocument).not.toHaveBeenCalled();
  expect(d.releaseUploadIntent).toHaveBeenCalledWith(expect.objectContaining({
    uploadId: OPERATION_ID,
    leaseToken: 'intent-lease',
  }));
});

test.each([
  ['invalid signature', { mimeType: 'video/mp4', malware: null, bytes: Buffer.alloc(32) }, 'post_presentation_mp4_signature_invalid'],
  ['malware', { mimeType: 'application/octet-stream', malware: true, bytes: Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(24)]) }, 'post_presentation_mp4_malware'],
])('MP4 finalize makes %s a terminal rejection before creating a Request Document', async (_label, media, code) => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0',
  };
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({ state: 'claimed', row: mp4Intent({ state: 'finalizing' }), leaseToken: 'intent-lease' })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => pathItem),
    readMediaRange: jest.fn(async () => media),
  });
  await expect(finalizeMp4Upload({
    requestId: REQUEST_ID, uploadId: OPERATION_ID, actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code });
  expect(d.recordUploadCandidate).toHaveBeenCalledTimes(1);
  expect(d.releaseUploadIntent).toHaveBeenCalledWith({
    uploadId: OPERATION_ID, leaseToken: 'intent-lease', lastError: code, terminal: true,
  });
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_upload_validation_rejected',
    metadata: { uploadId: OPERATION_ID, reason: code },
  }));
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('missing Graph MP4 MIME metadata remains retryable when bytes have a valid signature', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0',
  };
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({ state: 'claimed', row: mp4Intent({ state: 'finalizing' }), leaseToken: 'intent-lease' })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => pathItem),
    readMediaRange: jest.fn(async () => ({
      mimeType: 'application/octet-stream', malware: null,
      bytes: Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(24)]),
    })),
  });
  await expect(finalizeMp4Upload({
    requestId: REQUEST_ID, uploadId: OPERATION_ID, actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code: 'post_presentation_mp4_mime_unconfirmed', body: { retryable: true } });
  expect(d.releaseUploadIntent).toHaveBeenCalledWith({
    uploadId: OPERATION_ID, leaseToken: 'intent-lease',
    lastError: 'post_presentation_mp4_mime_unconfirmed', terminal: false,
  });
  expect(d.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_upload_validation_rejected',
  }));
});

test('MP4 finalize refuses a previously rejected candidate without reclaiming it', async () => {
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({ state: 'rejected', row: mp4Intent({ state: 'failed', candidate_item_id: 'item' }) })),
  });
  await expect(finalizeMp4Upload({
    requestId: REQUEST_ID, uploadId: OPERATION_ID, actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_rejected' });
  expect(d.getFileMetadataByPath).not.toHaveBeenCalled();
  expect(d.createDocument).not.toHaveBeenCalled();
});

test('an old MP4 retry supersedes only its recovered row and preserves the newer winner', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/item',
  };
  const recovered = mp4Recording(OLD_ID, 7);
  const newer = mp4Recording(NEW_ID, 8, {
    wmkf_generationkey: 'c'.repeat(64),
    wmkf_sharepointitemid: 'newer-item',
  });
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({
      state: 'claimed', row: mp4Intent({ state: 'finalizing' }), leaseToken: 'intent-lease',
    })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({ ...pathItem })),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn(async () => ({ records: [recovered, newer] })),
  });
  const result = await finalizeMp4Upload({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
  }, d);
  expect(d.createDocument).not.toHaveBeenCalled();
  expect(d.updateDocument).toHaveBeenCalledTimes(1);
  expect(d.updateDocument).toHaveBeenCalledWith(OLD_ID, expect.objectContaining({
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
  }), expect.any(Object));
  expect(d.completeUploadIntent).toHaveBeenCalledWith(expect.objectContaining({ requestDocumentId: OLD_ID }));
  expect(result).toMatchObject({ replayed: true, requestDocumentId: OLD_ID });
  expect(result.materials[0].artifactId).toBe(NEW_ID);
});

test('an old MP4 retry records reconciliation if its intent lease is lost after the registry mutation', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/item',
  };
  const recovered = mp4Recording(OLD_ID, 7);
  const newer = mp4Recording(NEW_ID, 8, {
    wmkf_generationkey: 'c'.repeat(64),
    wmkf_sharepointitemid: 'newer-item',
  });
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({
      state: 'claimed', row: mp4Intent({ state: 'finalizing' }), leaseToken: 'intent-lease',
    })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({ ...pathItem })),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    renewSlotLease: jest.fn(async () => ({ fence_version: 9 })),
    renewUploadLease: jest.fn()
      .mockResolvedValueOnce({ id: OPERATION_ID })
      .mockResolvedValueOnce({ id: OPERATION_ID })
      .mockResolvedValueOnce({ id: OPERATION_ID })
      .mockResolvedValueOnce({ id: OPERATION_ID })
      .mockResolvedValueOnce(null),
    findDocumentByGenerationKey: jest.fn(async () => ({ records: [recovered] })),
    findDocuments: jest.fn(async () => ({ records: [recovered, newer] })),
  });
  await expect(finalizeMp4Upload({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
  }, d)).rejects.toMatchObject({ code: 'post_presentation_upload_lease_lost' });
  expect(d.updateDocument).toHaveBeenCalledWith(OLD_ID, expect.any(Object), expect.any(Object));
  expect(d.completeUploadIntent).not.toHaveBeenCalled();
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_material_reconciliation_required',
    stage: 'stale-retry-finalize',
    entityRefs: expect.objectContaining({ requestDocumentId: OLD_ID }),
  }));
});

test('MP4 predecessor failure finalizes the winner and reports reconciliation', async () => {
  const pathItem = {
    siteId: 'site', driveId: 'drive', id: 'item', name: `1003220-Recording-${OPERATION_ID}.mp4`,
    size: 100, eTag: 'etag', versionId: '1.0', webUrl: 'https://example.test/item',
  };
  const old = mp4Recording(OLD_ID, 6, { wmkf_generationkey: 'old'.padEnd(64, '0') });
  const current = mp4Recording(NEW_ID, 7);
  const d = deps({
    claimUploadIntent: jest.fn(async () => ({
      state: 'claimed', row: mp4Intent({ state: 'finalizing' }), leaseToken: 'intent-lease',
    })),
    getFileMetadataByPath: jest.fn(async () => pathItem),
    getFileMetadataById: jest.fn(async () => ({ ...pathItem })),
    findDocuments: jest.fn()
      .mockResolvedValueOnce({ records: [old] })
      .mockResolvedValueOnce({ records: [old, current] }),
    updateDocument: jest.fn(async () => { throw new Error('Dataverse unavailable'); }),
  });
  await expect(finalizeMp4Upload({
    requestId: REQUEST_ID,
    uploadId: OPERATION_ID,
    actingUserSystemId: ACTOR_ID,
  }, d)).resolves.toMatchObject({
    requestDocumentId: NEW_ID,
    reconciliationRequired: true,
  });
  expect(d.completeUploadIntent).toHaveBeenCalled();
  expect(d.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    stage: 'predecessor-supersede',
  }));
});
