import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import { TranscriptionPilotError } from '../../../../../lib/services/transcription-pilot/runtime.js';
import { listZoomRecordingsForVisit } from '../../../../../lib/services/meeting-tracker-recordings/import-service.js';

// Lists the approved Zoom hosts' recent recordings for the import picker (Stage 3a plan). Read-only.
export const config = { maxDuration: 60 };
function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : error instanceof TranscriptionPilotError ? error.status : Number(error?.httpStatus) || 500;
  const code = error?.code || 'zoom_recordings_failed';
  if (status >= 500) console.error('[meeting tracker zoom recordings] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The Zoom recordings could not be listed.' : error.message, code });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const query = req.query || {};
  if (Object.keys(query).some(key => key !== 'requestId' && key !== 'days') || Array.isArray(query.days)) {
    return res.status(400).json({ error: 'The Zoom recordings request contains unsupported parameters.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-zoom-recordings', async () => {
    try {
      return res.status(200).json(await listZoomRecordingsForVisit({ requestId, days: query.days }));
    } catch (error) { return errorResponse(res, error); }
  });
}
