/**
 * Binding between the approved Presentation Video row (artifact type 100000011, Stage 4) and the
 * current transcript revision, confirmed presentation end and source Recording it was cut from.
 * Pure. Plan docs/plans/STAGE4_BUILD_PLAN_2026-10-10.md, Slice 4.
 *
 * The proof is the row's `wmkf_inputfingerprint`, a SHA-256 over a fixed, versioned string of the
 * producer, request, type, transcript revision, `endMs`, and the source Recording's document id and
 * SharePoint eTag. A reader recomputes it from the CURRENT TRANSCRIPT manifest and the CURRENT
 * RECORDING winner and serves the video only on an exact match. A moved boundary, a new transcript
 * bundle or a replaced Recording therefore hides the video. With no current transcript the video is
 * `stale` (fail closed); Stage 5 must add an authorized-retirement transition before it deletes a
 * TRANSCRIPT or RECORDING row that an approved video depends on.
 *
 * `wmkf_generationkey` is NOT the binding: it is unique per split (an alternate key), so a re-cut
 * at the same boundary registers a new row.
 */
import crypto from 'node:crypto';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { isGuid } from '../../utils/guid.js';
import { bindPresentationTranscript, POST_PRESENTATION_PRODUCER } from './presentation-transcript-binding.js';
import { materialBacking } from './material-model.js';

const { PRESENTATION_VIDEO, RECORDING } = REQUEST_DOCUMENT_ARTIFACT_TYPE;
const FINGERPRINT_VERSION = 'presentation-video-v1';

const sameId = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

/** The binding hash stored on the approved row's `wmkf_inputfingerprint`. The eTag is last: it may contain colons. */
export function presentationVideoFingerprint({ requestId, transcriptRevisionId, presentationEndMs, sourceDocumentId, sourceEtag }) {
  if (!isGuid(requestId || '') || !isGuid(transcriptRevisionId || '') || !isGuid(sourceDocumentId || '')
    || !Number.isSafeInteger(presentationEndMs) || presentationEndMs < 0
    || typeof sourceEtag !== 'string' || sourceEtag === '') throw new TypeError('invalid_presentation_video_identity');
  return sha256([POST_PRESENTATION_PRODUCER, requestId.toLowerCase(), PRESENTATION_VIDEO, FINGERPRINT_VERSION,
    transcriptRevisionId.toLowerCase(), presentationEndMs, sourceDocumentId.toLowerCase(), sourceEtag].join(':'));
}

/** Unique per split row, stable across retries of one approval. */
export function presentationVideoGenerationKey(splitId, requestId) {
  if (!isGuid(splitId || '') || !isGuid(requestId || '')) throw new TypeError('invalid_presentation_video_identity');
  return sha256(`${POST_PRESENTATION_PRODUCER}:${requestId.toLowerCase()}:${PRESENTATION_VIDEO}:split:${splitId.toLowerCase()}`);
}

/**
 * Given the per-type winners (all producers), decide whether the Presentation Video winner was cut from the
 * current transcript revision, boundary and Recording. Returns { video, candidate, boundary, reason } with reason
 * 'bound' | 'missing' | 'stale'. `video` is the bound row or null; `candidate` is the winner row, if any.
 */
export function bindPresentationVideo(winners, requestId) {
  const rows = Array.isArray(winners) ? winners : [];
  const candidate = rows.find(row => Number(row?.wmkf_artifacttype) === PRESENTATION_VIDEO
    && row.wmkf_producer === POST_PRESENTATION_PRODUCER && (!requestId || sameId(row._wmkf_request_value, requestId))) || null;
  if (!candidate) return { video: null, candidate: null, boundary: null, reason: 'missing' };
  const { boundary } = bindPresentationTranscript(rows, requestId);
  if (!boundary) return { video: null, candidate, boundary: null, reason: 'stale' };
  const recording = rows.find(row => Number(row?.wmkf_artifacttype) === RECORDING
    && (!requestId || sameId(row._wmkf_request_value, requestId))) || null;
  if (!recording || materialBacking(recording).kind !== 'file' || !recording.wmkf_sharepointetag) {
    return { video: null, candidate, boundary, reason: 'stale' };
  }
  let expected;
  try {
    expected = presentationVideoFingerprint({
      requestId: String(candidate._wmkf_request_value || requestId),
      transcriptRevisionId: boundary.revisionId, presentationEndMs: boundary.presentationEnd.endMs,
      sourceDocumentId: recording.wmkf_requestdocumentid, sourceEtag: recording.wmkf_sharepointetag,
    });
  } catch { return { video: null, candidate, boundary, reason: 'stale' }; }
  if (!candidate.wmkf_inputfingerprint || candidate.wmkf_inputfingerprint !== expected) {
    return { video: null, candidate, boundary, reason: 'stale' };
  }
  return { video: candidate, candidate, boundary, reason: 'bound' };
}
