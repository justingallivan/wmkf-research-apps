/** @jest-environment node */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import { createHash } from 'node:crypto';
import {
  createPresentationSummaryDraft, getPresentationSummaryDraft, presentationSummarySlidesChanged, publishPresentationSummaryDraft,
  updatePresentationSummaryDraft,
} from '../../lib/services/post-presentation-materials/transcript-summary-service.js';
import {
  bindTranscriptSummary, presentationTranscriptGenerationKey, transcriptSummaryBindingFingerprint,
} from '../../lib/services/post-presentation-materials/presentation-transcript-binding.js';
import { projectPostPresentationMaterials } from '../../lib/services/post-presentation-materials/material-model.js';
import { buildMeetingTranscriptFiles, buildMeetingTranscriptManifest } from '../../lib/services/meeting-tracker-transcription/bundle.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument.js';
import { PRESENTATION_SUMMARY_ACKNOWLEDGMENT } from '../../shared/config/transcriptSummary.js';
import { PROMPT_NAME } from '../../shared/config/prompts/meeting-presentation-summary.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_REVISION = '33333333-3333-4333-8333-3333333333bb';
const TRANSCRIPT_ID = '44444444-4444-4444-8444-444444444444';
const PRESENTATION_ID = '55555555-5555-4555-8555-555555555555';
const SUMMARY_OLD_ID = '66666666-6666-4666-8666-666666666666';
const SUMMARY_NEW_ID = '66666666-6666-4666-8666-6666666666bb';
const SLIDES_ID = '99999999-9999-4999-8999-999999999999';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const DRAFT_ID = '88888888-8888-4888-8888-888888888888';
const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const boundary = { endMs: 2000, confirmedBy: 8, confirmedAt: '2026-10-04T09:30:00.000Z' };
const PRODUCER = 'meeting-tracker-post-presentation';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PRESENTATION_TEXT = '[0:00] Applicant Lead: Our project studies quantum dots.\n';
const PRESENTATION_BYTES = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(PRESENTATION_TEXT, 'utf8')]);
const SUMMARY_TEXT = 'What was presented\nQuantum dots.\n\nQuestions and answers\nNone.\n\nOpen points\nNone noted.';
const oldEnv = { ...process.env };

let generated; let transcriptRow; let state; let deps; let uploads; let drafts; let claim; let tokens;

const row = (id, type, extra = {}) => ({ wmkf_requestdocumentid: id, _wmkf_request_value: REQUEST_ID, wmkf_artifacttype: type,
  wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY, wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
  wmkf_producer: PRODUCER, wmkf_sharepointdriveid: 'drive', wmkf_sharepointitemid: `item-${id}`,
  wmkf_slotversion: 2, createdon: '2026-10-05T10:00:00Z', ...extra });
const presentationRow = (extra = {}) => row(PRESENTATION_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.PRESENTATION_TRANSCRIPT, {
  wmkf_generationkey: presentationTranscriptGenerationKey({ requestId: REQUEST_ID, sourceRevisionId: REVISION_ID, presentationEndMs: 2000 }),
  wmkf_contenthash: sha(PRESENTATION_BYTES), wmkf_sharepointetag: 'pres-etag', wmkf_sharepointsiteid: 'site', ...extra });
const bindingFingerprint = (revision = REVISION_ID, endMs = 2000) => transcriptSummaryBindingFingerprint({
  requestId: REQUEST_ID, sourceRevisionId: revision, presentationEndMs: endMs });

function draftRow(extra = {}) {
  return { id: DRAFT_ID, request_id: REQUEST_ID, artifact_type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, state: 'ready',
    source_revision_id: REVISION_ID, presentation_end_ms: '2000', source_artifact_id: PRESENTATION_ID,
    summary_text: SUMMARY_TEXT, text_edited: false, version: 2, prompt_name: PROMPT_NAME, prompt_version: 1,
    prompt_id: PROMPT_ID, ai_run_id: RUN_ID, created_at: new Date('2026-10-05T14:32:10Z'),
    updated_at: new Date('2026-10-05T14:32:10Z'), expires_at: new Date('2026-10-19T14:32:10Z'), ...extra };
}

