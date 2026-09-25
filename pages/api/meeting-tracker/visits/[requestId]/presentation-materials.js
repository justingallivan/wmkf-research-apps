/** GET current post-presentation winners; PATCH a lease-fenced Zoom recording. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker';
import {
  getPresentationMaterials,
  saveZoomRecording,
} from '../../../../../lib/services/post-presentation-materials/material-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 60 };

const PATCH_KEYS = new Set(['action', 'operationId', 'zoomText']);

function exactPatchBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && body.action === 'save_zoom'
    && Object.keys(body).every((key) => PATCH_KEYS.has(key));
}

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
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
  if (req.method === 'PATCH' && !exactPatchBody(req.body)) {
    return res.status(400).json({ error: 'The presentation-material request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-presentation-materials', async () => {
    try {
      const result = req.method === 'GET'
        ? await getPresentationMaterials({ requestId })
        : await saveZoomRecording({
          requestId,
          operationId: req.body.operationId,
          zoomText: req.body.zoomText,
          actingUserSystemId: actorRefFromSession(access.session),
        });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message, code: error.code });
      }
      console.error('[meeting tracker presentation materials] failed:', error?.message || error);
      return res.status(500).json({ error: 'Presentation materials could not be loaded or saved.' });
    }
  });
}
