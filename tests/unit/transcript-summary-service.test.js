/** @jest-environment node */
jest.mock('../../lib/services/portal-upload-staging.js', () => ({
  PORTAL_UPLOAD_SCOPES: { POST_PRESENTATION_TRANSCRIPT: 'post_presentation_transcript' },
  createPortalUpload: jest.fn(), recordPortalUploadCandidate: jest.fn(), renewPortalUploadLease: jest.fn(),
  staffActorBinding: jest.fn((id) => `profile:${id}`),
}));

import { createHash } from 'node:crypto';
import {
  createPresentationSummaryDraft, getPresentationSummaryDraft, publishPresentationSummaryDraft, updatePresentationSummaryDraft,
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

let generated; let transcriptRow; let state; let deps; let uploads; let drafts;

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
  uploads = new Map();
  drafts = {
    beginSummaryDraft: jest.fn(async (args) => ({ ...draftRow({ state: 'generating', summary_text: null, version: 1 }), id: args.id })),
    completeSummaryDraft: jest.fn(async (args) => draftRow({ id: args.id, summary_text: args.text })),
    failSummaryDraft: jest.fn(async () => ({})),
    getActiveSummaryDraft: jest.fn(async () => draftRow()),
    getLatestSummaryRun: jest.fn(async () => null),
    updateSummaryDraftText: jest.fn(async (args) => draftRow({ summary_text: args.text, version: 3, text_edited: true })),
    discardSummaryDraft: jest.fn(async () => ({})),
    markSummaryDraftPublished: jest.fn(async () => ({ id: DRAFT_ID, state: 'published' })),
  };
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
    randomUUID: jest.fn(() => DRAFT_ID),
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
  test.each([
    ['missing', undefined],
    ['an older version', 'presentation-summary-2020-01-01'],
  ])('an acknowledgment that is %s is refused before any draft row or provider call', async (_label, version) => {
    await expect(create({ acknowledgmentVersion: version })).rejects.toMatchObject({ httpStatus: 400, code: 'summary_acknowledgment_required' });
    expect(drafts.beginSummaryDraft).not.toHaveBeenCalled();
    expect(deps.executePrompt).not.toHaveBeenCalled();
  });

  test('records the acknowledgment before the provider call, sends the bound transcript text, and returns a ready draft', async () => {
    const outcome = await create();
    expect(drafts.beginSummaryDraft).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQUEST_ID, artifactType: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, sourceRevisionId: REVISION_ID,
      presentationEndMs: 2000, sourceArtifactId: PRESENTATION_ID,
      acknowledgmentVersion: PRESENTATION_SUMMARY_ACKNOWLEDGMENT.version, profileId: 12 }));
    expect(drafts.beginSummaryDraft.mock.invocationCallOrder[0]).toBeLessThan(deps.executePrompt.mock.invocationCallOrder[0]);
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
      wmkf_producer: 'site-visit-materials-portal', wmkf_contenttype: 'application/pdf', wmkf_filename: 'slides.pdf' })];
    const outcome = await create();
    expect(deps.executePrompt.mock.calls[0][0].overrideVariables.presentation_slides).toBe('Slide 1: Quantum dots');
    expect(outcome.slidesIncluded).toBe(true);
  });

  test('a slide PDF that cannot be read is skipped, not fatal', async () => {
    state.rows = [...state.rows, row(SLIDES_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.APPLICANT_SLIDES, {
      wmkf_producer: 'site-visit-materials-portal', wmkf_contenttype: 'application/pdf' })];
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
    expect(drafts.beginSummaryDraft).not.toHaveBeenCalled();
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

  test('another run in progress is refused without a provider call', async () => {
    drafts.beginSummaryDraft.mockResolvedValueOnce(null);
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

describe('publish', () => {
  test('writes the BOM-prefixed TXT, registers a bound row, supersedes the older summary, and clears the draft', async () => {
    state.rows = [...state.rows, row(SUMMARY_OLD_ID, REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, {
      wmkf_inputfingerprint: bindingFingerprint(REVISION_ID, 1000), wmkf_generationkey: 'old-key' })];
    const outcome = await publish();

    const [library, folder, filename, bytes, contentType] = deps.uploadFile.mock.calls[0];
    expect([library, folder, contentType]).toEqual(['akoya_request', 'akoya_request/1002912_x/Site Visit - Transcript Summary', 'text/plain; charset=utf-8']);
    expect(filename).toBe('1002912-Presentation-Summary-20261005-1432.txt');
    expect(bytes.toString('utf8')).toBe(`﻿${SUMMARY_TEXT}\n`);

    const payload = deps.createDocument.mock.calls[0][0];
    expect(payload).toMatchObject({ wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, wmkf_producer: PRODUCER,
      wmkf_inputfingerprint: bindingFingerprint(), wmkf_contenthash: sha(bytes), wmkf_sharepointetag: 'sum-etag',
      wmkf_slotversion: 5, wmkf_promptname: PROMPT_NAME, wmkf_promptversion: 1,
      'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${PROMPT_ID})`, 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${RUN_ID})` });
    // The generation key is unique per publish, so it is not the binding fingerprint.
    expect(payload.wmkf_generationkey).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.wmkf_generationkey).not.toBe(payload.wmkf_inputfingerprint);
    expect(deps.createDocument.mock.calls[0][1]).toMatchObject({ actingUserSystemId: ACTOR });

    expect(deps.updateDocument).toHaveBeenCalledWith(SUMMARY_OLD_ID,
      { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED }, expect.anything());
    expect(drafts.markSummaryDraftPublished).toHaveBeenCalledWith(expect.objectContaining({ id: DRAFT_ID, expectedVersion: 2,
      publishedArtifactId: SUMMARY_NEW_ID }));
    expect(outcome).toEqual({ transcriptSummary: { state: 'bound', artifactId: SUMMARY_NEW_ID, publishedAt: '2026-10-05T15:00:00Z' }, draft: null });
    // The outside binding accepts the published row.
    const winners = projectPostPresentationMaterials(state.rows, REQUEST_ID).winners;
    expect(bindTranscriptSummary(winners, REQUEST_ID)).toMatchObject({ reason: 'bound', summary: { wmkf_requestdocumentid: SUMMARY_NEW_ID } });
    expect(deps.releaseSlotLease).toHaveBeenCalled();
  });

  test.each([
    ['another revision', { source_revision_id: OTHER_REVISION }],
    ['another boundary', { presentation_end_ms: '1500' }],
  ])('a draft made from %s is refused before any upload', async (_label, extra) => {
    drafts.getActiveSummaryDraft.mockResolvedValue(draftRow(extra));
    await expect(publish()).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_stale' });
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.releaseSlotLease).toHaveBeenCalled();
  });

  test.each([
    ['a different version', { expectedVersion: 3 }, () => draftRow()],
    ['no active draft', {}, () => null],
    ['a generating draft', {}, () => draftRow({ state: 'generating', summary_text: null })],
  ])('%s is refused before the lease', async (_label, body, active) => {
    drafts.getActiveSummaryDraft.mockResolvedValue(active());
    await expect(publish(body)).rejects.toMatchObject({ httpStatus: 409, code: 'summary_draft_changed' });
    expect(deps.acquireSlotLease).not.toHaveBeenCalled();
  });

  test('a retry after the row was created reuses it without a second upload', async () => {
    const first = await publish().then(() => deps.createDocument.mock.calls[0][0]);
    const created = state.rows.find((item) => item.wmkf_requestdocumentid === SUMMARY_NEW_ID);
    state.byKey = [{ ...created, wmkf_slotversion: 4 }];
    state.rows = state.rows.map((item) => (item.wmkf_requestdocumentid === SUMMARY_NEW_ID ? { ...item, wmkf_slotversion: 4 } : item));
    deps.uploadFile.mockClear(); deps.createDocument.mockClear();
    deps.findByGenerationKey.mockClear();
    await publish();
    expect(deps.findByGenerationKey).toHaveBeenCalledWith(first.wmkf_generationkey);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
    expect(deps.updateDocument).toHaveBeenCalledWith(SUMMARY_NEW_ID, expect.objectContaining({ wmkf_slotversion: 5 }), expect.anything());
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
    expect(drafts.markSummaryDraftPublished).not.toHaveBeenCalled();
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
