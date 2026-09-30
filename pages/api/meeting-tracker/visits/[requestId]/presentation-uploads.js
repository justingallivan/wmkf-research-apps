/** Begin an actor/request-bound transcript staging or browser-direct MP4 upload. */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker';
import {
  mintMp4Upload,
  mintTranscriptUpload,
} from '../../../../../lib/services/post-presentation-materials/material-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 60 };

const TRANSCRIPT_KEYS = new Set(['artifactType', 'filename', 'contentType', 'size']);
const MP4_KEYS = new Set(['artifactType', 'operationId', 'filename', 'contentType', 'size', 'resumeFingerprint']);

function exactBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const expected = body.artifactType === 'transcript'
    ? TRANSCRIPT_KEYS
    : body.artifactType === 'recording' ? MP4_KEYS : null;
  return Boolean(expected)
    && Object.keys(body).length === expected.size
    && Object.keys(body).every((key) => expected.has(key));
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
    return res.status(400).json({ error: 'The presentation upload request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-presentation-upload-mint', async () => {
    try {
      const actorId = actorRefFromSession(access.session);
      const upload = req.body.artifactType === 'recording'
        ? await mintMp4Upload({
          requestId,
          operationId: req.body.operationId,
          actingUserSystemId: actorId,
          filename: req.body.filename,
          contentType: req.body.contentType,
          size: req.body.size,
          resumeFingerprint: req.body.resumeFingerprint,
        })
        : await mintTranscriptUpload({
          requestId,
          actorProfileId: access.profileId,
          actingUserSystemId: actorId,
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
      console.error('[meeting tracker presentation upload mint] failed:', error?.message || error);
      return res.status(503).json({ error: 'The presentation upload could not be started.' });
    }
  });
}
