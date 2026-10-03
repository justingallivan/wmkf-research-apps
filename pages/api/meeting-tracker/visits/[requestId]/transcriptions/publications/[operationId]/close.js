import { requireAppAccess } from '../../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../../lib/services/service-http-error.js';
import { closeMeetingTranscriptPublication } from '../../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 300 };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const operationId = Array.isArray(req.query.operationId) ? '' : String(req.query.operationId || '').trim();
  if (!isGuid(requestId) || !isGuid(operationId)) return res.status(400).json({ error: 'A valid request and publication id are required.' });
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).length !== 1 || req.body.acknowledgeRetainedFiles !== true) {
    return res.status(400).json({ error: 'Confirm that any candidate files will be retained.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-transcript-publication-close', async () => {
    try {
      return res.status(200).json(await closeMeetingTranscriptPublication({ requestId, operationId,
        actorProfileId: access.profileId, acknowledgeRetainedFiles: req.body.acknowledgeRetainedFiles }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus) || 503;
      const code = error?.code || 'meeting_transcript_close_failed';
      if (status >= 500) console.error('[meeting tracker transcript publication close] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The publication attempt could not be closed.' : error.message, code });
    }
  });
}
