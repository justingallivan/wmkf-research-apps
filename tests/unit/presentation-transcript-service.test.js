/** @jest-environment node */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import { createHash } from 'node:crypto';
import { bindPresentationTranscript } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { projectPostPresentationMaterials } from '../../lib/services/post-presentation-materials/material-model.js';
import { generatePresentationTranscript } from '../../lib/services/post-presentation-materials/presentation-transcript-service.js';
import { presentationTranscriptGenerationKey, staffDiscussionTranscriptGenerationKey } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { buildPresentationTranscriptText, buildStaffDiscussionTranscriptText } from '../../lib/services/meeting-tracker-transcription/presentation-boundary.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../../lib/services/request-document-actor-service.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const TRANSCRIPT_ID = '44444444-4444-4444-8444-444444444444';
const OLD_ID = '55555555-5555-4555-8555-555555555555';
const NEW_ID = '66666666-6666-4666-8666-666666666666';
const DISC_ID = '99999999-9999-4999-8999-999999999999';
const DISC_OLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const LEASE_TOKEN = '88888888-8888-4888-8888-888888888888';
const boundary = { endMs: 2000, confirmedBy: 8, confirmedAt: '2026-10-04T09:30:00.000Z' };
// The Board page shows this name, so it carries the boundary time and never a revision id.
const PRESENTATION_FILENAME = '1002912-Presentation-Transcript-ends-0h00m02s.txt';
const DISCUSSION_FILENAME = '1002912-Staff-Discussion-Transcript-from-0h00m02s.txt';
const content = { text: 'x', utterances: [
  { speaker: 'A', start: 0, end: 1000, text: 'Welcome.' },
  { speaker: 'B', start: 1000, end: 2000, text: 'Our project.' },
  { speaker: 'A', start: 2000, end: 3000, text: 'Staff only discussion.' },
] };
const speakerNames = { A: 'Foundation Staff', B: 'Applicant Lead' };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oldEnv = { ...process.env };

let generated; let transcriptRow; let state; let deps; let uploadedBytes; let uploads;
const presentationKey = (endMs) => presentationTranscriptGenerationKey({
  requestId: REQUEST_ID, sourceRevisionId: REVISION_ID, presentationEndMs: endMs });
const discussionKey = (endMs) => staffDiscussionTranscriptGenerationKey({
  requestId: REQUEST_ID, sourceRevisionId: REVISION_ID, presentationEndMs: endMs });
const discussionRow = (id, key, extra = {}) => presentationRow(id, key, {
  wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT, ...extra });
const presentationRow = (id, key, extra = {}) => ({ wmkf_requestdocumentid: id, _wmkf_request_value: REQUEST_ID,
  wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT,
  wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
  wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_producer: 'meeting-tracker-post-presentation',
  wmkf_generationkey: key, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: `item-${id}`,
  wmkf_slotversion: 2, createdon: '2026-10-05T10:00:00Z', ...extra });

