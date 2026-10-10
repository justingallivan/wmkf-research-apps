import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import {
  getPresentationVideoSplits, startPresentationVideoSplit,
} from '../../../../../lib/services/meeting-tracker-recordings/presentation-video-split-service.js';
import { approvePresentationVideoSplit } from '../../../../../lib/services/meeting-tracker-recordings/presentation-video-approval-service.js';

// Lists, starts and approves the Stage 4 presentation-video split. Start only queues the cut (the slice 3 cron does the
// work). Approve registers the reviewed cut under the slot fence (Graph + Dataverse), so it gets the summary publish budget.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 120 };
function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus ?? error?.status) || 500;
  const code = error?.code || 'presentation_video_split_failed';
  if (status >= 500) console.error('[meeting tracker presentation video split] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The presentation video could not be started.' : error.message, code });
}
function exactKeys(body, keys) {
  return Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
}
// Returns the parsed command, or null when the body is not exactly a start or an approve.
function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.action === 'start' && exactKeys(body, ['action'])) return { action: 'start' };
  if (body.action === 'approve' && exactKeys(body, ['action', 'splitId']) && typeof body.splitId === 'string' && body.splitId === body.splitId.trim() && isGuid(body.splitId)) {
    return { action: 'approve', splitId: body.splitId };
  }
  return null;
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
      const actor = { requestId, actorProfileId: access.profileId, actingUserSystemId: actorRefFromSession(access.session) };
      const result = command.action === 'approve'
        ? await approvePresentationVideoSplit({ ...actor, splitId: command.splitId })
        : await startPresentationVideoSplit(actor);
      return res.status(result.status).json(result.body);
    } catch (error) { return errorResponse(res, error); }
  });
}