beforeEach(() => {
  process.env.MEETING_TRACKER_TRANSCRIPTION_ACCESS = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY = 'on';
  process.env.MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY = 'on';
  const content = { text: 'x', utterances: [{ speaker: 'B', start: 0, end: 2000, text: 'Our project.' }] };
  const identity = { requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID, revisionId: REVISION_ID, operationId: REVISION_ID,
    sourceRevisionId: null, presentationEnd: boundary };
  generated = buildMeetingTranscriptFiles({ content, speakerNames: { B: 'Applicant Lead' }, identity });
  const files = Object.fromEntries(Object.entries(generated.files).map(([role, file]) => [role, {
    siteId: 'site', driveId: 'drive', itemId: role, versionId: '1', eTag: `tag-${role}`,
    filename: file.filename, contentType: file.contentType, sha256: file.sha256, size: file.bytes.length }]));
  const manifest = buildMeetingTranscriptManifest({ identity, files });
  transcriptRow = row(TRANSCRIPT_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, {
    wmkf_inputfingerprint: generated.inputSha256, wmkf_transcriptbundlejson: JSON.stringify(manifest),
    wmkf_sharepointsiteid: 'site', wmkf_sharepointitemid: 'txt', wmkf_sharepointversionid: '1', wmkf_sharepointetag: 'tag-txt',
    wmkf_filename: files.txt.filename, wmkf_contenttype: files.txt.contentType, wmkf_contenthash: files.txt.sha256,
    wmkf_filesize: files.txt.size, wmkf_slotversion: 3 });
  state = { rows: [transcriptRow, presentationRow()], byKey: [] };
  claim = { id: DRAFT_ID, state: 'ready', token: null, registering: false, text: SUMMARY_TEXT, createdAt: new Date('2026-10-05T14:32:10Z') };
  tokens = 0;
  uploads = new Map();
  drafts = {
    reserveSummaryDraftRun: jest.fn(async (args) => ({ draft: { ...draftRow({ state: 'generating', summary_text: null, version: 1 }), id: args.id } })),
    completeSummaryDraft: jest.fn(async (args) => draftRow({ id: args.id, summary_text: args.text })),
    failSummaryDraft: jest.fn(async () => ({})),
    getActiveSummaryDraft: jest.fn(async () => draftRow()),
    getLatestSummaryRun: jest.fn(async () => null),
    getPublishedSummaryDraft: jest.fn(async () => null),
    updateSummaryDraftText: jest.fn(async (args) => draftRow({ summary_text: args.text, version: 3, text_edited: true })),
    discardSummaryDraft: jest.fn(async () => ({})),
    // A stateful stand-in for the store's claim rules (the SQL itself is exercised against Postgres separately):
    // exclusive token, durable registration flag, release refused after registration, yield keeps 'publishing'.
    claimSummaryDraftForPublish: jest.fn(async (args) => {
      if (args.id !== claim.id || args.expectedVersion !== 2 || claim.state === 'published') return null;
      if (claim.state === 'publishing' && claim.token) return null;
      Object.assign(claim, { state: 'publishing', token: args.token });
      return draftRow({ id: claim.id, created_at: claim.createdAt, summary_text: claim.text, state: 'publishing' });
    }),
    markSummaryDraftRegistering: jest.fn(async ({ id, token }) => {
      if (id !== claim.id || claim.state !== 'publishing' || claim.token !== token) return null;
      claim.registering = true;
      return { id };
    }),
    releaseSummaryDraftClaim: jest.fn(async ({ id, token }) => {
      if (id !== claim.id || claim.state !== 'publishing' || claim.token !== token || claim.registering) return null;
      Object.assign(claim, { state: 'ready', token: null });
      return { id };
    }),
    yieldSummaryDraftClaim: jest.fn(async ({ id, token }) => {
      if (id !== claim.id || claim.state !== 'publishing' || claim.token !== token) return null;
      claim.token = null;
      return { id };
    }),
  };
  drafts.markSummaryDraftPublished = jest.fn(async ({ id, token }) => {
    if (id !== claim.id || claim.state !== 'publishing' || claim.token !== token) return null;
    Object.assign(claim, { state: 'published', token: null });
    return { id, state: 'published' };
  });
  deps = {
    schemaReady: jest.fn(() => true), requestAllowed: jest.fn(() => true),
    loadBinding: jest.fn(async () => ({ requestId: REQUEST_ID, siteVisitActivityId: VISIT_ID })),
    getRequest: jest.fn(async () => ({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1002912', wmkf_meetingdate: '2026-12-04' })),
    findActiveSiteVisit: jest.fn(async () => ({ records: [{ activityid: VISIT_ID, _regardingobjectid_value: REQUEST_ID }] })),
    findDocuments: jest.fn(async () => ({ records: state.rows })),
    findByGenerationKey: jest.fn(async () => ({ records: state.byKey })),
    createDocument: jest.fn(async (payload) => {
      state.rows = [...state.rows, row(SUMMARY_NEW_ID, payload.wmkf_artifacttype, { ...payload, wmkf_requestdocumentid: SUMMARY_NEW_ID,
        _wmkf_request_value: REQUEST_ID, createdon: '2026-10-05T15:00:00Z' })];
      return { wmkf_requestdocumentid: SUMMARY_NEW_ID };
    }),
    updateDocument: jest.fn(async (id, patch) => {
      state.rows = state.rows.map((item) => (item.wmkf_requestdocumentid === id ? { ...item, ...patch } : item));
    }),
    getSharePointBuckets: jest.fn(async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'akoya_request/1002912_x' }]),
    ensureFolderPath: jest.fn(async () => {}),
    uploadFile: jest.fn(async (_library, _folder, filename, bytes) => {
      uploads.set('sum-item', { filename, bytes });
      return { id: 'sum-item', driveId: 'drive', siteId: 'site', name: filename, size: bytes.length };
    }),
    getFileMetadataById: jest.fn(async (_drive, itemId) => (uploads.has(itemId)
      ? { name: uploads.get(itemId).filename, size: uploads.get(itemId).bytes.length, eTag: 'sum-etag', versionId: 'v1',
        siteId: 'site', webUrl: 'https://sp/sum', lastModified: '2026-10-05T15:00:00Z' }
      : { eTag: 'pres-etag', versionId: '1' })),
    downloadFile: jest.fn(async (_drive, itemId) => {
      if (uploads.has(itemId)) return { buffer: uploads.get(itemId).bytes };
      if (itemId === `item-${SLIDES_ID}`) return { buffer: Buffer.from('%PDF-fake') };
      return { buffer: PRESENTATION_BYTES };
    }),
    extractText: jest.fn(async () => 'Slide 1: Quantum dots'),
    acquireSlotLease: jest.fn(async () => ({ fence_version: 5 })),
    getSlotLease: jest.fn(async () => null),
    renewSlotLease: jest.fn(async () => ({ fence_version: 5 })),
    releaseSlotLease: jest.fn(async () => ({})),
    recordEvent: jest.fn(async () => {}),
    loadModelOverrides: jest.fn(async () => {}),
    getExecutorBudget: jest.fn(async () => ({ kind: 'standing', maxTokensOverride: 16000, timeoutMsOverride: 240000 })),
    executePrompt: jest.fn(async () => ({ parsed: { summary: `  ${SUMMARY_TEXT}  ` }, runId: RUN_ID,
      meta: { promptName: PROMPT_NAME, promptVersion: 1, promptId: PROMPT_ID } })),
    drafts,
    randomUUID: jest.fn(() => `cccccccc-cccc-4ccc-8ccc-${String(++tokens).padStart(12, '0')}`),
    now: () => new Date('2026-10-05T15:00:00Z'),
  };
});
afterAll(() => { process.env = oldEnv; });

const create = (overrides = {}) => createPresentationSummaryDraft({ requestId: REQUEST_ID, ownerProfileId: 12, actingUserSystemId: ACTOR,
  body: { expectedCurrentArtifactId: TRANSCRIPT_ID, expectedCurrentFingerprint: generated.inputSha256,
    acknowledgmentVersion: PRESENTATION_SUMMARY_ACKNOWLEDGMENT.version, ...overrides } }, deps);
const publish = (overrides = {}) => publishPresentationSummaryDraft({ requestId: REQUEST_ID, ownerProfileId: 12, actingUserSystemId: ACTOR,
  body: { draftId: DRAFT_ID, expectedVersion: 2, ...overrides } }, deps);

describe('create', () => {
  beforeEach(() => { deps.randomUUID = jest.fn(() => DRAFT_ID); });
  test.each([
    ['missing', undefined],
    ['an older version', 'presentation-summary-2020-01-01'],
  ])('an acknowledgment that is %s is refused before any draft row or provider call', async (_label, version) => {
    await expect(create({ acknowledgmentVersion: version })).rejects.toMatchObject({ httpStatus: 400, code: 'summary_acknowledgment_required' });
    expect(drafts.reserveSummaryDraftRun).not.toHaveBeenCalled();
    expect(deps.executePrompt).not.toHaveBeenCalled();
  });

  test('records the acknowledgment before the provider call, sends the bound transcript text, and returns a ready draft', async () => {
    const outcome = await create();
    expect(drafts.reserveSummaryDraftRun).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQUEST_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, sourceRevisionId: REVISION_ID,
      presentationEndMs: 2000, sourceArtifactId: PRESENTATION_ID,
      acknowledgmentVersion: PRESENTATION_SUMMARY_ACKNOWLEDGMENT.version, profileId: 12 }));
    expect(drafts.reserveSummaryDraftRun.mock.invocationCallOrder[0]).toBeLessThan(deps.executePrompt.mock.invocationCallOrder[0]);
    expect(deps.loadModelOverrides.mock.invocationCallOrder[0]).toBeLessThan(deps.executePrompt.mock.invocationCallOrder[0]);
    const [call] = deps.executePrompt.mock.calls[0];
    expect(call).toMatchObject({ promptName: PROMPT_NAME, requestId: REQUEST_ID, requireNoPersistence: true,
      auditRetention: 'content-free', actingUserSystemId: ACTOR, maxTokensOverride: 16000, timeoutMsOverride: 240000 });
    // The byte-order mark is stripped; no slides are on file.
    expect(call.overrideVariables).toEqual({ presentation_transcript: PRESENTATION_TEXT, presentation_slides: '(No slide text is on file.)' });
    expect(drafts.completeSummaryDraft).toHaveBeenCalledWith(expect.objectContaining({ id: DRAFT_ID, text: SUMMARY_TEXT,
      promptName: PROMPT_NAME, promptVersion: 1, promptId: PROMPT_ID, aiRunId: RUN_ID }));
    expect(outcome).toMatchObject({ draft: { id: DRAFT_ID, state: 'ready', text: SUMMARY_TEXT }, slidesIncluded: false,
      transcriptSummary: { state: 'missing' } });
  });

  test('includes the newest Ready applicant slide PDF text when on file', async () => {
    state.rows = [...state.rows, row(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, {
      wmkf_producer: 'site-visit-materials-portal', wmkf_contenttype: 'application/pdf', wmkf_filename: 'slides.pdf', wmkf_contenthash: sha('slides') })];
    const outcome = await create();
    expect(deps.executePrompt.mock.calls[0][0].overrideVariables.presentation_slides).toBe('Slide 1: Quantum dots');
    expect(outcome.slidesIncluded).toBe(true);
    expect(drafts.reserveSummaryDraftRun).toHaveBeenCalledWith(expect.objectContaining({ slidesArtifactId: SLIDES_ID, slidesContentHash: sha('slides') }));
  });

  test('a run with no slide PDF on file records that none was picked', async () => {
    await create();
    expect(drafts.reserveSummaryDraftRun).toHaveBeenCalledWith(expect.objectContaining({ slidesArtifactId: null, slidesContentHash: null }));
  });

  test('a slide PDF that cannot be read is skipped, not fatal', async () => {
    state.rows = [...state.rows, row(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, {
      wmkf_producer: 'site-visit-materials-portal', wmkf_contenttype: 'application/pdf', wmkf_contenthash: sha('slides') })];
    deps.extractText.mockRejectedValueOnce(new Error('bad pdf'));
    await expect(create()).resolves.toMatchObject({ slidesIncluded: false });
  });

  test.each([
    ['missing', () => [transcriptRow]],
    ['cut at another boundary', () => [transcriptRow, presentationRow({ wmkf_generationkey: presentationTranscriptGenerationKey({
      requestId: REQUEST_ID, sourceRevisionId: REVISION_ID, presentationEndMs: 1000 }) })]],
  ])('a Presentation Transcript that is %s blocks summarizing before any provider call', async (_label, rows) => {
    state.rows = rows();
    await expect(create()).rejects.toMatchObject({ httpStatus: 409, code: 'presentation_transcript_not_ready' });
    expect(drafts.reserveSummaryDraftRun).not.toHaveBeenCalled();
    expect(deps.executePrompt).not.toHaveBeenCalled();
  });

  test('a Presentation Transcript file whose bytes or eTag changed is refused', async () => {
    deps.downloadFile.mockResolvedValueOnce({ buffer: Buffer.from('replaced') });
    await expect(create()).rejects.toMatchObject({ code: 'presentation_transcript_integrity_failed' });
    deps.getFileMetadataById.mockResolvedValueOnce({ eTag: 'other', versionId: '2' });
    await expect(create()).rejects.toMatchObject({ code: 'presentation_transcript_integrity_failed' });
    expect(deps.executePrompt).not.toHaveBeenCalled();
  });

  test('a stale transcript precondition is refused', async () => {
    await expect(create({ expectedCurrentFingerprint: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'meeting_transcript_current_changed' });
  });

  test('a ready draft blocks a new run with a typed conflict naming it, without a provider call', async () => {
    drafts.reserveSummaryDraftRun.mockResolvedValueOnce({ conflict: { code: 'summary_draft_exists', draftId: DRAFT_ID, version: 4 } });
    await expect(create()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_exists',
      body: expect.objectContaining({ draftId: DRAFT_ID, version: 4 }) });
    expect(deps.executePrompt).not.toHaveBeenCalled();
  });

  test('another run in progress is refused without a provider call', async () => {
    drafts.reserveSummaryDraftRun.mockResolvedValueOnce({ conflict: { code: 'summary_generation_in_progress' } });
    await expect(create()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_generation_in_progress' });
    expect(deps.executePrompt).not.toHaveBeenCalled();
  });

  test.each([
    ['claude_output_refused', 422],
    ['claude_output_truncated', 422],
    ['claude_output_incomplete', 502],
  ])('an Executor %s keeps the acknowledgment row as failed and maps to %i', async (code, status) => {
    deps.executePrompt.mockRejectedValueOnce(Object.assign(new Error('x'), { code }));
    await expect(create()).rejects.toMatchObject({ httpStatus: status, code: `summary_${code}` });
    expect(drafts.failSummaryDraft).toHaveBeenCalledWith({ id: DRAFT_ID, failureCode: code });
    expect(drafts.completeSummaryDraft).not.toHaveBeenCalled();
  });

  test('an unknown failure is a 502 and the row is marked failed', async () => {
    deps.executePrompt.mockRejectedValueOnce(new Error('network'));
    await expect(create()).rejects.toMatchObject({ httpStatus: 502, code: 'summary_generation_failed' });
    expect(drafts.failSummaryDraft).toHaveBeenCalled();
  });

  test('empty output is not stored', async () => {
    deps.executePrompt.mockResolvedValueOnce({ parsed: { summary: '   ' }, runId: RUN_ID, meta: {} });
    await expect(create()).rejects.toMatchObject({ code: 'summary_output_invalid' });
    expect(drafts.completeSummaryDraft).not.toHaveBeenCalled();
  });

  test('a run replaced while generating reports the conflict', async () => {
    drafts.completeSummaryDraft.mockResolvedValueOnce(null);
    await expect(create()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_superseded' });
  });
});

