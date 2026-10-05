import { requireAppAccess } from '../../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error.js';
import {
  createPresentationSummaryDraft, getPresentationSummaryDraft, updatePresentationSummaryDraft, discardPresentationSummaryDraft,
} from '../../../../../../lib/services/post-presentation-materials/transcript-summary-service.js';

// POST runs the summary prompt synchronously (plan §16 decision C), so the route allows 300 s.
export const config = { api: { bodyParser: { sizeLimit: '256kb' } }, maxDuration: 300 };

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (body, keys) => Object.keys(body).sort().join(',') === [...keys].sort().join(',');
const isVersion = (value) => Number.isSafeInteger(value) && value > 0;

function validBody(method, body) {
  if (method === 'GET') return true;
  if (!isPlainObject(body)) return false;
  if (method === 'POST') {
    return hasExactKeys(body, ['acknowledgmentVersion', 'expectedCurrentArtifactId', 'expectedCurrentFingerprint'])
      && typeof body.acknowledgmentVersion === 'string' && body.acknowledgmentVersion.length <= 100
      && typeof body.expectedCurrentArtifactId === 'string' && isGuid(body.expectedCurrentArtifactId)
      && typeof body.expectedCurrentFingerprint === 'string' && /^[0-9a-f]{64}$/.test(body.expectedCurrentFingerprint);
  }
  if (method === 'PATCH') {
    return hasExactKeys(body, ['draftId', 'expectedVersion', 'text'])
      && typeof body.draftId === 'string' && isGuid(body.draftId) && isVersion(body.expectedVersion)
      && typeof body.text === 'string';
  }
  if (method === 'DELETE') {
    return hasExactKeys(body, ['draftId', 'expectedVersion'])
      && typeof body.draftId === 'string' && isGuid(body.draftId) && isVersion(body.expectedVersion);
  }
  return false;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!Number.isSafeInteger(access.profileId) || access.profileId < 1) return res.status(401).json({ error: 'An active linked staff profile is required.' });
  if (!validBody(req.method, req.body)) return res.status(400).json({ error: 'The summary request is invalid.' });
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-transcript-summary', async () => {
    try {
      const args = { requestId, ownerProfileId: access.profileId, body: req.body };
      if (req.method === 'GET') return res.status(200).json(await getPresentationSummaryDraft(args));
      if (req.method === 'PATCH') return res.status(200).json(await updatePresentationSummaryDraft(args));
      if (req.method === 'DELETE') return res.status(200).json(await discardPresentationSummaryDraft(args));
      return res.status(200).json(await createPresentationSummaryDraft({ ...args, actingUserSystemId: actorRefFromSession(access.session) }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'transcript_summary_failed';
      if (status >= 500) console.error('[meeting tracker transcript summary] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The summary could not be processed.' : error.message, code });
    }
  });
}
