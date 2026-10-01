import { requireSuperuser } from '../../../../../../lib/utils/auth';
import { getOwnerJobContent, TranscriptionPilotError, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';
import { formatTranscriptText, formatTranscriptVtt } from '../../../../../../lib/services/transcription-pilot/transcript-format';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    validateOwnerProfile(gate.profileId);
    const format = req.query.format === 'vtt' ? 'vtt' : req.query.format === 'txt' ? 'txt' : null;
    if (!format) return res.status(400).json({ error: 'format must be txt or vtt', code: 'invalid_format' });
    const { job, content } = await getOwnerJobContent({ ownerProfileId: gate.profileId, jobId: req.query.id });
    const speakerNames = job.speaker_names || {};
    const text = format === 'vtt'
      ? formatTranscriptVtt(content, speakerNames)
      : formatTranscriptText(content, speakerNames);
    res.setHeader('Content-Type', format === 'vtt' ? 'text/vtt; charset=utf-8' : 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${job.id}.${format}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(text);
  } catch (error) {
    if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('[transcription-pilot/download] request failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Transcript download failed', code: 'transcription_internal_error' });
  }
}
