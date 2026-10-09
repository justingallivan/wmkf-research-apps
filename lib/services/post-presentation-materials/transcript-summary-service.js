/**
 * Site Visit summaries: the Transcript Summary (100000007, the presentation summary, served on the
 * Board and briefing links) and the staff-only Staff Discussion Summary (100000010). Each kind is a
 * row in SUMMARY_KINDS; one code path drafts, edits and publishes both (paired summaries plan D1).
 * The discussion kind summarizes the bound Staff Discussion Transcript, never slides, and is never
 * registered as a Transcript Summary.
 *
 * A program coordinator asks for a summary of the bound Presentation Transcript
 * (plus the applicants' slide PDF text when on file). The request carries the
 * current summarization acknowledgment, which is recorded on a new draft row
 * before the provider call. The accepted text becomes a Postgres draft the PC
 * reviews and edits; publishing writes a TXT to SharePoint and a request-document
 * row whose `wmkf_inputfingerprint` binds it to the source revision and boundary
 * (presentation-transcript-binding.js), so outside pages hide it after any
 * republish or boundary move. Plan §4.3, §6, §16.
 *
 * The Executor already throws on a provider refusal, a max_tokens stop, and any
 * other non-terminal stop (execute-prompt.js), so no separate
 * requireAcceptedLlmResponse call is made here.
 */