// Captured from the pre-Stage-2 service (Session 588) before any SUMMARY_KINDS refactor. Do not update
// these literals to make a refactor pass: a change here changes what the Board sees or breaks retry identity.
const GOLDEN_PRESENTATION_PUBLISH = Object.freeze({
  folder: 'akoya_request/1002912_x/Site Visit - Transcript Summary',
  filename: '1002912-Presentation-Summary-20261005-143210-v2.txt',
  name: '1002912 research presentation summary',
  type: 100000007,
  generationKey: 'a9778db43cc302b9f01a7184f07c934a823003cc47cf6bf08b50656d29c6bd33',
  fingerprint: 'bfd6f8782c8d3186b8c31fc6b16d0e9e53bfdf4b641dd4bee3560b8fea63f25e',
  leaseType: 100000007,
});

describe('publish', () => {
  test('writes the BOM-prefixed TXT, registers a bound row, supersedes the older summary, and clears the draft', async () => {
    state.rows = [...state.rows, row(SUMMARY_OLD_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, {
      wmkf_inputfingerprint: bindingFingerprint(REVISION_ID, 1000), wmkf_generationkey: 'old-key' })];
    const outcome = await publish();

    const [library, folder, filename, bytes, contentType] = deps.uploadFile.mock.calls[0];
    expect([library, folder, contentType]).toEqual(['akoya_request', 'akoya_request/1002912_x/Site Visit - Transcript Summary', 'text/plain; charset=utf-8']);
    // Creation second and draft version: different text (an edit bumps the version) never reuses a path.
    expect(filename).toBe('1002912-Presentation-Summary-20261005-143210-v2.txt');
    expect(bytes.toString('utf8')).toBe(`\uFEFF${SUMMARY_TEXT}\n`);

    const payload = deps.createDocument.mock.calls[0][0];
    expect(payload).toMatchObject({ wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, wmkf_producer: PRODUCER,
      wmkf_inputfingerprint: bindingFingerprint(), wmkf_contenthash: sha(bytes), wmkf_sharepointetag: 'sum-etag',
      wmkf_slotversion: 5, wmkf_promptname: PROMPT_NAME, wmkf_promptversion: 1,
      'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${PROMPT_ID})`, 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${RUN_ID})` });
    expect(payload.wmkf_generationkey).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.wmkf_generationkey).not.toBe(payload.wmkf_inputfingerprint);
    expect(deps.createDocument.mock.calls[0][1]).toMatchObject({ actingUserSystemId: ACTOR });
    // The registry phase is recorded under the claim before the registry write.
    expect(drafts.markSummaryDraftRegistering.mock.invocationCallOrder[0]).toBeLessThan(deps.createDocument.mock.invocationCallOrder[0]);

    expect(deps.updateDocument).toHaveBeenCalledWith(SUMMARY_OLD_ID,
      { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, expect.anything());
    expect(claim.state).toBe('published');
    expect(outcome).toEqual({ transcriptSummary: { state: 'bound', artifactId: SUMMARY_NEW_ID, publishedAt: '2026-10-05T15:00:00Z' }, draft: null });
    const winners = projectPostPresentationMaterials(state.rows, REQUEST_ID).winners;
    expect(bindTranscriptSummary(winners, REQUEST_ID)).toMatchObject({ reason: 'bound', summary: { wmkf_requestdocumentid: SUMMARY_NEW_ID } });
    expect(deps.releaseSlotLease).toHaveBeenCalled();
  });

  test('golden: presentation publish identities are byte-identical to the pre-Stage-2 build (paired summaries plan D1)', async () => {
    await publish();
    const [, folder, filename] = deps.uploadFile.mock.calls[0];
    const payload = deps.createDocument.mock.calls[0][0];
    expect({
      folder, filename, name: payload.wmkf_name, type: payload.wmkf_artifacttype,
      generationKey: payload.wmkf_generationkey, fingerprint: payload.wmkf_inputfingerprint,
      leaseType: deps.acquireSlotLease.mock.calls[0][0].artifactType,
    }).toEqual(GOLDEN_PRESENTATION_PUBLISH);
  });

  test('the claim is scoped to presentation-summary drafts (paired summaries plan, release step 0)', async () => {
    await publish();
    expect(drafts.claimSummaryDraftForPublish).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY }));
  });

  test('a claimed draft of another summary kind is refused before any write and its claim returns to ready', async () => {
    drafts.claimSummaryDraftForPublish.mockImplementationOnce(async (args) => {
      Object.assign(claim, { state: 'publishing', token: args.token });
      return draftRow({ state: 'publishing', artifact_type: 100000010 });
    });
    await expect(publish()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_kind_unsupported' });
    expect(deps.acquireSlotLease).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(claim).toMatchObject({ state: 'ready', token: null });
  });

  test('the claim precedes every external write, and the published text is the claimed text', async () => {
    claim.text = 'Claimed text';
    await publish();
    expect(drafts.claimSummaryDraftForPublish.mock.invocationCallOrder[0]).toBeLessThan(deps.acquireSlotLease.mock.invocationCallOrder[0]);
    expect(deps.uploadFile.mock.calls[0][3].toString('utf8')).toBe('\uFEFFClaimed text\n');
    expect(drafts.getActiveSummaryDraft).not.toHaveBeenCalled();
  });

  test.each([
    ['another revision', { source_revision_id: OTHER_REVISION }],
    ['another boundary', { presentation_end_ms: '1500' }],
  ])('a draft made from %s is refused before any upload and its claim returns to ready', async (_label, extra) => {
    drafts.claimSummaryDraftForPublish.mockImplementationOnce(async (args) => {
      Object.assign(claim, { state: 'publishing', token: args.token });
      return draftRow({ state: 'publishing', ...extra });
    });
    await expect(publish()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_stale' });
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(claim).toMatchObject({ state: 'ready', token: null });
  });

  test('a draft the store will not claim (edited, discarded, replaced, or expired) is refused before the lease', async () => {
    await expect(publish({ expectedVersion: 3 })).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_changed' });
    expect(deps.acquireSlotLease).not.toHaveBeenCalled();
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(drafts.releaseSummaryDraftClaim).not.toHaveBeenCalled();
  });

  test('a second publish while the first holds the claim is refused and cannot release the first claim (Codex re-review)', async () => {
    let second;
    deps.uploadFile.mockImplementationOnce(async (_library, _folder, filename, bytes) => {
      // While publisher A uploads, publisher B tries the same draft, then a discard would need 'ready'.
      second = publish().catch((error) => error);
      expect(await second).toMatchObject({ httpStatus: 409, code: 'summary_draft_changed' });
      uploads.set('sum-item', { filename, bytes });
      return { id: 'sum-item', driveId: 'drive', siteId: 'site', name: filename, size: bytes.length };
    });
    await expect(publish()).resolves.toMatchObject({ transcriptSummary: { state: 'bound' } });
    expect(claim.state).toBe('published');
    expect(drafts.releaseSummaryDraftClaim).not.toHaveBeenCalled();
    expect(drafts.yieldSummaryDraftClaim).not.toHaveBeenCalled();
  });

  test('an upload failure returns the claim to ready so the PC can edit again', async () => {
    deps.uploadFile.mockRejectedValueOnce(Object.assign(new Error('sp'), { code: 'graph_down' }));
    await expect(publish()).rejects.toMatchObject({ code: 'graph_down' });
    expect(claim).toMatchObject({ state: 'ready', token: null, registering: false });
  });

  test('a registry failure keeps the draft publishing (the row may exist), yielded for an immediate retry', async () => {
    deps.createDocument.mockRejectedValueOnce(Object.assign(new Error('dv'), { code: 'dataverse_timeout' }));
    await expect(publish()).rejects.toMatchObject({ code: 'dataverse_timeout' });
    expect(claim).toMatchObject({ state: 'publishing', token: null, registering: true });
  });

  test('registered, mark failed, then a retry fails early: the draft never becomes editable, and a later retry finishes (Codex re-review)', async () => {
    drafts.markSummaryDraftPublished.mockRejectedValueOnce(new Error('pg down'));
    await expect(publish()).rejects.toThrow('pg down');
    expect(claim).toMatchObject({ state: 'publishing', token: null, registering: true });
    const created = state.rows.find((item) => item.wmkf_requestdocumentid === SUMMARY_NEW_ID);
    state.byKey = [created];

    // Retry 1 fails before any registry step in this request; the durable flag still blocks release.
    deps.getRequest.mockRejectedValueOnce(new Error('dataverse read failed'));
    await expect(publish()).rejects.toThrow('dataverse read failed');
    expect(claim).toMatchObject({ state: 'publishing', token: null });
    expect(drafts.releaseSummaryDraftClaim).toHaveBeenCalled();
    expect(claim.state).not.toBe('ready');

    // Retry 2 finishes with the same row and file.
    deps.uploadFile.mockClear(); deps.createDocument.mockClear();
    await expect(publish()).resolves.toMatchObject({ transcriptSummary: { state: 'bound', artifactId: SUMMARY_NEW_ID } });
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(claim.state).toBe('published');
  });

  test('a claim lost before the registry write stops the publish before createDocument', async () => {
    drafts.markSummaryDraftRegistering.mockResolvedValueOnce(null);
    await expect(publish()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_changed' });
    expect(deps.createDocument).not.toHaveBeenCalled();
  });

  test('a lost claim at the final mark is recorded, and the publish still reports the bound summary', async () => {
    drafts.markSummaryDraftPublished.mockResolvedValueOnce(null);
    await expect(publish()).resolves.toMatchObject({ transcriptSummary: { state: 'bound' }, draft: null });
    expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'transcript-summary-draft-mark',
      metadata: expect.objectContaining({ reason: 'draft_claim_lost' }) }));
  });

  test('a prior row bound elsewhere under the same key is a conflict', async () => {
    state.byKey = [row(SUMMARY_NEW_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, { wmkf_inputfingerprint: bindingFingerprint(OTHER_REVISION) })];
    await expect(publish()).rejects.toMatchObject({ code: 'transcript_summary_registry_conflict' });
  });

  test('a registration failure records the orphaned file for reconciliation', async () => {
    deps.createDocument.mockRejectedValueOnce(Object.assign(new Error('dv'), { code: 'dataverse_down' }));
    await expect(publish()).rejects.toMatchObject({ code: 'dataverse_down' });
    expect(deps.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ stage: 'transcript-summary-register',
      summary: 'A transcript summary write needs registry reconciliation.' }));
  });

  test('two drafts created in the same minute publish to different files', async () => {
    await publish();
    const first = deps.uploadFile.mock.calls[0][2];
    uploads.clear();
    Object.assign(claim, { id: '88888888-8888-4888-8888-8888888888cc', state: 'ready', token: null, registering: false,
      createdAt: new Date('2026-10-05T14:32:50Z'), text: 'Second draft' });
    drafts.claimSummaryDraftForPublish.mockImplementationOnce(async (args) => {
      Object.assign(claim, { state: 'publishing', token: args.token });
      return draftRow({ id: claim.id, created_at: claim.createdAt, summary_text: claim.text, state: 'publishing' });
    });
    await publish({ draftId: '88888888-8888-4888-8888-8888888888cc' });
    expect(deps.uploadFile.mock.calls[1][2]).not.toBe(first);
  });
});

