/**
 * GET/PATCH the single active Site Visit for a request, from the Meeting
 * Tracker (PC Meeting Tracker plan §5.1 "one visit editor per request", slice
 * 2b). Thin over the existing Site Visit logistics service: same body
 * allowlist, same ETag fence, same request precondition (advancing request in
 * a cycle), same recipient resolution. Guarded by the tracker grant so the PC
 * can schedule visits without a Reviewers grant.
 */
import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../lib/services/service-http-error';
import {
  getSiteVisitLogistics,
  saveSiteVisitLogistics,
} from '../../../../lib/services/site-visit/logistics-service';
import { isMeetingTrackerSchemaReady } from '../../../../shared/config/meetingTracker';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
  maxDuration: 60,
};

const PATCH_KEYS = new Set([
  'activityId', 'etag', 'subject', 'description', 'startLocal', 'endLocal', 'timeZone',
  'disambiguation', 'format', 'locationOrLink', 'organizer', 'requiredAttendees', 'optionalAttendees',
]);

function exactBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => PATCH_KEYS.has(key));
}

export default async function handler(req, res) {
  if (!['GET', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'A valid request id is required.' });
  }
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady()) {
    return res.status(503).json({
      error: 'Meeting Tracker is not enabled for this environment.',
      code: 'meeting_tracker_schema_not_ready',
    });
  }
  if (req.method === 'PATCH' && !exactBody(req.body)) {
    return res.status(400).json({ error: 'The site visit request contains unsupported fields.' });
  }

  return withDalContext('meeting-tracker-site-visit', async () => {
    try {
      if (req.method === 'GET') {
        const result = await getSiteVisitLogistics({ requestId });
        return res.status(200).json({ success: true, siteVisit: result.siteVisit });
      }
      // The request id comes from the path, never the body (the body allowlist
      // excludes it), so a stale form cannot retarget another request.
      const result = await saveSiteVisitLogistics({ ...req.body, requestId }, {
        actingUserSystemId: access.session?.user?.dynamicsSystemuserId || null,
      });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body || { error: error.message, code: error.code || 'site_visit_logistics_failed' });
      }
      console.error('meeting tracker site visit error:', error);
      return res.status(500).json({ error: 'The site visit could not be loaded or saved.' });
    }
  });
}
