import { verifyTranscriptionCronSecret } from '../../../lib/utils/cron-auth';
import { runTranscriptionPreflight } from '../../../lib/services/transcription-pilot/preflight';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!verifyTranscriptionCronSecret(req, res)) return;
  const hasPreflightParameter = req.query && Object.prototype.hasOwnProperty.call(req.query, 'preflight');
  if (hasPreflightParameter && req.query.preflight !== '1') {
    return res.status(400).json({ error: 'Invalid preflight request' });
  }
  const preflightRequested = req.query?.preflight === '1';
  if (preflightRequested) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
    const result = await runTranscriptionPreflight();
    return res.status(result.ok ? 200 : 503).json(result);
  }
  try {
    const { drainTranscriptionPilot } = await import('../../../lib/services/transcription-pilot/worker');
    const summary = await drainTranscriptionPilot({ maxJobs: 4 });
    return res.status(200).json({ ok: true, summary });
  } catch (error) {
    console.error('[transcription-pilot/cron] worker failed:', error?.code || error?.name || 'unknown');
    return res.status(500).json({ error: 'Transcription worker failed', code: 'transcription_worker_failed' });
  }
}
