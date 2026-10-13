/**
 * Picker candidates: grouping cycle-wide rows by request and running the analysis's own bindCurrent over
 * each group. Real projection and binding; only the cycle query and the preconditions are injected.
 * @jest-environment node
 */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByCycle: jest.fn() }));

import { listDiscussionSentimentCandidates } from '../../lib/services/post-presentation-materials/discussion-sentiment-candidates.js';
import { staffDiscussionTranscriptGenerationKey } from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_OPERATION_STATUS, REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../shared/config/requestDocument.js';

const { TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT } = REQUEST_DOCUMENT_ARTIFACT_TYPE;
const REVISION = '33333333-3333-4333-8333-333333333333';
const NEW_REVISION = '44444444-4444-4444-8444-444444444444';
const SHA = 'a'.repeat(64);
const PRODUCER = 'meeting-tracker-post-presentation';
const rid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VISIT = '22222222-2222-4222-8222-222222222222';

const file = (role) => ({ siteId: 'site', driveId: 'drive', itemId: `item-${role}`, versionId: 'v1', eTag: 'e1', sha256: SHA, size: 10,
  filename: `t.${role}`, contentType: { txt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8', source: 'application/json' }[role] });
const manifest = (requestId, over = {}) => ({ schemaVersion: 4, requestId, siteVisitActivityId: VISIT, revisionId: REVISION, operationId: REVISION,
  sourceRevisionId: null, formatterVersion: '4', files: { txt: file('txt'), vtt: file('vtt'), source: file('source') },
  presentationEnd: { endMs: 70_000, confirmedBy: 5, confirmedAt: '2026-10-05T18:00:00.000Z' }, ...over });
const transcript = (requestId, over = {}) => {
  const m = manifest(requestId, over); const txt = m.files.txt;
  return { wmkf_requestdocumentid: `t-${requestId}`, _wmkf_request_value: requestId, wmkf_artifacttype: TRANSCRIPT, wmkf_producer: PRODUCER,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_transcriptbundlejson: JSON.stringify(m),
    wmkf_sharepointsiteid: txt.siteId, wmkf_sharepointdriveid: txt.driveId, wmkf_sharepointitemid: txt.itemId, wmkf_sharepointversionid: txt.versionId,
    wmkf_sharepointetag: txt.eTag, wmkf_filename: txt.filename, wmkf_contenthash: txt.sha256, wmkf_contenttype: txt.contentType, wmkf_filesize: txt.size,
    createdon: '2026-10-05T00:00:00Z' };
};
const discussion = (requestId, { revision = REVISION, endMs = 70_000, id } = {}) => ({
  wmkf_requestdocumentid: id || `d-${requestId}`, _wmkf_request_value: requestId, wmkf_artifacttype: STAFF_DISCUSSION_TRANSCRIPT, wmkf_producer: PRODUCER,
  wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: `d-item-${requestId}`,
  wmkf_generationkey: staffDiscussionTranscriptGenerationKey({ requestId, sourceRevisionId: revision, presentationEndMs: endMs }),
  createdon: '2026-10-06T00:00:00Z' });

let pages; let deps;
beforeEach(() => {
  pages = { [TRANSCRIPT]: { records: [], capped: false }, [STAFF_DISCUSSION_TRANSCRIPT]: { records: [], capped: false } };
  deps = { findDocumentsByCycle: jest.fn(async (_c, type) => pages[type]) };
});
const list = (over = {}) => listDiscussionSentimentCandidates({ cycleCode: 'D26', ownerProfileId: 12, ...over },
  { ...deps, schemaReady: () => true, requestAllowed: () => true, ...over.deps });

// The shared preconditions read these policy flags; open them for the duration of this file.
const ENV = { MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY: 'on', MEETING_TRACKER_TRANSCRIPTION_ACCESS: 'on', MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY: 'on' };
let saved;
beforeAll(() => { saved = {}; for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; } });
afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test('only requests whose discussion TXT is bound are candidates; the cycle is queried once per type with the bundle', async () => {
  const [bound, stale, missing, noBoundary, orphan] = [rid(1), rid(2), rid(3), rid(4), rid(5)];
  pages[TRANSCRIPT].records = [transcript(bound), transcript(stale), transcript(missing), transcript(noBoundary, { presentationEnd: null })];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(bound), discussion(stale, { endMs: 65_000 }), discussion(noBoundary), discussion(orphan)];
  const result = await list();
  expect(result).toEqual({ requestIds: [bound], capped: false });
  expect(deps.findDocumentsByCycle).toHaveBeenCalledTimes(2);
  expect(deps.findDocumentsByCycle).toHaveBeenCalledWith('D26', TRANSCRIPT);
  expect(deps.findDocumentsByCycle).toHaveBeenCalledWith('D26', STAFF_DISCUSSION_TRANSCRIPT);
});

test('a request whose transcript was republished (latest discussion TXT is stale) is excluded', async () => {
  const id = rid(7);
  pages[TRANSCRIPT].records = [transcript(id, { revisionId: NEW_REVISION, operationId: NEW_REVISION, sourceRevisionId: REVISION })];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(id, { revision: REVISION })];
  expect((await list()).requestIds).toEqual([]);
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(id, { revision: NEW_REVISION })];
  expect((await list()).requestIds).toEqual([id]);
});

