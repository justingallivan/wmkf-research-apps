import { requireSuperuser } from '../../../../../../lib/utils/auth';
import { updateTranscriptionEvaluation } from '../../../../../../lib/services/transcription-pilot/store';
import { getOwnerJob, requirePilotEnabled, TranscriptionPilotError, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') { res.setHeader('Allow', 'PATCH'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    requirePilotEnabled();
    validateOwnerProfile(gate.profileId);
    const { expectedVersion, wordAccuracyScore, speakerAccuracyScore, correctionNotes } = req.body || {};
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TranscriptionPilotError('invalid_version');
    for (const score of [wordAccuracyScore, speakerAccuracyScore]) if (score !== undefined && score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) throw new TranscriptionPilotError('invalid_score');
    if (correctionNotes !== undefined && correctionNotes !== null && (typeof correctionNotes !== 'string' || correctionNotes.length > 4000)) throw new TranscriptionPilotError('invalid_correction_notes');
    const row = await updateTranscriptionEvaluation({
      jobId: req.query.id, ownerProfileId: gate.profileId, expectedVersion,
      wordAccuracyScore: wordAccuracyScore ?? null,
      speakerAccuracyScore: speakerAccuracyScore ?? null,
      correctionNotes: correctionNotes?.trim() || null,
    });
    if (!row) throw new TranscriptionPilotError('job_changed_or_not_evaluable', 409);
    return res.status(200).json({ job: await getOwnerJob({ ownerProfileId: gate.profileId, jobId: req.query.id }) });
  } catch (error) {
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/evaluation] request failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Evaluation save failed', code: 'transcription_internal_error' });
  }
}
