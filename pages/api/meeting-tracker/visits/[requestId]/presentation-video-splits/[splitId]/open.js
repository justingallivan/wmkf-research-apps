import { requireAppAccess } from '../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error.js';
import { resolvePresentationVideoSplitOpen } from '../../../../../../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js';

// Staff review open for the Stage 4 presentation video: 302 to a fresh download URL for the split's output, which has
// no Dataverse row until it is approved. The service rechecks the recorded item id and eTag against the live item.
export const config = { maxDuration: 30 };

function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus ?? error?.status) || 500;
  const code = error?.code || 'presentation_video_open_failed';
  if (status >= 500) console.error('[meeting tracker presentation video open] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The presentation video could not be opened.' : error.message, code });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const one = value => (Array.isArray(value) ? '' : String(value || '').trim());
  const requestId = one(req.query.requestId);
  const splitId = one(req.query.splitId);
  if (!isGuid(requestId) || !isGuid(splitId)) return res.status(400).json({ error: 'A valid request id and presentation video id are required.' });
  if (Object.keys(req.query || {}).some(key => key !== 'requestId' && key !== 'splitId')) {
    return res.status(400).json({ error: 'The presentation video request contains unsupported parameters.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return withDalContext('meeting-tracker-presentation-video-open', async () => {
    try {
      const media = await resolvePresentationVideoSplitOpen({ requestId, splitId });
      return res.redirect(302, media.redirectUrl);
    } catch (error) { return errorResponse(res, error); }
  });
}
