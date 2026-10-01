import { requireSuperuser } from '../../../../../../lib/utils/auth';
import { abandonUncertainTranscriptionJob } from '../../../../../../lib/services/transcription-pilot/store';
import { getOwnerJob, requirePilotEnabled, TranscriptionPilotError, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    requirePilotEnabled();
    validateOwnerProfile(gate.profileId);
    if (req.body?.acknowledgePotentialDuplicateCharge !== true) throw new TranscriptionPilotError('abandonment_acknowledgement_required', 400);
    if (!Number.isInteger(req.body?.expectedVersion) || req.body.expectedVersion < 1) throw new TranscriptionPilotError('invalid_version', 400);
    const row = await abandonUncertainTranscriptionJob({
      jobId: req.query.id, ownerProfileId: gate.profileId,
      expectedVersion: req.body.expectedVersion, acknowledged: true,
    });
    if (!row) throw new TranscriptionPilotError('job_changed_or_busy', 409);
    return res.status(200).json({ job: await getOwnerJob({ ownerProfileId: gate.profileId, jobId: req.query.id }) });
  } catch (error) {
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/abandon] failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Abandonment failed', code: 'transcription_internal_error' });
  }
}
