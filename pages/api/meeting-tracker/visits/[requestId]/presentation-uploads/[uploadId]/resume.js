/** Reauthorize and reconcile one durable browser-direct MP4 upload intent. */
import { requireAppAccess } from '../../../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../../../shared/config/meetingTracker';
import { getMp4UploadStatus } from '../../../../../../../lib/services/post-presentation-materials/material-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 60 };

function exactBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === 1
    && typeof body.resumeFingerprint === 'string';
}
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  const uploadId = Array.isArray(req.query.uploadId) ? '' : String(req.query.uploadId || '').trim();
  if (!isGuid(requestId) || !isGuid(uploadId) || !exactBody(req.body)) {
    return res.status(400).json({ error: 'A valid upload resume request is required.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  return withDalContext('meeting-tracker-presentation-upload-resume', async () => {
    try {
      const upload = await getMp4UploadStatus({
        requestId,
        uploadId,
        actingUserSystemId: actorRefFromSession(access.session),
        resumeFingerprint: req.body.resumeFingerprint,
      });
      return res.status(200).json({ success: true, upload });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message, code: error.code });
      }
      console.error('[meeting tracker recording upload resume] failed:', error?.message || error);
      return res.status(503).json({ error: 'The recording upload could not be resumed.' });
    }
  });
}
