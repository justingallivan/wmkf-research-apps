/**
 * Binding between the Presentation Transcript derivative row (artifact type
 * 100000012) and the TRANSCRIPT bundle it was cut from. Pure.
 *
 * Outside pages serve bytes by the derivative row's own SharePoint item and
 * never read the bundle, so the derivative must be proven current before it
 * is served (plan §4.2 "Boundary generation"). The proof is the row's
 * `wmkf_generationkey`, which is a SHA-256 over the producer, request, type,
 * source bundle `revisionId`, and confirmed `presentationEnd.endMs`. A reader
 * recomputes the key from the current TRANSCRIPT winner's version-4 manifest
 * and serves the derivative only on an exact match. Moving or clearing the
 * boundary, or publishing a new bundle, therefore hides the derivative until
 * it is regenerated. Supersession is not relied on (plan §4.2).
 */
import crypto from 'node:crypto';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { validateMeetingTranscriptManifest, MEETING_TRANSCRIPT_BOUNDARY_SCHEMA_VERSION } from '../meeting-tracker-transcription/bundle.js';
import { projectPostPresentationMaterials } from './material-model.js';

export const POST_PRESENTATION_PRODUCER = 'meeting-tracker-post-presentation';
const { TRANSCRIPT, PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT } = REQUEST_DOCUMENT_ARTIFACT_TYPE;
const GENERATED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameId(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

function derivativeGenerationKey(artifactType, { requestId, sourceRevisionId, presentationEndMs }) {
  if (typeof requestId !== 'string' || !requestId || !GENERATED_UUID.test(sourceRevisionId || '')
    || !Number.isSafeInteger(presentationEndMs) || presentationEndMs < 0) throw new TypeError('invalid_presentation_transcript_identity');
  return crypto.createHash('sha256')
    .update(`${POST_PRESENTATION_PRODUCER}:${requestId.toLowerCase()}:${artifactType}:${sourceRevisionId.toLowerCase()}:${presentationEndMs}`)
    .digest('hex');
}

export function presentationTranscriptGenerationKey(identity) {
  return derivativeGenerationKey(PRESENTATION_TRANSCRIPT, identity);
}

/** Same recipe for the staff-only discussion derivative (type 100000013). */
export function staffDiscussionTranscriptGenerationKey(identity) {
  return derivativeGenerationKey(STAFF_DISCUSSION_TRANSCRIPT, identity);
}

function primaryFile(row) {
  return {
    siteId: row?.wmkf_sharepointsiteid, driveId: row?.wmkf_sharepointdriveid,
    itemId: row?.wmkf_sharepointitemid, versionId: row?.wmkf_sharepointversionid,
    eTag: row?.wmkf_sharepointetag, filename: row?.wmkf_filename,
    sha256: row?.wmkf_contenthash, contentType: row?.wmkf_contenttype, size: Number(row?.wmkf_filesize),
  };
}

/**
 * The confirmed boundary on a TRANSCRIPT row, or null when the row has no
 * verified version-4 bundle or its boundary is unconfirmed. Fails closed on
 * a malformed manifest.
 */
export function confirmedPresentationEnd(row, requestId) {
  if (!row || Number(row.wmkf_artifacttype) !== TRANSCRIPT || !row.wmkf_transcriptbundlejson) return null;
  let manifest;
  try {
    manifest = validateMeetingTranscriptManifest(JSON.parse(row.wmkf_transcriptbundlejson),
      { requestId, primaryFile: primaryFile(row) });
  } catch { return null; }
  if (manifest.schemaVersion < MEETING_TRANSCRIPT_BOUNDARY_SCHEMA_VERSION || !manifest.presentationEnd) return null;
  return { revisionId: manifest.revisionId, presentationEnd: manifest.presentationEnd };
}

/**
 * Given the per-type winners (material-model projection), decide whether the
 * Presentation Transcript winner is the one cut from the current TRANSCRIPT
 * winner at its confirmed boundary.
 *
 * Returns { transcript, boundary, presentationTranscript, reason } where
 * `presentationTranscript` is the bound row or null and `reason` is one of
 * 'bound', 'no_transcript', 'boundary_not_confirmed',
 * 'presentation_transcript_missing', 'presentation_transcript_stale'.
 */
export function bindPresentationTranscript(winners, requestId) {
  const rows = Array.isArray(winners) ? winners : [];
  const transcript = rows.find(row => Number(row?.wmkf_artifacttype) === TRANSCRIPT
    && row.wmkf_producer === POST_PRESENTATION_PRODUCER && (!requestId || sameId(row._wmkf_request_value, requestId))) || null;
  const candidate = rows.find(row => Number(row?.wmkf_artifacttype) === PRESENTATION_TRANSCRIPT
    && row.wmkf_producer === POST_PRESENTATION_PRODUCER && (!requestId || sameId(row._wmkf_request_value, requestId))) || null;
  if (!transcript) return { transcript: null, boundary: null, presentationTranscript: null, reason: 'no_transcript' };
  const boundary = confirmedPresentationEnd(transcript, requestId);
  if (!boundary) return { transcript, boundary: null, presentationTranscript: null, reason: 'boundary_not_confirmed' };
  if (!candidate) return { transcript, boundary, presentationTranscript: null, reason: 'presentation_transcript_missing' };
  const expected = presentationTranscriptGenerationKey({
    requestId: String(transcript._wmkf_request_value || requestId),
    sourceRevisionId: boundary.revisionId, presentationEndMs: boundary.presentationEnd.endMs,
  });
  if (candidate.wmkf_generationkey !== expected) {
    return { transcript, boundary, presentationTranscript: null, reason: 'presentation_transcript_stale' };
  }
  return { transcript, boundary, presentationTranscript: candidate, reason: 'bound' };
}

/**
 * Staff-side binding for the discussion derivative. Never used by an outside
 * reader. Returns { boundary, staffDiscussionTranscript, reason } with reason
 * 'bound' | 'no_transcript' | 'boundary_not_confirmed' | 'discussion_missing' |
 * 'discussion_stale'. A confirmed boundary with nothing after it is reported by
 * the writer, not here (the row is simply absent).
 */
export function bindStaffDiscussionTranscript(winners, requestId) {
  const rows = Array.isArray(winners) ? winners : [];
  const presentation = bindPresentationTranscript(rows, requestId);
  const candidate = rows.find(row => Number(row?.wmkf_artifacttype) === STAFF_DISCUSSION_TRANSCRIPT
    && row.wmkf_producer === POST_PRESENTATION_PRODUCER && (!requestId || sameId(row._wmkf_request_value, requestId))) || null;
  if (!presentation.transcript) return { boundary: null, staffDiscussionTranscript: null, reason: 'no_transcript' };
  if (!presentation.boundary) return { boundary: null, staffDiscussionTranscript: null, reason: 'boundary_not_confirmed' };
  if (!candidate) return { boundary: presentation.boundary, staffDiscussionTranscript: null, reason: 'discussion_missing' };
  const expected = staffDiscussionTranscriptGenerationKey({
    requestId: String(presentation.transcript._wmkf_request_value || requestId),
    sourceRevisionId: presentation.boundary.revisionId, presentationEndMs: presentation.boundary.presentationEnd.endMs,
  });
  if (candidate.wmkf_generationkey !== expected) {
    return { boundary: presentation.boundary, staffDiscussionTranscript: null, reason: 'discussion_stale' };
  }
  return { boundary: presentation.boundary, staffDiscussionTranscript: candidate, reason: 'bound' };
}

/**
 * Staff readers: drop every Presentation Transcript and Staff Discussion
 * Transcript row except the one bound to the current transcript revision and
 * confirmed boundary. A moved boundary, a new bundle, or a half that failed to
 * regenerate therefore never shows staff an old cut beside a new one; the full
 * TRANSCRIPT stays available. Fails closed (drops both) without bundle metadata.
 */
export function withoutUnboundDerivatives(rows, requestId) {
  const list = Array.isArray(rows) ? rows : [];
  const winners = projectPostPresentationMaterials(list, requestId).winners;
  const keep = new Set([
    bindPresentationTranscript(winners, requestId).presentationTranscript,
    bindStaffDiscussionTranscript(winners, requestId).staffDiscussionTranscript,
  ].filter(Boolean).map((row) => String(row.wmkf_requestdocumentid).toLowerCase()));
  return list.filter((row) => ![PRESENTATION_TRANSCRIPT, STAFF_DISCUSSION_TRANSCRIPT].includes(Number(row?.wmkf_artifacttype))
    || keep.has(String(row.wmkf_requestdocumentid).toLowerCase()));
}