import crypto from 'node:crypto';
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import * as grantRequestAdapter from '../../dataverse/adapters/grant-request.js';
import * as siteVisitAdapter from '../../dataverse/adapters/site-visit.js';
import {
  REQUEST_DOCUMENT_ARTIFACT_TYPE, REQUEST_DOCUMENT_LIFECYCLE_STATE, REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../../shared/config/requestDocument.js';
import {
  PRESENTATION_SUMMARY_ACKNOWLEDGMENT, PAIRED_SUMMARY_ACKNOWLEDGMENT, SUMMARY_TEXT_MAX_CHARS,
} from '../../../shared/config/transcriptSummary.js';
import {
  PROMPT_NAME, PRESENTATION_TRANSCRIPT_MAX_CHARS, PRESENTATION_SLIDES_MAX_CHARS,
} from '../../../shared/config/prompts/meeting-presentation-summary.js';
import {
  PROMPT_NAME as DISCUSSION_PROMPT_NAME, DISCUSSION_TRANSCRIPT_MAX_CHARS,
} from '../../../shared/config/prompts/meeting-staff-discussion-summary.js';
import { staffDiscussionContent } from '../meeting-tracker-transcription/presentation-boundary.js';
import { REQUEST_DOCUMENT_ACTOR_POLICY } from '../request-document-actor-service.js';
import { GraphService } from '../graph-service.js';
import OperationalEventService from '../operational-event-service.js';
import { executePrompt } from '../execute-prompt.js';
import { getExecutorBudget } from '../executor-budget-service.js';
import { loadModelOverrides } from '../model-override-loader.js';
import { extractTextFromBuffer } from '../../utils/file-loader.js';
import { isGuid } from '../../utils/guid.js';
import { getRequestSharePointBuckets } from '../../utils/sharepoint-buckets.js';
import { POST_PRESENTATION_TRANSCRIPT_MAX_BYTES } from '../../utils/post-presentation-transcript-file.js';
import {
  isPostPresentationMaterialsRequestAllowed, isPostPresentationMaterialsSchemaReady,
} from '../../utils/post-presentation-materials-readiness.js';
import { isMeetingTranscriptBundleSchemaReady } from '../../utils/meeting-transcript-bundle-readiness.js';
import { requireMeetingTranscriptionEnabled } from '../meeting-tracker-transcription/policy.js';
import { loadMeetingTranscriptionBinding } from '../meeting-tracker-transcription/binding.js';
import { getMeetingTranscriptionSupervisedTestPolicy } from '../meeting-tracker-transcription/test-deployment-policy.js';
import { UTF8_BOM } from '../transcription-pilot/transcript-format.js';
import { projectPostPresentationMaterials } from './material-model.js';
import {
  bindPresentationTranscript, bindStaffDiscussionTranscript, bindTranscriptSummary, bindStaffDiscussionSummary,
  transcriptSummaryBindingFingerprint, staffDiscussionSummaryBindingFingerprint, POST_PRESENTATION_PRODUCER,
} from './presentation-transcript-binding.js';
import {
  acquireMaterialSlot, renewOrLose, loadBoundContext, activeBucket, sanitizeForSharePoint, materialError,
} from './material-service.js';
import {
  acquirePresentationSlotLease, getPresentationSlotLease, renewPresentationSlotLease, releasePresentationSlotLease,
} from './slot-lease-store.js';
import { uploadAndVerify, settleWinner, recordReconciliation, loadVerifiedSource } from './presentation-transcript-service.js';
import * as draftStore from './summary-draft-store.js';
import { pickSlidesRow, presentationSummarySlidesChanged } from './summary-slides-identity.js';

export { presentationSummarySlidesChanged };

const {
  TRANSCRIPT, PRESENTATION_TRANSCRIPT, TRANSCRIPT_SUMMARY, STAFF_DISCUSSION_TRANSCRIPT, STAFF_DISCUSSION_SUMMARY,
} = REQUEST_DOCUMENT_ARTIFACT_TYPE;
const CONTENT_TYPE = 'text/plain; charset=utf-8';
const SLIDES_MAX_BYTES = 40 * 1024 * 1024;
const NO_SLIDES = '(No slide text is on file.)';

/**
 * The two summary kinds (paired summaries plan D1). The presentation entry reproduces the
 * pre-Stage-2 folder, filename, name, codes and fingerprint exactly (golden test).
 */
export const SUMMARY_KINDS = Object.freeze({
  presentation: Object.freeze({
    kind: 'presentation',
    artifactType: TRANSCRIPT_SUMMARY,
    promptName: PROMPT_NAME,
    folder: 'Site Visit - Transcript Summary',
    label: 'transcript summary',
    codePrefix: 'transcript_summary',
    stagePrefix: 'transcript-summary',
    operation: 'meeting-tracker-transcript-summary',
    fileStem: 'Presentation-Summary',
    name: (requestNum) => `${requestNum} research presentation summary`,
    acknowledgment: PRESENTATION_SUMMARY_ACKNOWLEDGMENT,
    acceptedAcknowledgments: Object.freeze([PRESENTATION_SUMMARY_ACKNOWLEDGMENT.version, PAIRED_SUMMARY_ACKNOWLEDGMENT.version]),
    fingerprint: transcriptSummaryBindingFingerprint,
    published: (bound) => bound.summary,
  }),
  discussion: Object.freeze({
    kind: 'discussion',
    artifactType: STAFF_DISCUSSION_SUMMARY,
    promptName: DISCUSSION_PROMPT_NAME,
    folder: 'Site Visit - Staff Discussion Summary',
    label: 'staff discussion summary',
    codePrefix: 'staff_discussion_summary',
    stagePrefix: 'staff-discussion-summary',
    operation: 'meeting-tracker-staff-discussion-summary',
    fileStem: 'Staff-Discussion-Summary',
    name: (requestNum) => `${requestNum} site visit staff discussion summary (staff only)`,
    acknowledgment: PAIRED_SUMMARY_ACKNOWLEDGMENT,
    acceptedAcknowledgments: Object.freeze([PAIRED_SUMMARY_ACKNOWLEDGMENT.version]),
    fingerprint: staffDiscussionSummaryBindingFingerprint,
    published: (bound) => bound.discussionSummary,
  }),
});
const KIND_BY_TYPE = new Map(Object.values(SUMMARY_KINDS).map((spec) => [spec.artifactType, spec]));

/** The spec for a request's kind; absent means presentation. Anything else is refused. */
export function summaryKind(kind) {
  if (kind === undefined || kind === null) return SUMMARY_KINDS.presentation;
  const spec = Object.prototype.hasOwnProperty.call(SUMMARY_KINDS, kind) ? SUMMARY_KINDS[kind] : null;
  if (!spec) throw materialError('Unknown summary kind.', 'summary_kind_invalid', 400);
  return spec;
}

export const TRANSCRIPT_SUMMARY_DEPENDENCIES = Object.freeze({
  schemaReady: isPostPresentationMaterialsSchemaReady,
  requestAllowed: isPostPresentationMaterialsRequestAllowed,
  loadBinding: (requestId) => loadMeetingTranscriptionBinding(requestId),
  getRequest: (requestId) => grantRequestAdapter.getById(requestId, {
    select: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate'],
  }),
  findActiveSiteVisit: (requestId) => siteVisitAdapter.findActiveByRequest(requestId),
  findDocuments: (requestId) => requestDocumentAdapter.findByRequest(requestId, { includeMeetingTranscriptBundle: true }),
  findByGenerationKey: (key) => requestDocumentAdapter.findByGenerationKey(key),
  createDocument: (payload, options) => requestDocumentAdapter.create(payload, options),
  updateDocument: (id, patch, options) => requestDocumentAdapter.update(id, patch, options),
  getSharePointBuckets: getRequestSharePointBuckets,
  ensureFolderPath: (library, folder) => GraphService.ensureFolderPath(library, folder),
  uploadFile: (...args) => GraphService.uploadFileLarge(...args),
  getFileMetadataById: (...args) => GraphService.getFileMetadataById(...args),
  downloadFile: (...args) => GraphService.downloadFile(...args),
  extractText: extractTextFromBuffer,
  loadVerifiedSource,
  acquireSlotLease: acquirePresentationSlotLease,
  getSlotLease: getPresentationSlotLease,
  renewSlotLease: renewPresentationSlotLease,
  releaseSlotLease: releasePresentationSlotLease,
  recordEvent: (event) => OperationalEventService.recordEvent(event),
  loadModelOverrides,
  getExecutorBudget,
  executePrompt,
  drafts: draftStore,
  randomUUID: () => crypto.randomUUID(),
  now: () => new Date(),
});

const sameId = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprintOf = (row) => row?.wmkf_inputfingerprint || row?.wmkf_contenthash || null;

// Executor failures a PC can act on, mapped to plain copy; anything else is a 502.
const EXECUTOR_FAILURES = Object.freeze({
  claude_output_refused: [422, 'The AI provider declined to summarize this transcript. No draft was created.'],
  claude_output_truncated: [422, 'The summary ran past its length budget. Ask an administrator to raise the summary budget, then try again.'],
  claude_context_window_exceeded: [422, 'The transcript is too long to summarize in one request.'],
  claude_output_empty: [502, 'The AI provider returned an empty summary. Try again.'],
  claude_output_incomplete: [502, 'The AI provider did not finish the summary. Try again.'],
});

function assertEnabled(requestId, ownerProfileId, actingUserSystemId, dependencies, { needsActor = true } = {}) {
  requireMeetingTranscriptionEnabled(requestId);
  if (!Number.isSafeInteger(ownerProfileId) || ownerProfileId < 1) throw materialError('A staff profile is required.', 'profile_required', 401);
  if (needsActor && !isGuid(actingUserSystemId || '')) {
    throw materialError('A mapped Dataverse staff identity is required.', 'post_presentation_actor_required', 403);
  }
  if (!isMeetingTranscriptBundleSchemaReady()) throw materialError('Transcript bundle metadata is not enabled.', 'meeting_transcript_bundle_schema_not_ready', 503);
  if (!dependencies.schemaReady()) throw materialError('Presentation materials are not enabled for this environment.', 'post_presentation_schema_not_ready', 503);
  if (!dependencies.requestAllowed(requestId)) throw materialError('Presentation materials are not available.', 'post_presentation_not_available', 404);
  if (getMeetingTranscriptionSupervisedTestPolicy().requested) {
    throw materialError('A supervised test cannot write a transcript summary.', 'meeting_transcription_supervised_test_unsupported', 409);
  }
}

async function bindCurrent(requestId, dependencies) {
  const result = await dependencies.findDocuments(requestId);
  const rows = result?.records || [];
  const types = [TRANSCRIPT, PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT, ...KIND_BY_TYPE.keys()];
  const winners = projectPostPresentationMaterials(rows.filter((row) => types.includes(Number(row?.wmkf_artifacttype))), requestId).winners;
  return {
    ...bindPresentationTranscript(winners, requestId),
    discussion: bindStaffDiscussionTranscript(winners, requestId),
    summary: bindTranscriptSummary(winners, requestId),
    discussionSummary: bindStaffDiscussionSummary(winners, requestId),
    rows,
  };
}

function assertExpectedTranscript(bound, body) {
  if (!bound.transcript || !sameId(bound.transcript.wmkf_requestdocumentid, body.expectedCurrentArtifactId)
    || fingerprintOf(bound.transcript) !== body.expectedCurrentFingerprint) {
    throw materialError('The current transcript changed. Reload before summarizing.', 'meeting_transcript_current_changed', 409);
  }
}

function summaryState(summary) {
  const state = { bound: 'bound', summary_missing: 'missing', summary_stale: 'stale' }[summary.reason] || 'not_confirmed';
  return { state, artifactId: summary.candidate?.wmkf_requestdocumentid || null, publishedAt: summary.candidate?.createdon || null };
}

function draftDto(row) {
  if (!row) return null;
  return {
    id: row.id, state: row.state, version: Number(row.version), text: ['ready', 'publishing'].includes(row.state) ? row.summary_text : null,
    edited: Boolean(row.text_edited), presentationEndMs: Number(row.presentation_end_ms),
    createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
  };
}

/** Read a bound transcript derivative's exact bytes (pinned hash and eTag) as text. */
async function readVerifiedText(row, dependencies, { label = 'presentation transcript', code = 'presentation_transcript_integrity_failed' } = {}) {
  const driveId = row.wmkf_sharepointdriveid;
  const itemId = row.wmkf_sharepointitemid;
  const downloaded = await dependencies.downloadFile(driveId, itemId, { maxBytes: POST_PRESENTATION_TRANSCRIPT_MAX_BYTES });
  const latest = await dependencies.getFileMetadataById(driveId, itemId, { siteId: row.wmkf_sharepointsiteid || null });
  if (!Buffer.isBuffer(downloaded?.buffer) || !row.wmkf_contenthash || sha256(downloaded.buffer) !== row.wmkf_contenthash
    || !latest || !row.wmkf_sharepointetag || latest.eTag !== row.wmkf_sharepointetag) {
    throw materialError(`The ${label} could not be verified. Generate it again, then summarize.`, code, 409);
  }
  return downloaded.buffer.toString('utf8').replace(/^﻿/, '');
}

/** The picked slide PDF as text clipped to the variable budget, or null. Slides are supplementary: any failure yields null. */
async function readSlidesText(pdf, dependencies) {
  if (!pdf) return null;
  try {
    const downloaded = await dependencies.downloadFile(pdf.wmkf_sharepointdriveid, pdf.wmkf_sharepointitemid, { maxBytes: SLIDES_MAX_BYTES });
    if (!Buffer.isBuffer(downloaded?.buffer)) return null;
    const text = String(await dependencies.extractText(downloaded.buffer, pdf.wmkf_filename || 'slides.pdf', 'application/pdf') || '').trim();
    return text ? text.slice(0, PRESENTATION_SLIDES_MAX_CHARS) : null;
  } catch {
    return null;
  }
}

function classifyExecutorFailure(error) {
  const mapped = EXECUTOR_FAILURES[error?.code];
  if (mapped) return materialError(mapped[1], `summary_${error.code}`, mapped[0]);
  return null;
}

/** Source text and prompt variables for one kind's run, or a thrown 4xx before any row exists. */
async function prepareSummaryInput(spec, bound, binding, boundRequestId, body, ownerProfileId, dependencies) {
  if (spec.kind === 'presentation') {
    if (!bound.presentationTranscript) {
      throw materialError('Generate the presentation transcript for the confirmed presentation end before summarizing.',
        'presentation_transcript_not_ready', 409);
    }
    const transcriptText = await readVerifiedText(bound.presentationTranscript, dependencies);
    if (!transcriptText.trim()) throw materialError('The presentation transcript is empty.', 'presentation_transcript_empty', 422);
    if (transcriptText.length > PRESENTATION_TRANSCRIPT_MAX_CHARS) {
      throw materialError('The presentation transcript is too long to summarize in one request.', 'presentation_transcript_too_long', 422);
    }
    const slides = pickSlidesRow(bound.rows, boundRequestId);
    const slidesText = await readSlidesText(slides, dependencies);
    return {
      sourceRow: bound.presentationTranscript,
      overrideVariables: { presentation_transcript: transcriptText, presentation_slides: slidesText || NO_SLIDES },
      slidesArtifactId: slides?.wmkf_requestdocumentid || null,
      slidesContentHash: slides ? slides.wmkf_contenthash : null,
      slidesIncluded: Boolean(slidesText),
    };
  }
  const discussionRow = bound.discussion?.reason === 'bound' ? bound.discussion.staffDiscussionTranscript : null;
  if (!bound.boundary || !discussionRow) {
    throw materialError('Generate the staff discussion transcript for the confirmed presentation end before summarizing.',
      'staff_discussion_transcript_not_ready', 409);
  }
  // Plan D4: an empty discussion is judged from the verified source, never from the note text.
  // It is recorded as a failed marker run with no provider call.
  const source = await dependencies.loadVerifiedSource(bound, binding.siteVisitActivityId, boundRequestId, dependencies);
  if (staffDiscussionContent(source.content, bound.boundary.presentationEnd.endMs).utterances.length === 0) {
    await dependencies.drafts.recordEmptySummaryRun({
      id: dependencies.randomUUID(), requestId: boundRequestId, artifactType: spec.artifactType,
      sourceRevisionId: bound.boundary.revisionId, presentationEndMs: bound.boundary.presentationEnd.endMs,
      sourceArtifactId: discussionRow.wmkf_requestdocumentid, acknowledgmentVersion: body.acknowledgmentVersion,
      profileId: ownerProfileId, failureCode: 'staff_discussion_not_recorded',
    });
    throw materialError('No staff discussion was recorded after the presentation ended.', 'staff_discussion_not_recorded', 422);
  }
  const transcriptText = await readVerifiedText(discussionRow, dependencies,
    { label: 'staff discussion transcript', code: 'staff_discussion_transcript_integrity_failed' });
  if (!transcriptText.trim()) throw materialError('The staff discussion transcript is empty.', 'staff_discussion_transcript_empty', 422);
  if (transcriptText.length > DISCUSSION_TRANSCRIPT_MAX_CHARS) {
    throw materialError('The staff discussion transcript is too long to summarize in one request.', 'staff_discussion_transcript_too_long', 422);
  }
  return {
    sourceRow: discussionRow,
    overrideVariables: { discussion_transcript: transcriptText },
    slidesArtifactId: null,
    slidesContentHash: null,
    slidesIncluded: false,
  };
}

/**
 * Create a summary draft of one kind (body.kind; absent means presentation). The acknowledgment is
 * required and recorded before the provider call; only accepted text becomes a draft. A ready draft
 * of the kind is replaced only when body.replaceDraft names it (plan D2).
 */
export async function createSummaryDraft({
  requestId, ownerProfileId, actingUserSystemId, body,
}, dependencies = TRANSCRIPT_SUMMARY_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, actingUserSystemId, dependencies);
  const spec = summaryKind(body?.kind);
  if (!spec.acceptedAcknowledgments.includes(body?.acknowledgmentVersion)) {
    throw materialError('Confirm the summarization notice before summarizing.', 'summary_acknowledgment_required', 400);
  }
  const binding = await dependencies.loadBinding(requestId);
  const boundRequestId = binding.requestId;
  const bound = await bindCurrent(boundRequestId, dependencies);
  assertExpectedTranscript(bound, body);
  const input = await prepareSummaryInput(spec, bound, binding, boundRequestId, body, ownerProfileId, dependencies);

  const draftId = dependencies.randomUUID();
  const reservation = await dependencies.drafts.reserveSummaryDraftRun({
    id: draftId, requestId: boundRequestId, artifactType: spec.artifactType,
    sourceRevisionId: bound.boundary.revisionId, presentationEndMs: bound.boundary.presentationEnd.endMs,
    sourceArtifactId: input.sourceRow.wmkf_requestdocumentid,
    acknowledgmentVersion: body.acknowledgmentVersion, profileId: ownerProfileId,
    slidesArtifactId: input.slidesArtifactId, slidesContentHash: input.slidesContentHash,
    replaceDraft: body.replaceDraft || null,
  });
  if (reservation?.conflict?.code === 'summary_draft_exists') {
    throw materialError('A summary draft is already waiting for review. Reload before summarizing again.',
      'summary_draft_exists', 409, { draftId: reservation.conflict.draftId, version: reservation.conflict.version });
  }
  const draft = reservation?.draft;
  if (!draft) throw materialError('A summary is already being generated or published for this request.', 'summary_generation_in_progress', 409);

  let result;
  try {
    await dependencies.loadModelOverrides();
    const budget = await dependencies.getExecutorBudget(spec.promptName);
    result = await dependencies.executePrompt({
      promptName: spec.promptName,
      requestId: boundRequestId,
      requireNoPersistence: true,
      auditRetention: 'content-free',
      overrideVariables: input.overrideVariables,
      runSource: 'Vercel Interactive',
      actingUserSystemId,
      maxTokensOverride: budget.maxTokensOverride,
      timeoutMsOverride: budget.timeoutMsOverride,
    });
    if (result?.blocked) throw Object.assign(new Error('The summary prompt was blocked.'), { code: 'summary_prompt_blocked' });
  } catch (error) {
    await dependencies.drafts.failSummaryDraft({ id: draftId, failureCode: error?.code || 'summary_provider_failed' }).catch(() => {});
    const mapped = classifyExecutorFailure(error);
    if (mapped) throw mapped;
    throw materialError('The summary could not be generated. Try again.', 'summary_generation_failed', 502);
  }
  const text = typeof result?.parsed?.summary === 'string' ? result.parsed.summary.trim() : '';
  if (!text || text.length > SUMMARY_TEXT_MAX_CHARS) {
    await dependencies.drafts.failSummaryDraft({ id: draftId, failureCode: 'summary_output_invalid' }).catch(() => {});
    throw materialError('The AI provider returned a summary that could not be used. Try again.', 'summary_output_invalid', 502);
  }
  const ready = await dependencies.drafts.completeSummaryDraft({
    id: draftId, text, promptName: result.meta?.promptName || spec.promptName,
    promptVersion: Number.isInteger(result.meta?.promptVersion) ? result.meta.promptVersion : null,
    promptId: isGuid(result.meta?.promptId || '') ? result.meta.promptId : null,
    aiRunId: isGuid(result.runId || '') ? result.runId : null,
  });
  if (!ready) throw materialError('This summary was replaced by a newer request.', 'summary_draft_superseded', 409);
  return { kind: spec.kind, draft: draftDto(ready), slidesIncluded: input.slidesIncluded, transcriptSummary: summaryState(spec.published(bound)) };
}