beforeEach(() => {
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  generated = buildMeetingTranscriptFiles({ content, speakerNames, identity: { requestId: REQUEST_ID,
    siteVisitActivityId: VISIT_ID, revisionId: REVISION_ID, operationId: REVISION_ID, sourceRevisionId: null,
    presentationEnd: boundary } });
  const files = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: '1', eTag: `tag-${role}`,
    filename: file.filename, contentType: file.contentType, sha256: file.sha256, size: file.bytes.length }]));
  const manifest = buildMeetingTranscriptManifest({ identity: { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID,
    revisionId: REVISION_ID, operationId: REVISION_ID, sourceRevisionId: null, presentationEnd: boundary }, files });
  transcriptRow = { wmkf_requestdocumentid: TRANSCRIPT_ID, _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT, wmkf_producer: 'meeting-tracker-post-presentation',
    wmkf_inputfingerprint: generated.inputSha256, wmkf_transcriptbundlejson: JSON.stringify(manifest),
    wmkf_sharepointsiteid: 'site', wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: 'txt',
    wmkf_sharepointversionid: '1', wmkf_sharepointetag: 'tag-txt', wmkf_filename: files.txt.filename,
    wmkf_contenttype: files.txt.contentType, wmkf_contenthash: files.txt.sha256, wmkf_filesize: files.txt.size,
    wmkf_slotversion: 3, createdon: '2026-10-04T10:00:00Z' };
  state = { rows: [transcriptRow], byKey: [] };
  uploadedBytes = null;
  uploads = new Map();
  deps = {
    schemaReady: jest.fn(() => true), requestAllowed: jest.fn(() => true),
    loadBinding: jest.fn(async () => ({ requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID })),
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1002912', wmkf_meetingdate: '2026-12-04' })),
    findActiveSiteVisit: jest.fn(async () => ({ records: [{ activityid: VISIT_ID, _regardingobjectid_value: REQUEST_ID }] })),
    findDocuments: jest.fn(async () => ({ records: state.rows })),
    findByGenerationKey: jest.fn(async () => ({ records: state.byKey })),
    createDocument: jest.fn(async (payload) => {
      const id = payload.wmkf_artifacttype === REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT ? DISC_ID : NEW_ID;
      const row = presentationRow(id, payload.wmkf_generationkey, { wmkf_slotversion: payload.wmkf_slotversion,
        wmkf_artifacttype: payload.wmkf_artifacttype, createdon: '2026-10-05T11:00:00Z' });
      state.rows = [...state.rows, row];
      return { wmkf_requestdocumentid: id };
    }),
    updateDocument: jest.fn(async (id, patch) => {
      state.rows = state.rows.map((row) => (row.wmkf_requestdocumentid === id ? { ...row, ...patch } : row));
    }),
    getSharePointBuckets: jest.fn(async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'akoya_request/1002912_x' }]),
    ensureFolderPath: jest.fn(async () => {}),
    uploadFile: jest.fn(async (_library, _folder, filename, bytes) => {
      const id = filename.includes('Staff-Discussion') ? 'disc-item' : 'pres-item';
      uploads.set(id, { filename, bytes });
      if (id === 'pres-item') uploadedBytes = bytes;
      return { id, driveId: 'drive', siteId: 'site', name: filename, size: bytes.length };
    }),
    getFileMetadataById: jest.fn(async (_drive, itemId) => (uploads.has(itemId)
      ? { driveId: 'drive', id: itemId, name: uploads.get(itemId).filename,
        size: uploads.get(itemId).bytes.length, eTag: 'e1', versionId: 'v1', siteId: 'site', webUrl: `https://sp/${itemId}`,
        lastModified: '2026-10-05T11:00:00Z' }
      : { eTag: 'tag-source', versionId: '1' })),
    downloadFile: jest.fn(async (_drive, itemId) => ({ buffer: uploads.has(itemId) ? uploads.get(itemId).bytes : generated.files.source.bytes })),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 5 })),
    getSlotLease: jest.fn(async () => null),
    renewSlotLease: jest.fn(async () => ({ fence_version: 5 })),
    releaseSlotLease: jest.fn(async () => ({})),
    recordEvent: jest.fn(async () => {}),
    randomUUID: jest.fn(() => LEASE_TOKEN),
    now: () => new Date('2026-10-05T11:00:00Z'),
  };
});
afterAll(() => { process.env = oldEnv; });

const call = (overrides = {}) => generatePresentationTranscript({ requestId: REQUEST_ID, ownerProfileId: 12,
  actingUserSystemId: ACTOR, body: { expectedCurrentArtifactId: TRANSCRIPT_ID,
    expectedCurrentFingerprint: generated.inputSha256, ...overrides } }, deps);

