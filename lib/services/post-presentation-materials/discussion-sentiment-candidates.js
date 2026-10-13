/**
 * Picker candidates for the Discussion Sentiment page: the requests of one cycle whose Staff Discussion
 * Transcript is currently bound, with the same binding the analysis uses. Two cycle-wide queries replace a
 * per-proposal read. The rows are grouped by request and each group goes through `bindCurrent` itself (a
 * `findDocuments` that returns that request's rows), so "bound" is literally the analysis's own rule:
 * a confirmed boundary, a current TRANSCRIPT winner, and a discussion row whose generation key matches
 * them. A stale or missing discussion TXT is therefore not a candidate.
 *
 * Only TRANSCRIPT and STAFF_DISCUSSION_TRANSCRIPT are fetched: `bindStaffDiscussionTranscript` reads only
 * those two winners, and `projectPostPresentationMaterials` picks each type's winner independently, so the
 * other types `bindCurrent` projects cannot change `discussion.reason`.
 *
 * Returns request ids only. `capped` is true when either query hit the export record cap, so the list may
 * be incomplete; the caller must say so rather than present it as complete.
 */
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../../shared/config/requestDocument.js';
import { parseCycleCode } from '../../utils/cycle-code.js';
import { materialError } from './material-service.js';
import {
  TRANSCRIPT_SUMMARY_DEPENDENCIES, bindCurrent,
} from './transcript-summary-service.js';
import { assertSentimentEnabled } from './discussion-sentiment-service.js';

const TYPES = Object.freeze([
  REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE.STAFF_DISCUSSION_TRANSCRIPT,
]);

export const DISCUSSION_SENTIMENT_CANDIDATE_DEPENDENCIES = Object.freeze({
  ...TRANSCRIPT_SUMMARY_DEPENDENCIES,
  findDocumentsByCycle: (cycleCode, artifactType) => requestDocumentAdapter.findByCycle(
    cycleCode, { artifactType, includeMeetingTranscriptBundle: true }),
});

// Request-scoped "not available" refusals exclude that request; anything else (schema not ready, supervised test) is a real failure.
const REQUEST_SCOPED = new Set(['meeting_transcription_disabled', 'post_presentation_not_available']);

export async function listDiscussionSentimentCandidates({ cycleCode, ownerProfileId }, dependencies = DISCUSSION_SENTIMENT_CANDIDATE_DEPENDENCIES) {
  const parsed = typeof cycleCode === 'string' ? parseCycleCode(cycleCode) : null;
  if (!parsed) throw materialError('Choose a valid grant cycle.', 'sentiment_cycle_invalid', 400);
  const code = cycleCode.trim().toUpperCase();
  const pages = await Promise.all(TYPES.map((type) => dependencies.findDocumentsByCycle(code, type)));
  const capped = pages.some((page) => page?.capped === true);
  const byRequest = new Map();
  for (const row of pages.flatMap((page) => page?.records || [])) {
    const id = String(row?._wmkf_request_value || '').toLowerCase();
    if (!id) continue;
    if (!byRequest.has(id)) byRequest.set(id, []);
    byRequest.get(id).push(row);
  }
  const requestIds = [];
  for (const [requestId, rows] of byRequest) {
    try {
      assertSentimentEnabled(requestId, ownerProfileId, null, dependencies, { needsActor: false });
    } catch (error) {
      if (REQUEST_SCOPED.has(error?.code)) continue;
      throw error;
    }
    const bound = await bindCurrent(requestId, { findDocuments: async () => ({ records: rows }) });
    if (bound.discussion?.reason === 'bound') requestIds.push(requestId);
  }
  return { requestIds: requestIds.sort(), capped };
}
