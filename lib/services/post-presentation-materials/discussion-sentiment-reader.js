/**
 * Read contract for other apps (plan §4.6): the accepted, not withdrawn, current staff discussion
 * sentiment per request. Returns a `sentiment` only for the single accepted, not withdrawn, current
 * row; an unaccepted, withdrawn or out-of-date row never reaches a consumer. No app consumes this yet.
 *
 * Fails closed unless the caller's profile is active and holds the Meeting Tracker grant (or is a
 * superuser), checked live the way `requireAppAccess` does (fresh is_active and superuser read, then the
 * `listAppKeysForUser` grant lookup; same shape as `assertReviewPanelAccess`). A consumer app's own grant
 * is not enough.
 * The caller passes the authenticated profile in `accessContext.profileId`; nothing else in the context
 * is trusted. Run inside the caller's `withDalContext`.
 */
import { isGuid } from '../../utils/guid.js';
import { sql } from '@vercel/postgres';
import { listAppKeysForUser } from '../app-access-service.js';
import { withDalContext } from '../../dataverse/core/context.js';
import { ServiceHttpError } from '../service-http-error.js';
import { materialError } from './material-service.js';
import { assertEnabled, bindCurrent } from './transcript-summary-service.js';
import {
  DISCUSSION_SENTIMENT_DEPENDENCIES, isRunCurrent, currentSourceOf, loadPromptVersion,
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
  const promptVersion = unique.length ? await loadPromptVersion(dependencies) : null;
  const result = {};
  for (const requestId of unique) {
    try {
      assertEnabled(requestId, accessContext.profileId, null, dependencies, { needsActor: false });
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
      // A request the feature is not enabled for has no sentiment; anything else is a real failure.
      if (!(error instanceof ServiceHttpError) || error.httpStatus >= 500) throw error;
      result[requestId] = NONE;
    }
  }
  return result;
}
