import { requireAppAccess } from '../../../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error.js';
import { publishMeetingTranscription } from '../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 300 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const jobId = Array.isArray(req.query.jobId) ? '' : String(req.query.jobId || '').trim();
  if (!isGuid(requestId) || !isGuid(jobId)) return res.status(400).json({ error: 'A valid request and job id are required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'expectedCurrentArtifactId,expectedCurrentFingerprint,expectedVersion'
    || !Number.isSafeInteger(body.expectedVersion)
    || (body.expectedCurrentArtifactId !== null && !isGuid(body.expectedCurrentArtifactId))
    || (body.expectedCurrentFingerprint !== null && (typeof body.expectedCurrentFingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(body.expectedCurrentFingerprint)))) {
    return res.status(400).json({ error: 'The transcript publication request is invalid.' });
  }
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcription-publish', async () => {
    try { return res.status(200).json(await publishMeetingTranscription({ requestId, ownerProfileId: access.profileId,
      actingUserSystemId: actorRefFromSession(access.session), jobId, body })); }
    catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus) || 500;
      const code = error?.code || 'meeting_transcription_publication_failed';
      if (status >= 500) console.error('[meeting tracker transcription publish] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The transcript could not be published.' : error.message, code });
    }
  });
}