test('writes the presentation-only TXT, registers the row under the derivative key, supersedes the older row', async () => {
  state.rows = [transcriptRow, presentationRow(OLD_ID, presentationKey(1000)), discussionRow(DISC_ID, discussionKey(2000))];
  const outcome = await call();
  expect(outcome).toMatchObject({ presentationTranscript: { artifactId: NEW_ID, state: 'bound' },
    currentArtifact: { id: TRANSCRIPT_ID, presentationEnd: boundary,
      presentationTranscript: { artifactId: NEW_ID, state: 'bound' } } });

  const expectedText = buildPresentationTranscriptText(content, speakerNames, 2000);
  // BOM-prefixed so SharePoint and the Board's browser read it as UTF-8.
  expect([...uploadedBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(uploadedBytes.toString('utf8')).toBe(`\uFEFF${expectedText}`);
  expect(expectedText).toContain('Our project.');
  expect(expectedText).not.toContain('Staff only discussion.');
  expect(deps.uploadFile).toHaveBeenCalledWith('akoya_request', 'akoya_request/1002912_x/Site Visit - Presentation Transcript',
    PRESENTATION_FILENAME, uploadedBytes, 'text/plain; charset=utf-8', { conflictBehavior: 'replace' });
  expect(PRESENTATION_FILENAME).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);

  const [payload, options] = deps.createDocument.mock.calls[0];
  expect(payload).toMatchObject({
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT,
    wmkf_generationkey: presentationKey(2000), wmkf_inputfingerprint: sha(uploadedBytes),
    wmkf_contenthash: sha(uploadedBytes), wmkf_claimtoken: LEASE_TOKEN, wmkf_slotversion: 5,
    wmkf_producer: 'meeting-tracker-post-presentation', wmkf_filesize: uploadedBytes.length,
    wmkf_sharepointversionid: 'v1', wmkf_sharepointetag: 'e1',
    wmkf_name: '1002912 research presentation transcript (presentation only)',
    'wmkf_Request@odata.bind': `/akoya_requests(${REQUEST_ID})`,
  });
  expect(payload).not.toHaveProperty('wmkf_transcriptbundlejson');
  expect(options).toMatchObject({ actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED, actingUserSystemId: ACTOR,
    actorContext: { operation: 'meeting-tracker-presentation-transcript', requestId: REQUEST_ID, operationId: LEASE_TOKEN } });
  expect(deps.updateDocument).toHaveBeenCalledTimes(1);
  expect(deps.updateDocument).toHaveBeenCalledWith(OLD_ID, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED },
    expect.objectContaining({ actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED }));
  expect(deps.acquireSlotLease).toHaveBeenCalledWith({ requestId: REQUEST_ID,
    artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, leaseToken: LEASE_TOKEN });
  expect(deps.releaseSlotLease).toHaveBeenCalledWith(expect.objectContaining({ fenceVersion: 5, leaseToken: LEASE_TOKEN }));
});

test('one action writes both halves: the presentation first, then the staff discussion, each under its own type, lease, folder, and key', async () => {
  state.rows = [transcriptRow, presentationRow(OLD_ID, presentationKey(1000)), discussionRow(DISC_OLD_ID, discussionKey(1000))];
  const outcome = await call();
  expect(outcome).toMatchObject({ presentationTranscript: { artifactId: NEW_ID, state: 'bound' },
    staffDiscussionTranscript: { artifactId: DISC_ID, state: 'bound' },
    currentArtifact: { staffDiscussionTranscript: { artifactId: DISC_ID, state: 'bound' } } });
  expect(deps.acquireSlotLease.mock.calls.map(([arg]) => arg.artifactType)).toEqual([
    REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT]);
  expect(deps.uploadFile.mock.calls.map((call) => [call[1], call[2]])).toEqual([
    ['akoya_request/1002912_x/Site Visit - Presentation Transcript', PRESENTATION_FILENAME],
    ['akoya_request/1002912_x/Site Visit - Staff Discussion Transcript', DISCUSSION_FILENAME],
  ]);
  const discussionText = uploads.get('disc-item').bytes.toString('utf8');
  expect(discussionText).toBe(`\uFEFF${buildStaffDiscussionTranscriptText(content, speakerNames, 2000)}`);
  expect(discussionText).toContain('Staff only discussion.');
  expect(discussionText).not.toContain('Our project.');
  const [payload, options] = deps.createDocument.mock.calls[1];
  expect(payload).toMatchObject({ wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT,
    wmkf_generationkey: discussionKey(2000), wmkf_name: '1002912 site visit staff discussion transcript (staff only)',
    wmkf_filename: DISCUSSION_FILENAME });
  expect(payload).not.toHaveProperty('wmkf_transcriptbundlejson');
  expect(options).toMatchObject({ actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
    actorContext: { operation: 'meeting-tracker-staff-discussion-transcript' } });
  expect(deps.updateDocument).toHaveBeenCalledWith(DISC_OLD_ID, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, expect.anything());
  expect(deps.downloadFile.mock.calls.filter(([, itemId]) => itemId === 'source')).toHaveLength(1);
  expect(deps.releaseSlotLease).toHaveBeenCalledTimes(2);
});

