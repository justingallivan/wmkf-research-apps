import { verifyTranscriptionCronSecret } from '../../../lib/utils/cron-auth';
import { drainTranscriptionPilot } from '../../../lib/services/transcription-pilot/worker';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!verifyTranscriptionCronSecret(req, res)) return;
  try {
    const summary = await drainTranscriptionPilot({ maxJobs: 4 });
    return res.status(200).json({ ok: true, summary });
  } catch (error) {
    console.error('[transcription-pilot/cron] worker failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Transcription worker failed', code: 'transcription_worker_failed' });
  }
}
