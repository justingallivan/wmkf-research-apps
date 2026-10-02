import { requireAppAccess } from '../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error.js';
import { TranscriptionPilotError } from '../../../../../../lib/services/transcription-pilot/runtime.js';
import { readMeetingTranscriptionJob, renameMeetingTranscriptionSpeakers, removeMeetingTranscriptionJob } from '../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } }, maxDuration: 60 };
const PATCH_KEYS = new Set(['expectedVersion','speakerNames']);
function fail(res, error) {
  const status = error instanceof ServiceHttpError ? error.httpStatus : error instanceof TranscriptionPilotError ? error.status : Number(error?.httpStatus) || 500;
  const code = error?.code || 'meeting_transcription_failed';
  if (status >= 500) console.error('[meeting tracker transcription job] failed:', code);
  return res.status(status).json(error?.body || { error: status >= 500 ? 'The transcript request could not be processed.' : error.message, code });
}
export default async function handler(req, res) {
  if (!['GET','PATCH','DELETE'].includes(req.method)) { res.setHeader('Allow','GET, PATCH, DELETE'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const jobId = Array.isArray(req.query.jobId) ? '' : String(req.query.jobId || '').trim();
  if (!isGuid(requestId) || !isGuid(jobId)) return res.status(400).json({ error: 'A valid request and job id are required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  if (req.method === 'PATCH' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some(key => !PATCH_KEYS.has(key)) || Object.keys(req.body).length !== 2
    || !Number.isSafeInteger(req.body.expectedVersion))) return res.status(400).json({ error: 'The speaker-label request is invalid.' });
  if (req.method === 'DELETE' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).length !== 1 || !Number.isSafeInteger(req.body.expectedVersion))) return res.status(400).json({ error: 'The transcript deletion request is invalid.' });
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-transcription-job', async () => {
    try {
      if (req.method === 'GET') return res.status(200).json(await readMeetingTranscriptionJob({ requestId, jobId }));
      if (req.method === 'PATCH') return res.status(200).json(await renameMeetingTranscriptionSpeakers({ requestId, ownerProfileId: access.profileId, jobId, body: req.body }));
      return res.status(200).json(await removeMeetingTranscriptionJob({ requestId, ownerProfileId: access.profileId, jobId, body: req.body }));
    } catch (error) { return fail(res, error); }
  });
}