test('a boundary at the last utterance writes a one-line discussion note, never an empty file', async () => {
  const lastEnd = { ...boundary, endMs: 3000 };
  generated = buildMeetingTranscriptFiles({ content, speakerNames, identity: { requestId: REQUEST_ID,
    siteVisitActivityId: VISIT_ID, revisionId: REVISION_ID, operationId: REVISION_ID, sourceRevisionId: null, presentationEnd: lastEnd } });
  const manifest = JSON.parse(transcriptRow.wmkf_transcriptbundlejson);
  manifest.presentationEnd = lastEnd;
  manifest.files.source = { ...manifest.files.source, sha256: generated.files.source.sha256, size: generated.files.source.bytes.length };
  transcriptRow = { ...transcriptRow, wmkf_transcriptbundlejson: JSON.stringify(manifest), wmkf_inputfingerprint: generated.inputSha256 };
  state.rows = [transcriptRow];
  await call();
  expect(uploads.get('disc-item').bytes.toString('utf8')).toBe('\uFEFFNo discussion was recorded after the presentation ended at 0h00m03s.\n');
});

test('a bound presentation transcript with a missing discussion writes only the discussion', async () => {
  state.rows = [transcriptRow, presentationRow(OLD_ID, presentationKey(2000))];
  await expect(call()).resolves.toMatchObject({ presentationTranscript: { artifactId: OLD_ID, state: 'bound' },
    staffDiscussionTranscript: { artifactId: DISC_ID, state: 'bound' } });
  expect(deps.acquireSlotLease).toHaveBeenCalledTimes(1);
  expect(deps.acquireSlotLease.mock.calls[0][0].artifactType).toBe(REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT);
  expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  expect(deps.createDocument).toHaveBeenCalledTimes(1);
  expect(deps.createDocument.mock.calls[0][0].wmkf_artifacttype).toBe(REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT);
});

test('an already-bound row is returned without a lease, an upload, or a write', async () => {
  state.rows = [transcriptRow, presentationRow(OLD_ID, presentationKey(2000)), discussionRow(DISC_ID, discussionKey(2000))];
  await expect(call()).resolves.toMatchObject({ presentationTranscript: { artifactId: OLD_ID, state: 'bound' } });
  expect(deps.acquireSlotLease).not.toHaveBeenCalled();
  expect(deps.uploadFile).not.toHaveBeenCalled();
  expect(deps.createDocument).not.toHaveBeenCalled();
});

