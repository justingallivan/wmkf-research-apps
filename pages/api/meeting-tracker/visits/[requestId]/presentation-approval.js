/** Review and publication policy for the presentation set, independent of link lifecycle and staff drafts. */
import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import { getPresentationApproval, mutatePresentationApproval } from '../../../../../lib/services/post-presentation-materials/edition-service.js';

export const config = { api: { bodyParser: { sizeLimit: '8kb' } }, maxDuration: 120 };
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).length === keys.length && keys.every(k => Object.hasOwn(body, k));
function valid(body) {
  if (!Number.isSafeInteger(body?.expectedVersion) || body.expectedVersion < 0) return false;
  if (body.action === 'enroll') return exact(body, ['action','expectedVersion']) && body.expectedVersion === 0;
  if (body.action === 'withdraw') return exact(body, ['action','expectedVersion','expectedEditionId']) && body.expectedVersion > 0 && isGuid(body.expectedEditionId);
  return body.action === 'approve' && exact(body, ['action','expectedVersion','commandId','candidateFingerprint','videoReviewed','summaryReviewed'])
    && body.expectedVersion > 0 && isGuid(body.commandId) && /^[a-f0-9]{64}$/.test(body.candidateFingerprint)
    && body.videoReviewed === true && body.summaryReviewed === true;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const requestId = req.query.requestId;
  if (!isGuid(requestId) || Object.keys(req.query).some(k => k !== 'requestId')) return res.status(400).json({ error: 'A valid request is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active staff profile is required.' });
  if (req.method === 'POST' && !valid(req.body)) return res.status(400).json({ error: 'The approval request is invalid.' });
  const args = { requestId, profileId: access.profileId, actingUserSystemId: actorRefFromSession(access.session), body: req.body };
  return withDalContext('meeting-tracker-presentation-approval', async () => {
    try { return res.status(200).json(req.method === 'GET' ? await getPresentationApproval(args) : await mutatePresentationApproval(args)); }
    catch (error) {
      if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json({ error: error.message, code: error.code });
      console.error('[presentation approval] unavailable:', error?.code || error?.name || 'error');
      return res.status(503).json({ error: 'Board approval is unavailable. Try again.', code: 'presentation_approval_unavailable' });
    }
  });
}
