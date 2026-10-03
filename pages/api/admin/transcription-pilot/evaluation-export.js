import { requireSuperuser } from '../../../../lib/utils/auth';
import { listOwnerJobs, TranscriptionPilotError, validateOwnerProfile } from '../../../../lib/services/transcription-pilot/runtime';

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  try {
    validateOwnerProfile(gate.profileId);
    const jobs = await listOwnerJobs({ ownerProfileId: gate.profileId, limit: 100 });
    const rows = jobs.filter(job => job.receipt_expires_at && new Date(job.receipt_expires_at) > new Date());
    const scoredWords = rows.filter(job => Number.isInteger(job.word_accuracy_score));
    const scoredSpeakers = rows.filter(job => Number.isInteger(job.speaker_accuracy_score));
    const durations = rows.map(job => Number(job.audio_duration_ms)).filter(Number.isFinite);
    const mean = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : '';
    const csv = [
      ['exported_at', 'evaluated_jobs', 'mean_audio_duration_ms', 'word_score_count', 'mean_word_accuracy_score', 'speaker_score_count', 'mean_speaker_accuracy_score', 'requested_models', 'returned_models'],
      [new Date().toISOString(), rows.length, mean(durations), scoredWords.length, mean(scoredWords.map(job => job.word_accuracy_score)), scoredSpeakers.length, mean(scoredSpeakers.map(job => job.speaker_accuracy_score)), [...new Set(rows.map(job => job.requested_model).filter(Boolean))].join(';'), [...new Set(rows.map(job => job.returned_model).filter(Boolean))].join(';')],
    ].map(row => row.map(csvCell).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transcription-evaluation-receipts.csv"');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(`${csv}\r\n`);
  } catch (error) {
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/export] failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Evaluation export failed', code: 'transcription_internal_error' });
  }
}