test('a same-key row outranked by a newer stale derivative is restored under the fence and the stale one superseded, with no upload', async () => {
  const prior = presentationRow(OLD_ID, presentationKey(2000), { wmkf_slotversion: 4 });
  const stale = presentationRow(NEW_ID, presentationKey(1000), { wmkf_slotversion: 4, createdon: '2026-10-05T12:00:00Z' });
  state.rows = [transcriptRow, prior, stale, discussionRow(DISC_ID, discussionKey(2000))];
  state.byKey = [prior];
  await expect(call()).resolves.toMatchObject({ presentationTranscript: { artifactId: OLD_ID, state: 'bound' } });
  expect(deps.uploadFile).not.toHaveBeenCalled();
  expect(deps.createDocument).not.toHaveBeenCalled();
  expect(deps.updateDocument).toHaveBeenCalledWith(OLD_ID, expect.objectContaining({ wmkf_slotversion: 5,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT }), expect.objectContaining({ actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED }));
  expect(deps.updateDocument).toHaveBeenCalledWith(NEW_ID, { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, expect.anything());
  expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
  // After the restore the outside binding selects the restored row.
  expect(bindPresentationTranscript(projectPostPresentationMaterials(state.rows, REQUEST_ID).winners, REQUEST_ID))
    .toMatchObject({ reason: 'bound', presentationTranscript: { wmkf_requestdocumentid: OLD_ID } });
});

test('a same-key row that was superseded (boundary moved away and back) is restored rather than duplicated', async () => {
  const prior = presentationRow(OLD_ID, presentationKey(2000), { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED, wmkf_slotversion: 2 });
  state.rows = [transcriptRow, prior, discussionRow(DISC_ID, discussionKey(2000))];
  state.byKey = [prior];
  await expect(call()).resolves.toMatchObject({ presentationTranscript: { artifactId: OLD_ID, state: 'bound' } });
  expect(deps.uploadFile).not.toHaveBeenCalled();
  expect(deps.createDocument).not.toHaveBeenCalled();
  expect(deps.updateDocument).toHaveBeenCalledTimes(1);
});

test('a same-key row for another request or producer fails closed', async () => {
  state.byKey = [presentationRow(OLD_ID, presentationKey(2000), { wmkf_producer: 'someone-else' })];
  await expect(call()).rejects.toMatchObject({ code: 'presentation_transcript_registry_conflict', httpStatus: 409 });
  expect(deps.uploadFile).not.toHaveBeenCalled();
  expect(deps.updateDocument).not.toHaveBeenCalled();
});

test('a registry failure after the upload records a reconciliation event naming the orphan file', async () => {
  deps.createDocument.mockRejectedValueOnce(Object.assign(new Error('dataverse down'), { code: 'dataverse_unavailable' }));
  await expect(call()).rejects.toMatchObject({ code: 'dataverse_unavailable' });
  expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    eventType: 'post_presentation_material_reconciliation_required', stage: 'presentation-transcript-register',
    metadata: expect.objectContaining({ reason: 'dataverse_unavailable', filename: PRESENTATION_FILENAME }) }));
  expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
});

test('a supersede failure after the row is registered is recorded and the bound result is still returned', async () => {
  state.rows = [transcriptRow, presentationRow(OLD_ID, presentationKey(1000)), discussionRow(DISC_ID, discussionKey(2000))];
  deps.updateDocument.mockRejectedValueOnce(Object.assign(new Error('patch failed'), { code: 'dataverse_patch_failed' }));
  await expect(call()).resolves.toMatchObject({ presentationTranscript: { artifactId: NEW_ID, state: 'bound' } });
  expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
    stage: 'presentation-transcript-supersede', entityRefs: expect.objectContaining({ predecessorIds: [OLD_ID] }) }));
});

test('an unconfirmed boundary is a 409 and writes nothing', async () => {
  const manifest = { ...JSON.parse(transcriptRow.wmkf_transcriptbundlejson), presentationEnd: null };
  state.rows = [{ ...transcriptRow, wmkf_transcriptbundlejson: JSON.stringify(manifest) }];
  await expect(call()).rejects.toMatchObject({ code: 'presentation_end_not_confirmed', httpStatus: 409 });
  expect(deps.acquireSlotLease).not.toHaveBeenCalled();
  expect(deps.uploadFile).not.toHaveBeenCalled();
});

