import { requireAppAccess } from '../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error.js';
import { TranscriptionPilotError } from '../../../../../../../lib/services/transcription-pilot/runtime.js';
import { renameMeetingTranscriptionSpeakers } from '../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } }, maxDuration: 60 };
export default async function handler(req, res) {
  if (req.method !== 'PATCH') { res.setHeader('Allow','PATCH'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const jobId = Array.isArray(req.query.jobId) ? '' : String(req.query.jobId || '').trim();
  if (!isGuid(requestId) || !isGuid(jobId)) return res.status(400).json({ error: 'A valid request and job id are required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'expectedVersion,speakerNames' || !Number.isSafeInteger(body.expectedVersion)) {
    return res.status(400).json({ error: 'The speaker-label request is invalid.' });
  }
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcription-speakers', async () => {
    try { return res.status(200).json(await renameMeetingTranscriptionSpeakers({ requestId,
      ownerProfileId: access.profileId, jobId, body })); }
    catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : error instanceof TranscriptionPilotError ? error.status : Number(error?.httpStatus) || 500;
      const code = error?.code || 'meeting_transcription_speaker_update_failed';
      if (status >= 500) console.error('[meeting tracker transcription speakers] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'Speaker labels could not be saved.' : error.message, code });
    }
  });
}
