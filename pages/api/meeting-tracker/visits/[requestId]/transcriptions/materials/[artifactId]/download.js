import { requireAppAccess } from '../../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../../lib/services/service-http-error.js';
import { downloadMeetingTranscript } from '../../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const artifactId = Array.isArray(req.query.artifactId) ? '' : String(req.query.artifactId || '').trim();
  const format = Array.isArray(req.query.format) ? '' : String(req.query.format || '').trim();
  if (!isGuid(requestId) || !isGuid(artifactId) || !['txt','vtt'].includes(format)) return res.status(400).json({ error: 'A valid transcript format is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcript-material-download', async () => {
    try {
      const file = await downloadMeetingTranscript({ requestId, artifactId, format });
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
      return res.status(200).send(file.bytes);
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : 500;
      const code = error?.code || 'meeting_transcript_download_failed';
      if (status >= 500) console.error('[meeting tracker transcript download] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The transcript could not be downloaded.' : error.message, code });
    }
  });
}