test('an older stale discussion row does not hide a newer bound one, and a superseded newer row does not count', async () => {
  const id = rid(8);
  pages[TRANSCRIPT].records = [transcript(id)];
  const stale = { ...discussion(id, { endMs: 65_000, id: 'old' }), createdon: '2026-10-01T00:00:00Z' };
  const fresh = { ...discussion(id, { id: 'new' }), createdon: '2026-10-09T00:00:00Z' };
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [stale, fresh];
  expect((await list()).requestIds).toEqual([id]);
  // Superseded newest row falls out of the projection, leaving only the stale one.
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [{ ...fresh, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, stale];
  expect((await list()).requestIds).toEqual([]);
});

test('the capped flag is passed through when either query was capped', async () => {
  expect((await list()).capped).toBe(false);
  pages[STAFF_DISCUSSION_TRANSCRIPT].capped = true;
  expect((await list()).capped).toBe(true);
  pages[STAFF_DISCUSSION_TRANSCRIPT].capped = false; pages[TRANSCRIPT].capped = true;
  expect((await list()).capped).toBe(true);
});

test.each([undefined, '', 'D2', 'X26', 'D26; drop', "D26' or 1 eq 1", ['D26'], 26])('an invalid cycleCode %p is 400 and no query runs', async (cycleCode) => {
  await expect(list({ cycleCode })).rejects.toMatchObject({ httpStatus: 400, code: 'sentiment_cycle_invalid' });
  expect(deps.findDocumentsByCycle).not.toHaveBeenCalled();
});

test('a lowercase cycle code is normalized to upper case', async () => {
  await list({ cycleCode: ' d26 ' });
  expect(deps.findDocumentsByCycle).toHaveBeenCalledWith('D26', TRANSCRIPT);
});

test('a request the feature is not available for is excluded; a global refusal is an error', async () => {
  const [a, b] = [rid(1), rid(2)];
  pages[TRANSCRIPT].records = [transcript(a), transcript(b)];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(a), discussion(b)];
  const result = await listDiscussionSentimentCandidates({ cycleCode: 'D26', ownerProfileId: 12 },
    { ...deps, schemaReady: () => true, requestAllowed: (id) => id === b });
  expect(result.requestIds).toEqual([b]);
  await expect(listDiscussionSentimentCandidates({ cycleCode: 'D26', ownerProfileId: 12 },
    { ...deps, schemaReady: () => false, requestAllowed: () => true })).rejects.toMatchObject({ code: 'post_presentation_schema_not_ready' });
});
