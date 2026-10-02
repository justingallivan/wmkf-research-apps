import { requireAppAccess, requireSuperuser } from '../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error.js';
import { reconcileMeetingUncertainJob } from '../../../../../../../lib/services/meeting-tracker-transcription/service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } }, maxDuration: 60 };
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const jobId = Array.isArray(req.query.jobId) ? '' : String(req.query.jobId || '').trim();
  if (!isGuid(requestId) || !isGuid(jobId)) return res.status(400).json({ error: 'A valid request and job id are required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  const admin = await requireSuperuser(req, res);
  if (!admin) return;
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['expectedVersion','providerTranscriptId','mode'].includes(key))
    || !Number.isSafeInteger(body.expectedVersion)
    || typeof body.providerTranscriptId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.providerTranscriptId)
    || (body.mode != null && !['publish','cleanup'].includes(body.mode))) return res.status(400).json({ error: 'The provider-reconciliation request is invalid.' });
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcription-reconcile', async () => {
    try { return res.status(200).json(await reconcileMeetingUncertainJob({ requestId, jobId, actorProfileId: access.profileId, body })); }
    catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 503;
      const code = error?.code || 'provider_verification_failed';
      if (status >= 500) console.error('[meeting tracker transcription reconcile] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'Provider verification could not complete; refresh before retrying.' : error.message, code });
    }
  });
}
