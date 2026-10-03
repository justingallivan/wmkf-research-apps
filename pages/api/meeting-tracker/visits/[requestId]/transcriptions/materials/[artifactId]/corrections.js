import { requireAppAccess } from '../../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../../lib/services/service-http-error.js';
import { createMeetingCorrection } from '../../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 60 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const artifactId = Array.isArray(req.query.artifactId) ? '' : String(req.query.artifactId || '').trim();
  if (!isGuid(requestId) || !isGuid(artifactId)) return res.status(400).json({ error: 'A valid request and transcript id are required.' });
  if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return res.status(400).json({ error: 'Correction drafts do not accept client content.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcript-correction-create', async () => {
    try { return res.status(201).json(await createMeetingCorrection({ requestId, ownerProfileId: access.profileId, artifactId })); }
    catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus) || 500;
      const code = error?.code || 'meeting_transcript_correction_failed';
      if (status >= 500) console.error('[meeting tracker transcript correction] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The correction draft could not be created.' : error.message, code });
    }
  });
}
