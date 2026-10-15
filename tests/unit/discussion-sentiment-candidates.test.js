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
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({ findByRequests: jest.fn() }));
jest.mock('../../lib/services/workbench/dashboard-service.js', () => ({ loadMeetingTrackerSelection: jest.fn() }));

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
const transcript = (requestId, over = {}, cycle = 'D26') => {
  const m = manifest(requestId, over); const txt = m.files.txt;
  return { wmkf_requestdocumentid: `t-${requestId}`, _wmkf_request_value: requestId, wmkf_artifacttype: TRANSCRIPT, wmkf_producer: PRODUCER,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_transcriptbundlejson: JSON.stringify(m),
    wmkf_sharepointsiteid: txt.siteId, wmkf_sharepointdriveid: txt.driveId, wmkf_sharepointitemid: txt.itemId, wmkf_sharepointversionid: txt.versionId,
    wmkf_sharepointetag: txt.eTag, wmkf_filename: txt.filename, wmkf_contenthash: txt.sha256, wmkf_contenttype: txt.contentType, wmkf_filesize: txt.size,
    wmkf_cyclecode: cycle, createdon: '2026-10-05T00:00:00Z' };
};
const discussion = (requestId, { revision = REVISION, endMs = 70_000, id, cycle = 'D26' } = {}) => ({
  wmkf_requestdocumentid: id || `d-${requestId}`, _wmkf_request_value: requestId, wmkf_artifacttype: STAFF_DISCUSSION_TRANSCRIPT, wmkf_producer: PRODUCER,
  wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: `d-item-${requestId}`,
  wmkf_generationkey: staffDiscussionTranscriptGenerationKey({ requestId, sourceRevisionId: revision, presentationEndMs: endMs }),
  wmkf_contenthash: SHA, wmkf_cyclecode: cycle, createdon: '2026-10-06T00:00:00Z' });

let pages; let deps; let cycleMembers;
const CALLER = { azureEmail: 'staff@example.org', profileId: 12, callerSystemId: '77777777-7777-4777-8777-777777777777', programId: undefined };
beforeEach(() => {
  pages = { [TRANSCRIPT]: { records: [], capped: false, hasMore: false }, [STAFF_DISCUSSION_TRANSCRIPT]: { records: [], capped: false, hasMore: false } };
  cycleMembers = {};
  deps = {
    fetchCurrentPrompt: jest.fn(async () => ({ wmkf_promptversion: 3 })),
    sentiments: { getCandidateRunSummaries: jest.fn(async ({ sources }) => sources.map(({ requestId }) => ({ request_id: requestId }))) },
    loadCycleRequests: jest.fn(async ({ cycleCode }) => ({ proposals: (cycleMembers[cycleCode] || []).map((requestId) => ({ requestId })) })),
    // Any cycle stamp; and deliberately returns every fixture row, so a row for an unlisted request must be ignored by the service.
    findDocumentsByRequests: jest.fn(async (_ids, type) => pages[type]),
  };
});
const list = (over = {}) => listDiscussionSentimentCandidates({ cycleCode: 'D26', ownerProfileId: 12, caller: CALLER, ...over },
  { ...deps, schemaReady: () => true, requestAllowed: () => true, ...over.deps });

// The shared preconditions read these policy flags; open them for the duration of this file.
const ENV = { MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY: 'on', MEETING_TRACKER_TRANSCRIPTION_ACCESS: 'on', MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY: 'on' };
let saved;
beforeAll(() => { saved = {}; for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k]; } });
afterAll(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test('only requests whose discussion TXT is bound are candidates; the cycle is queried once per type with the bundle', async () => {
  const [bound, stale, missing, noBoundary, orphan] = [rid(1), rid(2), rid(3), rid(4), rid(5)];
  cycleMembers.D26 = [bound, stale, missing, noBoundary, rid(6)];
  pages[TRANSCRIPT].records = [transcript(bound), transcript(stale), transcript(missing), transcript(noBoundary, { presentationEnd: null })];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(bound), discussion(stale, { endMs: 65_000 }), discussion(noBoundary), discussion(orphan)];
  const result = await list();
  expect(result).toMatchObject({ requestIds: [bound], capped: false, statuses: { [bound]: { state: 'not_analyzed', hasCompletedAnalysis: false } } });
  expect(deps.findDocumentsByRequests).toHaveBeenCalledTimes(2);
  expect(deps.findDocumentsByRequests).toHaveBeenCalledWith(cycleMembers.D26, TRANSCRIPT);
  expect(deps.findDocumentsByRequests).toHaveBeenCalledWith(cycleMembers.D26, STAFF_DISCUSSION_TRANSCRIPT);
});

