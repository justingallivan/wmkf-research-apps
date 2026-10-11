import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import { TranscriptionPilotError } from '../../../../../lib/services/transcription-pilot/runtime.js';
import { importZoomRecording } from '../../../../../lib/services/meeting-tracker-recordings/import-service.js';

// Imports one approved-host Zoom meeting into Meeting Tracker transcription (Stage 3a plan). The
// download, Blob write and transcription start run in this request, so it needs the full 300 s.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 300 };
const BODY_KEYS = ['meetingUuid', 'nonSensitiveAcknowledged'];
function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : error instanceof TranscriptionPilotError ? error.status : Number(error?.httpStatus ?? error?.status) || 500;
  const code = error?.code || 'zoom_import_failed';
  if (status >= 500) console.error('[meeting tracker zoom import] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The Zoom import could not be completed.' : error.message, code });
}
function exactBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === BODY_KEYS.length && BODY_KEYS.every(key => Object.hasOwn(body, key));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  if (!exactBody(req.body)) return res.status(400).json({ error: 'The Zoom import request contains unsupported fields.' });
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-zoom-import', async () => {
    try {
      return res.status(200).json(await importZoomRecording({
        requestId, ownerProfileId: access.profileId, actingUserSystemId: actorRefFromSession(access.session),
        meetingUuid: req.body.meetingUuid, acknowledged: req.body.nonSensitiveAcknowledged,
      }));
    } catch (error) { return errorResponse(res, error); }
  });
}