/**
 * One kind's active draft (if any), the newest run's state, and that kind's published state.
 * `kind` comes from the GET query; absent means presentation and the response is unchanged apart
 * from `kind`. For discussion, `discussionNotRecorded` is true only when the newest run is the D4
 * marker judged against the current boundary (plan D4 step 3).
 */
export async function getSummaryDraft({ requestId, ownerProfileId, kind }, dependencies = TRANSCRIPT_SUMMARY_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
  const spec = summaryKind(kind);
  const binding = await dependencies.loadBinding(requestId);
  const [draft, latest, bound] = await Promise.all([
    dependencies.drafts.getActiveSummaryDraft({ requestId: binding.requestId, artifactType: spec.artifactType }),
    dependencies.drafts.getLatestSummaryRun({ requestId: binding.requestId, artifactType: spec.artifactType }),
    bindCurrent(binding.requestId, dependencies),
  ]);
  const current = bound.boundary
    ? { revisionId: bound.boundary.revisionId, endMs: bound.boundary.presentationEnd.endMs } : null;
  const draftCurrent = Boolean(draft && current && sameId(draft.source_revision_id, current.revisionId)
    && Number(draft.presentation_end_ms) === current.endMs);
  const published = spec.published(bound);
  const slidesChangedSinceSummary = spec.kind === 'presentation'
    ? await presentationSummarySlidesChanged({
      requestId: binding.requestId, rows: bound.rows, publishedArtifactId: bound.summary.candidate?.wmkf_requestdocumentid,
    }, dependencies).catch(() => null)
    : null;
  const response = {
    kind: spec.kind,
    draft: draftDto(draft),
    draftMatchesTranscript: draftCurrent,
    slidesChangedSinceSummary,
    lastFailure: latest?.state === 'failed' ? { code: latest.failure_code, at: latest.updated_at } : null,
    transcriptSummary: summaryState(published),
    acknowledgment: spec.acknowledgment,
  };
  if (spec.kind === 'discussion') {
    response.discussionNotRecorded = Boolean(latest && current && latest.state === 'failed'
      && latest.failure_code === 'staff_discussion_not_recorded'
      && sameId(latest.source_revision_id, current.revisionId) && Number(latest.presentation_end_ms) === current.endMs);
  }
  return response;
}