describe('read and edit', () => {
  test('reports the active draft, whether it matches the current transcript, and the acknowledgment copy', async () => {
    const outcome = await getPresentationSummaryDraft({ requestId: REQUEST_ID, ownerProfileId: 12 }, deps);
    expect(outcome).toMatchObject({ draft: { id: DRAFT_ID, version: 2, text: SUMMARY_TEXT, presentationEndMs: 2000 },
      draftMatchesTranscript: true, lastFailure: null, acknowledgment: PRESENTATION_SUMMARY_ACKNOWLEDGMENT });
    drafts.getActiveSummaryDraft.mockResolvedValueOnce(draftRow({ presentation_end_ms: '1500' }));
    expect((await getPresentationSummaryDraft({ requestId: REQUEST_ID, ownerProfileId: 12 }, deps)).draftMatchesTranscript).toBe(false);
  });

  test.each([['empty', '   '], ['too long', 'x'.repeat(100001)]])('an %s edit is refused', async (_label, text) => {
    await expect(updatePresentationSummaryDraft({ requestId: REQUEST_ID, ownerProfileId: 12,
      body: { draftId: DRAFT_ID, expectedVersion: 2, text } }, deps)).rejects.toMatchObject({ httpStatus: 400, code: 'summary_text_invalid' });
  });

  test('an edit against a changed version is a conflict', async () => {
    drafts.updateSummaryDraftText.mockResolvedValueOnce(null);
    await expect(updatePresentationSummaryDraft({ requestId: REQUEST_ID, ownerProfileId: 12,
      body: { draftId: DRAFT_ID, expectedVersion: 1, text: 'New text' } }, deps)).rejects.toMatchObject({ code: 'summary_draft_changed' });
  });
});

