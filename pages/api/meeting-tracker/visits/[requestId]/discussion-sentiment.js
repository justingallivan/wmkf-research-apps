import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import {
  analyzeDiscussionSentiment, getDiscussionSentimentStatus,
} from '../../../../../lib/services/post-presentation-materials/discussion-sentiment-service.js';

// POST runs the analysis synchronously, so the route allows the same 300 s as the summary draft.
export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 300 };

// The body carries nothing: the actor and the request come from the session and the path only.
const isEmptyBody = (body) => body === undefined || body === ''
  || (Boolean(body) && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0);

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  if (req.method === 'POST' && !isEmptyBody(req.body)) {
    return res.status(400).json({ error: 'The sentiment request is invalid.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-discussion-sentiment', async () => {
    try {
      if (req.method === 'GET') return res.status(200).json(await getDiscussionSentimentStatus({ requestId, ownerProfileId: access.profileId }));
      return res.status(200).json(await analyzeDiscussionSentiment({
        requestId, ownerProfileId: access.profileId, actingUserSystemId: actorRefFromSession(access.session),
      }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'discussion_sentiment_failed';
      if (status >= 500) console.error('[meeting tracker discussion sentiment] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The analysis could not be processed.' : error.message, code });
    }
  });
}
