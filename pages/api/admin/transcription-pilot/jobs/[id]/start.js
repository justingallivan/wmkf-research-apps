import { requireSuperuser } from '../../../../../../lib/utils/auth';
import { TranscriptionPilotError, validateAndQueueOwnerJob, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 120 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    validateOwnerProfile(gate.profileId);
    const job = await validateAndQueueOwnerJob({
      ownerProfileId: gate.profileId,
      jobId: req.query.id,
      expectedVersion: req.body?.expectedVersion,
      acknowledged: req.body?.acknowledgeNonSensitive,
    });
    return res.status(202).json({ job });
  } catch (error) {
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/start] request failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Transcription request failed', code: 'transcription_internal_error' });
  }
}