export async function updateSummaryDraft({ requestId, ownerProfileId, body }, dependencies = TRANSCRIPT_SUMMARY_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
  const text = typeof body?.text === 'string' ? body.text.replace(/\r\n/g, '\n').trim() : '';
  if (!text || text.length > SUMMARY_TEXT_MAX_CHARS) throw materialError('The summary must be between 1 and 100,000 characters.', 'summary_text_invalid', 400);
  const binding = await dependencies.loadBinding(requestId);
  const row = await dependencies.drafts.updateSummaryDraftText({
    id: body.draftId, requestId: binding.requestId, text, expectedVersion: body.expectedVersion, profileId: ownerProfileId,
  });
  if (!row) throw materialError('This draft changed or expired. Reload before editing.', 'summary_draft_changed', 409);
  return { draft: draftDto(row) };
}

export async function discardSummaryDraft({ requestId, ownerProfileId, body }, dependencies = TRANSCRIPT_SUMMARY_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
  const binding = await dependencies.loadBinding(requestId);
  const row = await dependencies.drafts.discardSummaryDraft({
    id: body.draftId, requestId: binding.requestId, expectedVersion: body.expectedVersion, profileId: ownerProfileId,
  });
  if (!row) throw materialError('This draft changed or expired. Reload.', 'summary_draft_changed', 409);
  return { draft: null };
}

