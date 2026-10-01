import { verifyAssemblyAIWebhook } from '../../../lib/services/transcription-pilot/crypto';
import { recordTranscriptionCallbackCandidate } from '../../../lib/services/transcription-pilot/store';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  const correlationId = typeof req.query.attempt === 'string' ? req.query.attempt : '';
  const signature = req.headers['x-transcription-pilot-auth'];
  if (!verifyAssemblyAIWebhook(correlationId, signature)) return res.status(401).end();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const providerTranscriptId = body.transcript_id ?? body.id;
  if (typeof providerTranscriptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(providerTranscriptId)) return res.status(400).end();
  try {
    const result = await recordTranscriptionCallbackCandidate({ attemptCorrelationId: correlationId, providerTranscriptId });
    // An authenticated, expired/unknown correlator is intentionally acknowledged;
    // callbacks contain no content and cannot create or publish a job.
    return res.status(200).json({ received: true, recorded: result.recorded === true });
  } catch (error) {
    console.error('[assemblyai-webhook] callback persistence failed:', error?.code || error?.name || 'unknown');
    return res.status(503).end();
  }
}
