/**
 * Read contract for other apps (plan §4.6): the accepted, not withdrawn, current staff discussion
 * sentiment per request. Returns a `sentiment` only for the single accepted, not withdrawn, current
 * row; an unaccepted, withdrawn or out-of-date row never reaches a consumer. No app consumes this yet.
 *
 * Fails closed unless the caller's profile is active and holds the Meeting Tracker grant (or is a
 * superuser), checked live from the same sources as `requireAppAccess` (fresh is_active and superuser
 * read, then the `listAppKeysForUser` grant lookup; same shape as `assertReviewPanelAccess`). Unlike the
 * route guard, any lookup failure returns 403 rather than a retryable 503. A consumer app's own grant is
 * not enough.
 *
 * One request never fails the batch: a request the feature is not available for (transcription disabled,
 * schema not ready, request not allowed, any other 4xx or the known not-available 503 codes) reads as
 * `none`. Only genuine infrastructure failures throw. If the sentiment prompt is unseeded or duplicated,
 * no row can be shown as current: an accepted row reads `out_of_date`, otherwise `none`, always with
 * `sentiment: null`.
 * The caller passes the authenticated profile in `accessContext.profileId`; nothing else in the context
 * is trusted. Run inside the caller's `withDalContext`.
 */
import { isGuid } from '../../utils/guid.js';
import { sql } from '@vercel/postgres';
import { listAppKeysForUser } from '../app-access-service.js';
import { withDalContext } from '../../dataverse/core/context.js';
import { ServiceHttpError } from '../service-http-error.js';
import { materialError } from './material-service.js';
import { bindCurrent } from './transcript-summary-service.js';
import {
  DISCUSSION_SENTIMENT_DEPENDENCIES, isRunCurrent, currentSourceOf, loadPromptVersion, assertSentimentEnabled,
} from './discussion-sentiment-service.js';

export const DELIBERATION_SENTIMENT_MAX_REQUESTS = 50;
const APP_KEY = 'meeting-tracker';

/** Meeting Tracker readership: an active profile with the app grant or the superuser role. Any failure means no access. */
export async function hasMeetingTrackerAccess(profileId) {
  if (!Number.isSafeInteger(profileId) || profileId < 1) return false;
  try {
    const result = await sql`
      SELECT p.is_active,
             EXISTS (SELECT 1 FROM dynamics_user_roles r WHERE r.user_profile_id = p.id AND r.role = 'superuser') AS is_superuser
        FROM user_profiles p WHERE p.id = ${profileId}`;
    const profile = result.rows[0];
    if (!profile || profile.is_active !== true) return false;
    if (profile.is_superuser === true) return true;
    const keys = await withDalContext('deliberation-sentiment-read-access', () => listAppKeysForUser(profileId, { throwOnError: true }));
    return Array.isArray(keys) && keys.includes(APP_KEY);
  } catch {
    return false;
  }
}

// Per-request "not available" conditions that are not ServiceHttpErrors or are 503s (policy.js throws a plain Error).
const NOT_AVAILABLE_CODES = new Set([
  'meeting_transcription_disabled', 'post_presentation_not_available', 'post_presentation_schema_not_ready',
  'meeting_transcript_bundle_schema_not_ready', 'meeting_transcription_supervised_test_unsupported',
]);
const isNotAvailable = (error) => NOT_AVAILABLE_CODES.has(error?.code)
  || (error instanceof ServiceHttpError && error.httpStatus >= 400 && error.httpStatus < 500);

const NONE = Object.freeze({ status: 'none', analyzedAt: null, promptVersion: null, sentiment: null });

export async function getDeliberationSentiments(requestIds, accessContext, dependencies = {
  ...DISCUSSION_SENTIMENT_DEPENDENCIES, hasMeetingTrackerAccess,
}) {
  if (!await dependencies.hasMeetingTrackerAccess(accessContext?.profileId)) {
    throw materialError('Meeting Tracker access is required.', 'sentiment_read_forbidden', 403);
  }
  if (!Array.isArray(requestIds) || requestIds.length > DELIBERATION_SENTIMENT_MAX_REQUESTS
    || !requestIds.every((id) => typeof id === 'string' && isGuid(id))) {
    throw materialError(`Provide up to ${DELIBERATION_SENTIMENT_MAX_REQUESTS} valid request ids.`, 'sentiment_read_invalid_request_ids', 400);
  }
  const unique = [...new Set(requestIds.map((id) => id.toLowerCase()))];
  let promptVersion = null;
  if (unique.length) {
    try {
      promptVersion = await loadPromptVersion(dependencies);
    } catch (error) {
      // An unseeded or duplicate prompt means nothing is current; it is not a batch failure.
      if (error?.code !== 'sentiment_prompt_not_ready') throw error;
    }
  }
  const result = {};
  for (const requestId of unique) {
    try {
      assertSentimentEnabled(requestId, accessContext.profileId, null, dependencies, { needsActor: false });
      const binding = await dependencies.loadBinding(requestId);
      const row = await dependencies.sentiments.getAcceptedRun({ requestId: binding.requestId });
      // Re-checked here, not only in the store query: a consumer must never see anything else.
      if (!row || row.status !== 'ready' || !row.accepted_at || row.withdrawn_at) { result[requestId] = NONE; continue; }
      const bound = await bindCurrent(binding.requestId, dependencies);
      const current = isRunCurrent(row, currentSourceOf(bound, promptVersion));
      result[requestId] = {
        status: current ? 'current' : 'out_of_date',
        analyzedAt: row.completed_at,
        promptVersion: Number(row.prompt_version),
        sentiment: current ? row.record : null,
      };
    } catch (error) {
      // A request the feature is not available for has no sentiment; anything else is a real failure.
      if (!isNotAvailable(error)) throw error;
      result[requestId] = NONE;
    }
  }
  return result;
}
