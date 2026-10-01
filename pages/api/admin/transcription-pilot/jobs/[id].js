import { requireSuperuser } from '../../../../../lib/utils/auth';
import { getOwnerJob, getOwnerJobContent, requirePilotEnabled, TranscriptionPilotError, validateOwnerProfile } from '../../../../../lib/services/transcription-pilot/runtime';
import { getOwnerTranscriptionJob, requestTranscriptionCleanup } from '../../../../../lib/services/transcription-pilot/store';

function errorResponse(res, error) {
  if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
  console.error('[transcription-pilot/job] request failed:', error?.code || error?.name || 'unknown');
  return res.status(500).json({ error: 'Transcription request failed', code: 'transcription_internal_error' });
}

export default async function handler(req, res) {
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  try {
    validateOwnerProfile(gate.profileId);
    res.setHeader('Cache-Control', 'private, no-store');
    requirePilotEnabled();
    const { id } = req.query;
    if (req.method === 'GET') {
      const job = await getOwnerJob({ ownerProfileId: gate.profileId, jobId: id });
      if (job.status === 'ready' && job.contentAccessAllowed) {
        const result = await getOwnerJobContent({ ownerProfileId: gate.profileId, jobId: id });
        return res.status(200).json({ job: result.job, transcript: result.content, processing_duration_ms: result.job.processing_duration_ms });
      }
      return res.status(200).json({ job, transcript: null });
    }
    if (req.method === 'DELETE') {
      const row = await getOwnerTranscriptionJob({ jobId: id, ownerProfileId: gate.profileId });
      if (!row) throw new TranscriptionPilotError('job_not_found', 404);
      const expectedVersion = req.body?.expectedVersion;
      if (expectedVersion != null && expectedVersion !== row.version) throw new TranscriptionPilotError('job_changed', 409);
      const updated = await requestTranscriptionCleanup({ jobId: id, ownerProfileId: gate.profileId, expectedVersion: expectedVersion ?? null });
      if (!updated) throw new TranscriptionPilotError('job_changed', 409);
      return res.status(202).json({ job: await getOwnerJob({ ownerProfileId: gate.profileId, jobId: id }), cleanupRequested: true });
    }
    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) { return errorResponse(res, error); }
}