// To the second: drafts are created one at a time and each run takes far longer than a
// second, so the path is unique per draft (Codex review: minute precision let two drafts share it).
function stamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Publish a ready draft as its own kind: TXT to SharePoint, registry row bound to the draft's
 * source revision and boundary, older summaries of that kind superseded, draft text cleared.
 * Refuses a draft made from a transcript revision or boundary that is no longer current. The
 * kind comes only from the stored row, never from the client (plan D2).
 */
export async function publishSummaryDraft({
  requestId, ownerProfileId, actingUserSystemId, body,
}, dependencies = TRANSCRIPT_SUMMARY_DEPENDENCIES) {
  assertEnabled(requestId, ownerProfileId, actingUserSystemId, dependencies);
  const binding = await dependencies.loadBinding(requestId);
  const boundRequestId = binding.requestId;
  // Claim first, owned by this request's token (Codex reviews 2026-10-05): from here on, edit,
  // discard, a new run, and a second publish cannot change, retire, or release this draft, so only
  // the text read here can be published. A claim held by a running publish is refused.
  const token = dependencies.randomUUID();
  // The claim names the draft's own stored kind, and the claimed row must match it: a draft is only
  // ever registered as its own kind, so a staff-only discussion draft can never become a Board-visible
  // Transcript Summary (release step 0, generalized). An unknown kind fails closed.
  const storedType = await dependencies.drafts.getSummaryDraftArtifactType({ id: body.draftId, requestId: boundRequestId });
  const spec = KIND_BY_TYPE.get(storedType);
  if (!spec) {
    throw materialError('This draft changed, expired, or is already being published. Reload before publishing.',
      'summary_draft_changed', 409);
  }
  const draft = await dependencies.drafts.claimSummaryDraftForPublish({ id: body.draftId, requestId: boundRequestId,
    artifactType: spec.artifactType, expectedVersion: body.expectedVersion, token, profileId: ownerProfileId });
  if (!draft) {
    throw materialError('This draft changed, expired, or is already being published. Reload before publishing.',
      'summary_draft_changed', 409);
  }
  if (Number(draft.artifact_type) !== spec.artifactType) {
    await dependencies.drafts.releaseSummaryDraftClaim({ id: draft.id, token }).catch(() => null);
    throw materialError('This draft cannot be published as this summary kind.', 'summary_draft_kind_unsupported', 409);
  }
  try {
    return await publishClaimedDraft({ spec, draft, token, binding, boundRequestId, ownerProfileId, actingUserSystemId }, dependencies);
  } catch (error) {
    // The store returns the claim to 'ready' only if no registry write was ever attempted on this draft
    // (a durable flag, not this request's memory); otherwise the claim is yielded and stays 'publishing',
    // so only a retry (same key, same file) can finish it.
    const released = await dependencies.drafts.releaseSummaryDraftClaim({ id: draft.id, token }).catch(() => null);
    if (!released) await dependencies.drafts.yieldSummaryDraftClaim({ id: draft.id, token }).catch(() => {});
    throw error;
  }
}