test.each([
  ['artifact', { expectedCurrentArtifactId: OLD_ID }],
  ['fingerprint', { expectedCurrentFingerprint: 'f'.repeat(64) }],
])('a changed current transcript (%s) is a 409 and writes nothing', async (_label, override) => {
  await expect(call(override)).rejects.toMatchObject({ code: 'meeting_transcript_current_changed', httpStatus: 409 });
  expect(deps.acquireSlotLease).not.toHaveBeenCalled();
  expect(deps.uploadFile).not.toHaveBeenCalled();
});

test('the transcript changing after the upload aborts before registering and still releases the lease', async () => {
  let reads = 0;
  deps.findDocuments.mockImplementation(async () => {
    reads += 1;
    return { records: reads >= 3 ? [{ ...transcriptRow, wmkf_requestdocumentid: OLD_ID }] : state.rows };
  });
  await expect(call()).rejects.toMatchObject({ code: 'meeting_transcript_current_changed' });
  expect(deps.uploadFile).toHaveBeenCalledTimes(1);
  expect(deps.createDocument).not.toHaveBeenCalled();
  expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
});

test.each([
  ['wrong bytes', async () => ({ buffer: Buffer.from('tampered') })],
])('an uploaded file whose bytes do not match fails closed without a row (%s)', async (_label, download) => {
  deps.downloadFile.mockImplementation(async (_drive, itemId) => (itemId === 'pres-item'
    ? download() : { buffer: generated.files.source.bytes }));
  await expect(call()).rejects.toMatchObject({ code: 'presentation_transcript_file_mismatch' });
  expect(deps.createDocument).not.toHaveBeenCalled();
  expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
});

test('SharePoint reporting a different size fails closed without a row', async () => {
  deps.getFileMetadataById.mockImplementation(async (_drive, itemId) => (itemId === 'pres-item'
    ? { name: PRESENTATION_FILENAME, size: 1, eTag: 'e1', versionId: 'v1' }
    : { eTag: 'tag-source', versionId: '1' }));
  await expect(call()).rejects.toMatchObject({ code: 'presentation_transcript_file_mismatch' });
  expect(deps.createDocument).not.toHaveBeenCalled();
});

test('a source that no longer matches its manifest fails closed before any upload', async () => {
  deps.downloadFile.mockResolvedValue({ buffer: Buffer.from('tampered') });
  await expect(call()).rejects.toMatchObject({ code: 'meeting_transcript_source_integrity_failed', httpStatus: 503 });
  expect(deps.uploadFile).not.toHaveBeenCalled();
  expect(deps.releaseSlotLease).toHaveBeenCalledTimes(1);
});

test('a busy slot is a retryable 409 and writes nothing', async () => {
  deps.acquireSlotLease.mockResolvedValue(null);
  deps.getSlotLease.mockResolvedValue({ lease_token: ACTOR, fence_version: 3, lease_expires_at: new Date(Date.now() + 60_000) });
  await expect(call()).rejects.toMatchObject({ code: 'post_presentation_slot_busy', httpStatus: 409 });
  expect(deps.uploadFile).not.toHaveBeenCalled();
});

test.each([
  ['an unmapped actor', { actingUserSystemId: 'nope' }, 'post_presentation_actor_required'],
  ['a missing profile', { ownerProfileId: null }, 'profile_required'],
])('guards: %s', async (_label, override, code) => {
  await expect(generatePresentationTranscript({ requestId: REQUEST_ID, ownerProfileId: 12, actingUserSystemId: ACTOR,
    body: { expectedCurrentArtifactId: TRANSCRIPT_ID, expectedCurrentFingerprint: generated.inputSha256 }, ...override }, deps))
    .rejects.toMatchObject({ code });
  expect(deps.loadBinding).not.toHaveBeenCalled();
});

test('guards: the bundle schema flag must be on', async () => {
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'off';
  await expect(call()).rejects.toMatchObject({ code: 'meeting_transcript_bundle_schema_not_ready', httpStatus: 503 });
});
