import { requireAppAccess } from '../../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error.js';
import {
  createSummaryDraft, getSummaryDraft, updateSummaryDraft, discardSummaryDraft,
} from '../../../../../../lib/services/post-presentation-materials/transcript-summary-service.js';

// POST runs the summary prompt synchronously (plan §16 decision C), so the route allows 300 s.
export const config = { api: { bodyParser: { sizeLimit: '256kb' } }, maxDuration: 300 };

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (body, keys) => Object.keys(body).sort().join(',') === [...keys].sort().join(',');
const isVersion = (value) => Number.isSafeInteger(value) && value > 0;
// Summary kinds (paired summaries plan D2). Absent means presentation.
const KINDS = new Set(['presentation', 'discussion']);
const isKind = (value) => typeof value === 'string' && KINDS.has(value);
const CREATE_KEYS = ['acknowledgmentVersion', 'expectedCurrentArtifactId', 'expectedCurrentFingerprint'];
const CREATE_OPTIONAL_KEYS = ['kind', 'replaceDraft'];

// replaceDraft names the exact ready draft a Summarize again replaces: null or {draftId, expectedVersion}.
function validReplaceDraft(value) {
  if (value === null) return true;
  return isPlainObject(value) && hasExactKeys(value, ['draftId', 'expectedVersion'])
    && typeof value.draftId === 'string' && isGuid(value.draftId) && isVersion(value.expectedVersion);
}

function validQuery(method, query) {
  if (!Object.prototype.hasOwnProperty.call(query, 'kind')) return true;
  return method === 'GET' && isKind(query.kind);
}

function validBody(method, body) {
  if (method === 'GET') return true;
  if (!isPlainObject(body)) return false;
  if (method === 'POST') {
    const keys = Object.keys(body);
    return CREATE_KEYS.every((key) => keys.includes(key))
      && keys.every((key) => CREATE_KEYS.includes(key) || CREATE_OPTIONAL_KEYS.includes(key))
      && (!Object.prototype.hasOwnProperty.call(body, 'kind') || isKind(body.kind))
      && (!Object.prototype.hasOwnProperty.call(body, 'replaceDraft') || validReplaceDraft(body.replaceDraft))
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
  if (!validQuery(req.method, req.query) || !validBody(req.method, req.body)) {
    return res.status(400).json({ error: 'The summary request is invalid.' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-transcript-summary', async () => {
    try {
      const args = { requestId, ownerProfileId: access.profileId, body: req.body };
      if (req.method === 'GET') return res.status(200).json(await getSummaryDraft({ ...args, kind: req.query.kind }));
      if (req.method === 'PATCH') return res.status(200).json(await updateSummaryDraft(args));
      if (req.method === 'DELETE') return res.status(200).json(await discardSummaryDraft(args));
      return res.status(200).json(await createSummaryDraft({ ...args, actingUserSystemId: actorRefFromSession(access.session) }));
    } catch (error) {
      const status = error instanceof ServiceHttpError ? error.httpStatus : Number(error?.httpStatus || error?.status) || 500;
      const code = error?.code || 'transcript_summary_failed';
      if (status >= 500) console.error('[meeting tracker transcript summary] failed:', code);
      return res.status(status).json(error?.body || { error: status >= 500 ? 'The summary could not be processed.' : error.message, code });
    }
  });
}
