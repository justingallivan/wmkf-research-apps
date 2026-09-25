/** Mint an actor/request-bound private Blob staging upload for one transcript. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker';
import { mintTranscriptUpload } from '../../../../../lib/services/post-presentation-materials/material-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 60 };

const BODY_KEYS = new Set(['artifactType', 'filename', 'contentType', 'size']);

function exactBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && body.artifactType === 'transcript'
    && Object.keys(body).length === BODY_KEYS.size
    && Object.keys(body).every((key) => BODY_KEYS.has(key));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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
  if (!exactBody(req.body)) {
    return res.status(400).json({ error: 'The transcript upload request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-presentation-upload-mint', async () => {
    try {
      const upload = await mintTranscriptUpload({
        requestId,
        actorProfileId: access.profileId,
        actingUserSystemId: actorRefFromSession(access.session),
        filename: req.body.filename,
        contentType: req.body.contentType,
        size: req.body.size,
      });
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).json({ success: true, upload });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message, code: error.code });
      }
      console.error('[meeting tracker transcript upload mint] failed:', error?.message || error);
      return res.status(503).json({ error: 'The transcript upload could not be started.' });
    }
  });
}
