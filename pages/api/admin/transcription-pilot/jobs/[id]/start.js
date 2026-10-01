import { requireSuperuser } from '../../../../../../lib/utils/auth';
import { TranscriptionWorkflowDispatchError, dispatchQueuedTranscriptionWorkflow } from '../../../../../../lib/services/transcription-pilot/workflow-dispatch';
import { getOwnerTranscriptionJob } from '../../../../../../lib/services/transcription-pilot/store';
import { projectReadableOwnerJob, requireSubmissionsEnabled, TranscriptionPilotError, validateAndQueueOwnerJob, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    validateOwnerProfile(gate.profileId);
    requireSubmissionsEnabled();
    const existing = await getOwnerTranscriptionJob({ jobId: req.query.id, ownerProfileId: gate.profileId });
    if (!existing) throw new TranscriptionPilotError('job_not_found', 404);
    let job;
    let manual = false;
    if (existing.status === 'uploading') {
      job = await validateAndQueueOwnerJob({ ownerProfileId: gate.profileId, jobId: req.query.id,
        expectedVersion: req.body?.expectedVersion, acknowledged: req.body?.acknowledgeNonSensitive });
    } else if (existing.status === 'queued' && existing.version === req.body?.expectedVersion
      && req.body?.acknowledgeNonSensitive === true && existing.non_sensitive_acknowledged_at) {
      job = projectReadableOwnerJob(existing);
      manual = true;
    } else if (existing.status === 'queued' && existing.version !== req.body?.expectedVersion) {
      throw new TranscriptionPilotError('job_changed', 409);
    } else {
      throw new TranscriptionPilotError('job_changed', 409);
    }
    try {
      await dispatchQueuedTranscriptionWorkflow({ jobId: req.query.id, ownerProfileId: gate.profileId, manual });
    } catch (error) {
      if (error instanceof TranscriptionWorkflowDispatchError) {
        return res.status(error.status).json({ error: error.message, code: error.code, retryable: true, job });
      }
      throw error;
    }
    return res.status(202).json({ job });
  } catch (error) {
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/start] request failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Transcription request failed', code: 'transcription_internal_error' });
  }
}