describe('slides changed since the published summary (staff replacement plan §3.5)', () => {
  const PUBLISHED_ID = 'abababab-abab-4bab-8bab-abababababab';
  const slidesRow = (id, hash) => row(id, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, {
    wmkf_producer: 'site-visit-materials-portal', wmkf_contenttype: 'application/pdf', wmkf_contenthash: hash });
  const run = (extra) => ({ state: 'published', published_artifact_id: PUBLISHED_ID, slides_recorded: true, slides_artifact_id: null, slides_content_hash: null, ...extra });
  const changed = (rows) => presentationSummarySlidesChanged({ requestId: REQUEST_ID, rows, publishedArtifactId: PUBLISHED_ID }, deps);

  test('the same slides are unchanged; a replacement, an addition, or a removal is a change', async () => {
    drafts.getPublishedSummaryDraft.mockResolvedValue(run({ slides_artifact_id: SLIDES_ID, slides_content_hash: sha('v1') }));
    expect(await changed([slidesRow(SLIDES_ID, sha('v1'))])).toBe(false);
    expect(await changed([slidesRow('12121212-1212-4212-8212-121212121212', sha('v2'))])).toBe(true);
    expect(await changed([])).toBe(true);
    drafts.getPublishedSummaryDraft.mockResolvedValue(run());
    expect(await changed([])).toBe(false);
    expect(await changed([slidesRow(SLIDES_ID, sha('v1'))])).toBe(true);
    expect(drafts.getPublishedSummaryDraft).toHaveBeenCalledWith({ requestId: REQUEST_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, publishedArtifactId: PUBLISHED_ID });
  });

  test('unknown without a published summary, its run, or a run recorded before migration 071', async () => {
    expect(await presentationSummarySlidesChanged({ requestId: REQUEST_ID, rows: [], publishedArtifactId: null }, deps)).toBeNull();
    expect(drafts.getPublishedSummaryDraft).not.toHaveBeenCalled();
    drafts.getPublishedSummaryDraft.mockResolvedValueOnce(null);
    expect(await changed([slidesRow(SLIDES_ID, sha('v1'))])).toBeNull();
    drafts.getPublishedSummaryDraft.mockResolvedValueOnce(run({ slides_recorded: false }));
    expect(await changed([slidesRow(SLIDES_ID, sha('v1'))])).toBeNull();
  });
});