test('a request whose transcript was republished (latest discussion TXT is stale) is excluded', async () => {
  const id = rid(7);
  cycleMembers.D26 = [id];
  pages[TRANSCRIPT].records = [transcript(id, { revisionId: NEW_REVISION, operationId: NEW_REVISION, sourceRevisionId: REVISION })];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(id, { revision: REVISION })];
  expect((await list()).requestIds).toEqual([]);
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(id, { revision: NEW_REVISION })];
  expect((await list()).requestIds).toEqual([id]);
});

test('an older stale discussion row does not hide a newer bound one, and a superseded newer row does not count', async () => {
  const id = rid(8);
  cycleMembers.D26 = [id];
  pages[TRANSCRIPT].records = [transcript(id)];
  const stale = { ...discussion(id, { endMs: 65_000, id: 'old' }), createdon: '2026-10-01T00:00:00Z' };
  const fresh = { ...discussion(id, { id: 'new' }), createdon: '2026-10-09T00:00:00Z' };
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [stale, fresh];
  expect((await list()).requestIds).toEqual([id]);
  // Superseded newest row falls out of the projection, leaving only the stale one.
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [{ ...fresh, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, stale];
  expect((await list()).requestIds).toEqual([]);
});

test('the capped flag is passed through when either document query was capped or has more', async () => {
  cycleMembers.D26 = [rid(1)];
  expect((await list()).capped).toBe(false);
  pages[STAFF_DISCUSSION_TRANSCRIPT].capped = true;
  expect((await list()).capped).toBe(true);
  pages[STAFF_DISCUSSION_TRANSCRIPT].capped = false; pages[TRANSCRIPT].capped = true;
  expect((await list()).capped).toBe(true);
  pages[TRANSCRIPT].capped = false; pages[TRANSCRIPT].hasMore = true;
  expect((await list()).capped).toBe(true);
});

test.each([undefined, '', 'D2', 'X26', 'D26; drop', "D26' or 1 eq 1", ['D26'], 26])('an invalid cycleCode %p is 400 and no query runs', async (cycleCode) => {
  await expect(list({ cycleCode })).rejects.toMatchObject({ httpStatus: 400, code: 'sentiment_cycle_invalid' });
  expect(deps.loadCycleRequests).not.toHaveBeenCalled();
  expect(deps.findDocumentsByRequests).not.toHaveBeenCalled();
});

test('a lowercase cycle code is normalized to upper case for the request listing', async () => {
  await list({ cycleCode: ' d26 ' });
  expect(deps.loadCycleRequests).toHaveBeenCalledWith(expect.objectContaining({ cycleCode: 'D26' }));
});

test('a request whose TRANSCRIPT and discussion rows carry different cycle stamps is included under its current cycle', async () => {
  const id = rid(20);
  cycleMembers.J27 = [id]; // the request is in J27 now
  pages[TRANSCRIPT].records = [transcript(id, {}, 'D26')]; // published while it was still D26
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(id, { cycle: 'J27' })]; // published after it moved
  expect((await list({ cycleCode: 'J27' })).requestIds).toEqual([id]);
  expect((await list({ cycleCode: 'D26' })).requestIds).toEqual([]); // not a D26 request any more
});

test('a request that moved after both artifacts were published is listed under its current cycle only', async () => {
  const id = rid(21);
  cycleMembers.J27 = [id];
  pages[TRANSCRIPT].records = [transcript(id, {}, 'D26')];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(id, { cycle: 'D26' })];
  expect((await list({ cycleCode: 'J27' })).requestIds).toEqual([id]);
  expect((await list({ cycleCode: 'D26' })).requestIds).toEqual([]);
});

test('a cycle request with a transcript but no discussion row is excluded', async () => {
  const id = rid(22);
  cycleMembers.D26 = [id];
  pages[TRANSCRIPT].records = [transcript(id)];
  expect((await list()).requestIds).toEqual([]);
});

test('request ids come only from the server-side listing, which receives the session-derived caller; documents of other requests are never asked for', async () => {
  const listed = rid(30); const unlisted = rid(31);
  cycleMembers.D26 = [listed];
  pages[TRANSCRIPT].records = [transcript(listed), transcript(unlisted)];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(listed), discussion(unlisted)];
  const result = await list({ caller: { ...CALLER, programId: 'p-1' } });
  expect(result.requestIds).toEqual([listed]);
  expect(deps.loadCycleRequests).toHaveBeenCalledWith({ azureEmail: CALLER.azureEmail, profileId: 12,
    callerSystemId: CALLER.callerSystemId, programId: 'p-1', cycleCode: 'D26', scope: 'all', includeSetAside: false });
  for (const [ids] of deps.findDocumentsByRequests.mock.calls) expect(ids).toEqual([listed]);
});