async function publishClaimedDraft({ spec, draft, token, binding, boundRequestId, ownerProfileId, actingUserSystemId }, dependencies) {
  const { request, siteVisit, cycleCode } = await loadBoundContext(boundRequestId, dependencies);
  if (!sameId(siteVisit.activityid, binding.siteVisitActivityId)) {
    throw materialError('The active Site Visit changed. Reload before publishing.', 'meeting_transcript_site_visit_changed', 409);
  }
  const bucket = activeBucket(await dependencies.getSharePointBuckets(boundRequestId, request.akoya_requestnum));
  if (!bucket) throw materialError('The request has no active SharePoint folder.', 'post_presentation_folder_unavailable', 503);

  const operationId = token;
  const lease = await acquireMaterialSlot({ requestId: boundRequestId, artifactType: spec.artifactType,
    leaseToken: operationId, label: spec.label }, dependencies);
  let createdId = null;
  try {
    const bound = await bindCurrent(boundRequestId, dependencies);
    if (!bound.boundary || !sameId(bound.boundary.revisionId, draft.source_revision_id)
      || bound.boundary.presentationEnd.endMs !== Number(draft.presentation_end_ms)) {
      throw materialError('The transcript or presentation end changed after this summary was drafted. Summarize again.',
        'summary_draft_stale', 409);
    }
    const bindingFingerprint = spec.fingerprint({ requestId: boundRequestId,
      sourceRevisionId: bound.boundary.revisionId, presentationEndMs: bound.boundary.presentationEnd.endMs });
    // The UTF-8 byte-order mark keeps SharePoint and the Board's browser from reading the text as Windows-1252.
    const bytes = Buffer.concat([Buffer.from(UTF8_BOM), Buffer.from(`${draft.summary_text.replace(/\s+$/, '')}\n`, 'utf8')]);
    const contentSha = sha256(bytes);
    // Unique per publish (the generation key is an alternate key) and stable across retries of this one.
    const generationKey = sha256(`${POST_PRESENTATION_PRODUCER}:${boundRequestId.toLowerCase()}:${spec.artifactType}:draft:${String(draft.id).toLowerCase()}:${contentSha}`);
    const existing = await dependencies.findByGenerationKey(generationKey);
    if ((existing?.records || []).length > 1) throw materialError(`The ${spec.label} retry identity is ambiguous.`, `${spec.codePrefix}_generation_ambiguous`, 500);
    const prior = existing?.records?.[0] || null;
    // Durably record the registry phase under the claim right before any registry write (or reuse of
    // one): from then on the draft can never return to 'ready'. A failure before this point (stale
    // draft, upload) releases it.
    const enterRegistryPhase = async () => {
      if (!await dependencies.drafts.markSummaryDraftRegistering({ id: draft.id, token })) {
        throw materialError('This draft is no longer held by this publish. Reload.', 'summary_draft_changed', 409);
      }
    };
    if (prior) {
      await enterRegistryPhase();
      if (!sameId(prior._wmkf_request_value, boundRequestId) || Number(prior.wmkf_artifacttype) !== spec.artifactType
        || prior.wmkf_producer !== POST_PRESENTATION_PRODUCER || prior.wmkf_inputfingerprint !== bindingFingerprint) {
        throw materialError(`An existing ${spec.label} conflicts with this draft.`, `${spec.codePrefix}_registry_conflict`, 409);
      }
      createdId = prior.wmkf_requestdocumentid;
    } else {
      const requestNum = sanitizeForSharePoint(request.akoya_requestnum || 'Request');
      const folderPath = `${String(bucket.folder).replace(/\/+$/, '')}/${spec.folder}`;
      // The filename reaches the Board page: the draft's creation time and version, never an id. Edits
      // bump the version, so different text never reuses a path and `replace` only ever overwrites
      // this exact content's own unregistered upload.
      const filename = `${requestNum}-${spec.fileStem}-${stamp(draft.created_at)}-v${Number(draft.version)}.txt`;
      await renewOrLose(lease, dependencies);
      const file = await uploadAndVerify({ bucket, folderPath, filename, bytes, expectedSha: contentSha,
        label: spec.label, codePrefix: spec.codePrefix }, dependencies, lease);
      await renewOrLose(lease, dependencies);
      await enterRegistryPhase();
      let row;
      try {
        row = await dependencies.createDocument({
          wmkf_name: spec.name(request.akoya_requestnum || 'Request'),
          'wmkf_Request@odata.bind': `/akoya_requests(${boundRequestId})`,
          wmkf_artifacttype: spec.artifactType,
          wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
          wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
          wmkf_generationkey: generationKey,
          wmkf_cyclecode: cycleCode,
          wmkf_inputfingerprint: bindingFingerprint,
          wmkf_claimtoken: operationId,
          wmkf_producer: POST_PRESENTATION_PRODUCER,
          wmkf_contenttype: CONTENT_TYPE,
          wmkf_contenthash: contentSha,
          wmkf_sharepointsiteid: file.siteId,
          wmkf_sharepointdriveid: file.driveId,
          wmkf_sharepointitemid: file.itemId,
          wmkf_sharepointweburl: file.webUrl,
          wmkf_sharepointversionid: file.versionId,
          wmkf_sharepointetag: file.eTag,
          wmkf_sharepointfolderpath: folderPath,
          wmkf_filename: file.filename,
          wmkf_filesize: bytes.length,
          wmkf_sharepointlastmodified: file.lastModified,
          wmkf_slotversion: lease.fenceVersion,
          ...(draft.prompt_name ? { wmkf_promptname: draft.prompt_name } : {}),
          ...(Number.isInteger(draft.prompt_version) ? { wmkf_promptversion: draft.prompt_version } : {}),
          ...(draft.prompt_id ? { 'wmkf_AIPrompt@odata.bind': `/wmkf_ai_prompts(${draft.prompt_id})` } : {}),
          ...(draft.ai_run_id ? { 'wmkf_AIRun@odata.bind': `/wmkf_ai_runs(${draft.ai_run_id})` } : {}),
        }, {
          actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
          actorContext: { operation: spec.operation, requestId: boundRequestId, operationId },
          actingUserSystemId,
        });
      } catch (error) {
        await recordReconciliation({ requestId: boundRequestId, artifactType: spec.artifactType, operationId, requestDocumentId: null,
          fenceVersion: lease.fenceVersion, stage: `${spec.stagePrefix}-register`, reason: error?.code || 'register_failed',
          folderPath, filename, label: spec.label }, dependencies);
        throw error;
      }
      createdId = row?.wmkf_requestdocumentid || row?.id || null;
      if (!createdId) throw materialError(`Dataverse did not confirm the ${spec.label} row.`, `${spec.codePrefix}_registry_unconfirmed`, 502);
    }
    // A restored or newly created row is fenced at this lease; older summaries are superseded.
    if (prior && Number(prior.wmkf_slotversion || 0) !== lease.fenceVersion) {
      await renewOrLose(lease, dependencies);
      await dependencies.updateDocument(createdId, {
        wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
        wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
        wmkf_slotversion: lease.fenceVersion,
      }, {
        actorPolicy: REQUEST_DOCUMENT_ACTOR_POLICY.REQUIRED,
        actorContext: { operation: `${spec.operation}-restore`, requestId: boundRequestId, operationId },
        actingUserSystemId,
      });
    }
    const winner = await settleWinner({ requestId: boundRequestId, artifactType: spec.artifactType, operationLabel: spec.operation,
      keepId: createdId, lease, operationId, actingUserSystemId, label: spec.label, codePrefix: spec.codePrefix }, dependencies);
    const marked = await dependencies.drafts.markSummaryDraftPublished({ id: draft.id, token,
      publishedArtifactId: createdId, profileId: ownerProfileId });
    if (!marked) {
      // Only an abandoned claim (older than the route's limit) can be taken over, so this publish ran
      // past it. The summary is published; record the draft mismatch.
      await recordReconciliation({ requestId: boundRequestId, artifactType: spec.artifactType, operationId, requestDocumentId: createdId,
        fenceVersion: lease.fenceVersion, stage: `${spec.stagePrefix}-draft-mark`, reason: 'draft_claim_lost', label: spec.label }, dependencies);
    }
    return {
      kind: spec.kind,
      transcriptSummary: { state: 'bound', artifactId: winner.wmkf_requestdocumentid, publishedAt: winner.createdon || null },
      draft: null,
    };
  } finally {
    await dependencies.releaseSlotLease(lease).catch(async (error) => {
      await Promise.resolve(dependencies.recordEvent({
        eventType: 'post_presentation_material_reconciliation_required',
        severity: 'warning',
        summary: `A ${spec.label} slot lease could not be released.`,
        subsystem: 'post-presentation-materials',
        stage: `${spec.stagePrefix}-slot-release`,
        transient: false,
        correlationId: operationId,
        dedupeKey: `post-presentation-reconciliation:${operationId}:${spec.stagePrefix}-slot-release`,
        entityRefs: { requestId: boundRequestId, requestDocumentId: createdId, predecessorIds: [] },
        metadata: { artifactType: spec.artifactType, fenceVersion: lease.fenceVersion, reason: error?.code || 'slot_release_failed' },
      })).catch(() => {});
    });
  }
}
