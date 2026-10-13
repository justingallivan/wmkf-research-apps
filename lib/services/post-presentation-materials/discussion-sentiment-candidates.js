/**
 * Picker candidates for the Discussion Sentiment page: the requests of one cycle whose Staff Discussion
 * Transcript is currently bound, with the same binding the analysis uses.
 *
 * Membership comes from the request, not from the documents: the cycle's request ids are the ones the
 * Meeting Tracker schedule already lists (`loadMeetingTrackerSelection`, the source of
 * `/api/meeting-tracker/dashboard?projection=schedule&scope=all`), resolved on the server. A document's
 * `wmkf_cyclecode` is a snapshot taken when it was published, so a request that changed cycle between
 * its TRANSCRIPT and its discussion TXT carries two codes; filtering documents by cycle would drop one and
 * silently exclude the request. So the documents are loaded by request id, across all document cycles
 * (`findByRequests`), grouped by request, and each group goes through `bindCurrent` itself (a
 * `findDocuments` that returns that request's rows): "bound" is literally the analysis's own rule.
 *
 * Only TRANSCRIPT and STAFF_DISCUSSION_TRANSCRIPT are fetched: `bindStaffDiscussionTranscript` reads only
 * those two winners, and `projectPostPresentationMaterials` picks each type's winner independently, so the
 * other types `bindCurrent` projects cannot change `discussion.reason`.
 *
 * Returns request ids only. `capped` is true when a document query hit the export cap, so the list may be
 * incomplete; the caller must say so. The request listing itself does not expose a cap (the dashboard has
 * the same limit).
 */
import * as requestDocumentAdapter from '../../dataverse/adapters/request-document.js';
import { loadMeetingTrackerSelection } from '../workbench/dashboard-service.js';
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
  loadCycleRequests: loadMeetingTrackerSelection,
  findDocumentsByRequests: (requestIds, artifactType) => requestDocumentAdapter.findByRequests(
    requestIds, { artifactType, includeMeetingTranscriptBundle: true }),
});

// Request-scoped "not available" refusals exclude that request; anything else (schema not ready, supervised test) is a real failure.
const REQUEST_SCOPED = new Set(['meeting_transcription_disabled', 'post_presentation_not_available']);

/** `caller` is the dashboard's own argument set from the session: { azureEmail, profileId, callerSystemId, programId }. */
export async function listDiscussionSentimentCandidates({ cycleCode, ownerProfileId, caller = {} }, dependencies = DISCUSSION_SENTIMENT_CANDIDATE_DEPENDENCIES) {
  const parsed = typeof cycleCode === 'string' ? parseCycleCode(cycleCode) : null;
  if (!parsed) throw materialError('Choose a valid grant cycle.', 'sentiment_cycle_invalid', 400);
  const code = cycleCode.trim().toUpperCase();
  const listing = await dependencies.loadCycleRequests({
    azureEmail: caller.azureEmail, profileId: caller.profileId, callerSystemId: caller.callerSystemId,
    programId: caller.programId, cycleCode: code, scope: 'all', includeSetAside: false,
  });
  const cycleRequestIds = [...new Set((listing?.proposals || []).map((row) => String(row?.requestId || '').toLowerCase()).filter(Boolean))];
  if (!cycleRequestIds.length) return { requestIds: [], capped: false };
  const pages = await Promise.all(TYPES.map((type) => dependencies.findDocumentsByRequests(cycleRequestIds, type)));
  const capped = pages.some((page) => page?.capped === true || page?.hasMore === true);
  const byRequest = new Map(cycleRequestIds.map((id) => [id, []]));
  for (const row of pages.flatMap((page) => page?.records || [])) {
    const id = String(row?._wmkf_request_value || '').toLowerCase();
    if (byRequest.has(id)) byRequest.get(id).push(row);
  }
  const requestIds = [];
  for (const [requestId, rows] of byRequest) {
    if (!rows.length) continue;
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