test('an empty cycle makes no document query', async () => {
  expect(await list()).toEqual({ requestIds: [], statuses: {}, capped: false });
  expect(deps.findDocumentsByRequests).not.toHaveBeenCalled();
});

test('a request the feature is not available for is excluded; a global refusal is an error', async () => {
  const [a, b] = [rid(1), rid(2)];
  cycleMembers.D26 = [a, b];
  pages[TRANSCRIPT].records = [transcript(a), transcript(b)];
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = [discussion(a), discussion(b)];
  const result = await listDiscussionSentimentCandidates({ cycleCode: 'D26', ownerProfileId: 12, caller: CALLER },
    { ...deps, schemaReady: () => true, requestAllowed: (id) => id === b });
  expect(result.requestIds).toEqual([b]);
  await expect(listDiscussionSentimentCandidates({ cycleCode: 'D26', ownerProfileId: 12, caller: CALLER },
    { ...deps, schemaReady: () => false, requestAllowed: () => true })).rejects.toMatchObject({ code: 'post_presentation_schema_not_ready' });
});

const seedCandidates = (...ids) => {
  cycleMembers.D26 = ids;
  pages[TRANSCRIPT].records = ids.map((id) => transcript(id));
  pages[STAFF_DISCUSSION_TRANSCRIPT].records = ids.map((id) => discussion(id));
};

test('batch statuses use the already bound sources and one prompt read; no result content is returned', async () => {
  const [a, b] = [rid(40), rid(41)];
  seedCandidates(a, b);
  deps.sentiments.getCandidateRunSummaries.mockResolvedValue([
    { request_id: a, latest_ready: { completed_at: '2026-10-14T10:00:00Z' }, current_ready: { completed_at: '2026-10-14T10:00:00Z' },
      latest: { status: 'generating', live_generating: true },
      accepted_row: { source_artifact_id: `d-${a}`, source_content_hash: SHA, prompt_version: 3, record: { secret: 'not exposed' } } },
    { request_id: b, latest_ready: { completed_at: '2026-10-13T10:00:00Z' },
      latest: { status: 'generating', live_generating: false, created_at: '2026-10-14T10:00:00Z' } },
  ]);
  const result = await list();
  expect(result.statuses[a]).toEqual({ state: 'analyzing', hasCompletedAnalysis: true, accepted: { current: true }, lastRunFailed: false });
  expect(result.statuses[b]).toEqual({ state: 'out_of_date', hasCompletedAnalysis: true, accepted: null, lastRunFailed: true });
  expect(deps.fetchCurrentPrompt).toHaveBeenCalledTimes(1);
  expect(deps.sentiments.getCandidateRunSummaries).toHaveBeenCalledTimes(1);
  expect(deps.sentiments.getCandidateRunSummaries).toHaveBeenCalledWith({ sources: [a, b].map((id) => ({
    requestId: id, sourceArtifactId: `d-${id}`, sourceContentHash: SHA, promptVersion: 3,
  })) });
  expect(JSON.stringify(result)).not.toContain('not exposed');
});

test.each(['database', 'prompt', 'missing-row'])('unavailable %s metadata never reports not analyzed', async (failure) => {
  const a = rid(40); seedCandidates(a);
  if (failure === 'database') deps.sentiments.getCandidateRunSummaries.mockRejectedValue(new Error('private database error'));
  if (failure === 'prompt') deps.fetchCurrentPrompt.mockRejectedValue(new Error('private prompt error'));
  if (failure === 'missing-row') deps.sentiments.getCandidateRunSummaries.mockResolvedValue([]);
  expect((await list()).statuses).toEqual({ [a]: { state: 'unavailable' } });
});

test('a failed first attempt has no completed analysis; acceptance can be stale independently', async () => {
  const a = rid(40); seedCandidates(a);
  deps.sentiments.getCandidateRunSummaries.mockResolvedValue([{ request_id: a,
    latest: { status: 'failed', created_at: '2026-10-14T10:00:00Z' } }]);
  expect((await list()).statuses[a]).toEqual({ state: 'not_analyzed', hasCompletedAnalysis: false, accepted: null, lastRunFailed: true });
});
