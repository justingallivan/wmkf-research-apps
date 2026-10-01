import { requireSuperuser } from '../../../../../../lib/utils/auth';
import { getOwnerJobContent, TranscriptionPilotError, validateOwnerProfile } from '../../../../../../lib/services/transcription-pilot/runtime';

function vttTime(milliseconds) {
  const ms = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const remainder = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
}

function toVtt(transcript) {
  const cues = (transcript.utterances || []).map((utterance) => {
    const speaker = utterance.speaker ? `Speaker ${String(utterance.speaker).replace(/[^A-Za-z0-9_-]/g, '')}: ` : '';
    const text = String(utterance.text || '').replace(/-->/g, '—>').replace(/[\r\n]+/g, ' ').trim();
    return `${vttTime(utterance.start)} --> ${vttTime(utterance.end)}\n${speaker}${text}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

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
    const text = format === 'vtt' ? toVtt(content) : `${String(content.text || '').trim()}\n`;
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
