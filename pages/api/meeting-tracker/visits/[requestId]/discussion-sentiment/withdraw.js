import { requireAppAccess } from '../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error.js';
import { withdrawDiscussionSentiment } from '../../../../../../lib/services/post-presentation-materials/discussion-sentiment-service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 60 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'runId'
    || typeof body.runId !== 'string' || !isGuid(body.runId)) {
    return res.status(400).json({ error: 'The sentiment withdraw request is invalid.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-discussion-sentiment-withdraw', async () => {
    try {
      return res.status(200).json(await withdrawDiscussionSentiment({ requestId, ownerProfileId: access.profileId, runId: body.runId }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'discussion_sentiment_withdraw_failed';
      if (status >= 500) console.error('[meeting tracker discussion sentiment withdraw] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The withdrawal could not be saved.' : error.message, code });
    }
  });
}
