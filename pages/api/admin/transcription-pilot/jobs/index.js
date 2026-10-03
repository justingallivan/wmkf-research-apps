import { requireSuperuser } from '../../../../../lib/utils/auth';
import { createOwnerUpload, listOwnerJobs, TranscriptionPilotError, validateOwnerProfile } from '../../../../../lib/services/transcription-pilot/runtime';

function sendError(res, error) {
  if (error instanceof TranscriptionPilotError) return res.status(error.status).json({ error: error.message, code: error.code });
  if (error?.code?.startsWith('transcription_')) return res.status(error.httpStatus || 409).json({ error: error.message, code: error.code });
  console.error('[transcription-pilot/jobs] request failed:', error?.code || error?.name || 'unknown');
  return res.status(500).json({ error: 'Transcription request failed', code: 'transcription_internal_error' });
}

export default async function handler(req, res) {
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  res.setHeader('Cache-Control', 'private, no-store');
  try { validateOwnerProfile(gate.profileId); }
  catch (error) { return sendError(res, error); }

  if (req.method === 'GET') {
    try {
      const limit = req.query.limit == null ? 50 : Number(req.query.limit);
      const jobs = await listOwnerJobs({ ownerProfileId: gate.profileId, limit });
      return res.status(200).json({ jobs, pilotEnabled: true, submissionsEnabled: process.env.TRANSCRIPTION_SUBMISSIONS_ENABLED === 'true' });
    } catch (error) { return sendError(res, error); }
  }
  if (req.method === 'POST') {
    try {
      const result = await createOwnerUpload({ ownerProfileId: gate.profileId, body: req.body });
      return res.status(result.upload ? 201 : 200).json(result);
    } catch (error) { return sendError(res, error); }
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
