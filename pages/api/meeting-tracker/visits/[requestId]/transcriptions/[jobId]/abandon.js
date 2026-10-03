import { requireAppAccess, requireSuperuser } from '../../../../../../../lib/utils/auth.js';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error.js';
import { abandonMeetingUncertainJob } from '../../../../../../../lib/services/meeting-tracker-transcription/service.js';

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
    || Object.keys(body).sort().join(',') !== 'acknowledgePotentialDuplicateCharge,expectedVersion'
    || !Number.isSafeInteger(body.expectedVersion) || body.acknowledgePotentialDuplicateCharge !== true) return res.status(400).json({ error: 'Explicit acknowledgement is required to abandon an uncertain submission.' });
  res.setHeader('Cache-Control','private, no-store');
  return withDalContext('meeting-tracker-transcription-abandon', async () => {
    try { return res.status(200).json(await abandonMeetingUncertainJob({ requestId, jobId, actorProfileId: access.profileId, body })); }
    catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus) || 500;
      const code = error?.code || 'transcription_abandon_failed';
      if (status >= 500) console.error('[meeting tracker transcription abandon] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The uncertain submission could not be abandoned.' : error.message, code });
    }
  });
}
