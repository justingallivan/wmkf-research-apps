import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import { TranscriptionPilotError } from '../../../../../lib/services/transcription-pilot/runtime.js';
import { getMeetingTranscriptionOverview, uploadMeetingTranscription } from '../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 60 };
const CREATE_KEYS = new Set(['filename','contentType','bytes','idempotencyKey','providerRegion']);
function errorResponse(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : error instanceof TranscriptionPilotError ? error.status : Number(error?.httpStatus) || 500;
  const code = error?.code || 'meeting_transcription_failed';
  if (status >= 500) console.error('[meeting tracker transcription] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The transcript request could not be processed.' : error.message, code });
}
function exactCreate(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every(key => CREATE_KEYS.has(key))
    && Object.keys(body).length === CREATE_KEYS.size;
}

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  if (req.method === 'POST' && !exactCreate(req.body)) return res.status(400).json({ error: 'The transcript upload request contains unsupported fields.' });
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-transcription', async () => {
    try {
      if (req.method === 'GET') return res.status(200).json(await getMeetingTranscriptionOverview({ requestId, ownerProfileId: access.profileId }));
      return res.status(201).json(await uploadMeetingTranscription({ requestId, ownerProfileId: access.profileId, body: req.body }));
    } catch (error) { return errorResponse(res, error); }
  });
}
