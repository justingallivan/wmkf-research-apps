/** GET/POST the independent materials-only presentation link. */
import { requireAppAccess } from '../../../../../lib/utils/auth.js';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref.js';
import { withDalContext } from '../../../../../lib/dataverse/core/context.js';
import { isGuid } from '../../../../../lib/utils/guid.js';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error.js';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker.js';
import {
  ensureLivePresentationLink,
  getLivePresentationLink,
  reissuePresentationLink,
} from '../../../../../lib/services/post-presentation-materials/presentation-link-service.js';

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } };
const BODY_KEYS = new Set(['action', 'expectedLinkId']);

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body || { error: error.message, code: error.code });
  }
  console.error('[meeting tracker presentation link] failed:', error?.message || error);
  return res.status(500).json({ error: 'The presentation link could not be processed.' });
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ error: 'A valid request id is required.' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') {
    return withDalContext('meeting-tracker-presentation-link-read', async () => {
      try {
        const link = await getLivePresentationLink({ requestId });
        return res.status(200).json({ success: true, link });
      } catch (error) { return sendError(res, error); }
    });
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => !BODY_KEYS.has(key))
    || !['ensure', 'reissue'].includes(req.body.action)) {
    return res.status(400).json({ error: 'The presentation-link request contains unsupported fields.' });
  }
  if (req.body.action === 'reissue' && !isGuid(req.body.expectedLinkId)) {
    return res.status(400).json({ error: 'Reissue must name the link being replaced.', code: 'presentation_link_expected_required' });
  }
  const actorId = actorRefFromSession(access.session);
  return withDalContext('meeting-tracker-presentation-link-write', async () => {
    try {
      const result = req.body.action === 'reissue'
        ? await reissuePresentationLink({ requestId, actorId, expectedLinkId: req.body.expectedLinkId })
        : await ensureLivePresentationLink({ requestId, actorId });
      return res.status(200).json({ success: true, ...result });
    } catch (error) { return sendError(res, error); }
  });
}
