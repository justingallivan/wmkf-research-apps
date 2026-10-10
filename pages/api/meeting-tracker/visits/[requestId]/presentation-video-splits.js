import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import {
  getPresentationVideoSplits, startPresentationVideoSplit,
} from '../../../../../lib/services/meeting-tracker-recordings/presentation-video-split-service.js';

// Lists and starts the Stage 4 presentation-video split. Start only queues the cut (the slice 3 cron does the work),
// so this route is short.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 60 };
function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus ?? error?.status) || 500;
  const code = error?.code || 'presentation_video_split_failed';
  if (status >= 500) console.error('[meeting tracker presentation video split] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The presentation video could not be started.' : error.message, code });
}
function exactKeys(body, keys) {
  return Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
}
// Returns the parsed command, or null when the body is not exactly a start.
function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body.action === 'start' && exactKeys(body, ['action']) ? { action: 'start' } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  let command = null;
  if (req.method === 'GET') {
    if (Object.keys(req.query || {}).some(key => key !== 'requestId')) return res.status(400).json({ error: 'The presentation video request contains unsupported parameters.' });
  } else {
    command = parseBody(req.body);
    if (!command) return res.status(400).json({ error: 'The presentation video request contains unsupported fields.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-presentation-video-splits', async () => {
    try {
      if (!command) return res.status(200).json(await getPresentationVideoSplits({ requestId }));
      const result = await startPresentationVideoSplit({ requestId, actorProfileId: access.profileId, actingUserSystemId: actorRefFromSession(access.session) });
      return res.status(result.status).json(result.body);
    } catch (error) { return errorResponse(res, error); }
  });
}
