import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import {
  getZoomVideoCopies, startZoomVideoCopy, cancelZoomVideoCopy,
} from '../../../../../lib/services/meeting-tracker-recordings/video-copy-service.js';

// Lists, starts and cancels the Zoom meeting video copy into SharePoint (Stage 3b plan). Start only queues the copy
// (the every-minute cron moves the bytes), so this route is short.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 60 };
const START_KEYS = ['action', 'meetingUuid', 'replaces'];
const CANCEL_KEYS = ['action', 'copyId'];
const bareGuid = value => typeof value === 'string' && value === value.trim() && isGuid(value);
function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus ?? error?.status) || 500;
  const code = error?.code || 'zoom_video_copy_failed';
  if (status >= 500) console.error('[meeting tracker zoom video copy] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The video copy could not be completed.' : error.message, code });
}
function exactKeys(body, keys) {
  return Object.keys(body).length === keys.length && keys.every(key => Object.hasOwn(body, key));
}
function validReplaces(value) {
  return value === null || (value && typeof value === 'object' && !Array.isArray(value) && exactKeys(value, ['artifactId', 'slotVersion'])
    && bareGuid(value.artifactId) && Number.isSafeInteger(value.slotVersion) && value.slotVersion > 0);
}
// Returns the parsed command, or null when the body is not exactly a start or a cancel.
function parseBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.action === 'start' && exactKeys(body, START_KEYS) && typeof body.meetingUuid === 'string' && validReplaces(body.replaces)) {
    return { action: 'start', meetingUuid: body.meetingUuid, replaces: body.replaces };
  }
  if (body.action === 'cancel' && exactKeys(body, CANCEL_KEYS) && bareGuid(body.copyId)) return { action: 'cancel', copyId: body.copyId };
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
    if (Object.keys(req.query || {}).some(key => key !== 'requestId')) return res.status(400).json({ error: 'The video copy request contains unsupported parameters.' });
  } else {
    command = parseBody(req.body);
    if (!command) return res.status(400).json({ error: 'The video copy request contains unsupported fields.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-zoom-video-copies', async () => {
    try {
      if (!command) return res.status(200).json(await getZoomVideoCopies({ requestId }));
      const result = command.action === 'start'
        ? await startZoomVideoCopy({ requestId, actorProfileId: access.profileId, actingUserSystemId: actorRefFromSession(access.session),
          meetingUuid: command.meetingUuid, replaces: command.replaces })
        : await cancelZoomVideoCopy({ requestId, copyId: command.copyId });
      return res.status(result.status).json(result.body);
    } catch (error) { return errorResponse(res, error); }
  });
}
