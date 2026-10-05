import { requireAppAccess } from '../../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error.js';
import { generatePresentationTranscript } from '../../../../../../lib/services/post-presentation-materials/presentation-transcript-service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 120 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).sort().join(',') !== 'expectedCurrentArtifactId,expectedCurrentFingerprint'
    || typeof body.expectedCurrentArtifactId !== 'string' || !isGuid(body.expectedCurrentArtifactId)
    || typeof body.expectedCurrentFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedCurrentFingerprint)) {
    return res.status(400).json({ error: 'The presentation transcript request is invalid.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-presentation-transcript', async () => {
    try {
      return res.status(200).json(await generatePresentationTranscript({ requestId, ownerProfileId: access.profileId,
        actingUserSystemId: actorRefFromSession(access.session), body }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'presentation_transcript_failed';
      if (status >= 500) console.error('[meeting tracker presentation transcript] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The presentation transcript could not be generated.' : error.message, code });
    }
  });
}
