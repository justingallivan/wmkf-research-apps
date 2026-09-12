/**
 * GET/POST the applicant materials collection for a request's site visit
 * (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16, PR 1). Tracker grant, the
 * tracker readiness check, then the materials readiness check. POST carries
 * exactly one `action`: create | invite | remind | waive | ready. Request id
 * from the path; actor and sender from the session; body identity ignored.
 */
import { requireAppAccess } from '../../../../../lib/utils/auth';
import { actorRefFromSession } from '../../../../../lib/utils/actor-ref';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../shared/config/meetingTracker';
import { isSiteVisitMaterialsSchemaReady } from '../../../../../lib/utils/site-visit-materials-readiness';
import {
  confirmMaterialsReady,
  createMaterialsCollection,
  getMaterialsCollection,
  inviteMaterialsContributors,
  remindMaterialsContributors,
  waiveMaterialsItem,
} from '../../../../../lib/services/site-visit-materials/collection-service';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 60 };

const ACTIONS = new Set(['create', 'invite', 'remind', 'waive', 'ready']);
const BODY_KEYS = new Set(['action', 'key', 'waived']);

function exactBody(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).every((key) => BODY_KEYS.has(key))
    && ACTIONS.has(body.action);
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
    return res.status(503).json({ error: 'Meeting Tracker is not enabled for this environment.', code: 'meeting_tracker_schema_not_ready' });
  }
  if (!isSiteVisitMaterialsSchemaReady()) {
    return res.status(503).json({ error: 'Applicant materials collection is not enabled for this environment.', code: 'site_visit_materials_schema_not_ready' });
  }
  if (req.method === 'POST' && !exactBody(req.body)) {
    return res.status(400).json({ error: 'The materials request contains unsupported fields.' });
  }
  const actorId = actorRefFromSession(access.session);
  const fromEmail = String(access.session?.user?.azureEmail || '').trim().toLowerCase();

  return withDalContext('meeting-tracker-site-visit-materials', async () => {
    try {
      if (req.method === 'GET') {
        return res.status(200).json({ success: true, ...(await getMaterialsCollection({ requestId })) });
      }
      const { action } = req.body;
      if ((action === 'create' || action === 'invite' || action === 'remind') && !fromEmail) {
        return res.status(400).json({ error: 'Your account has no sending email address.' });
      }
      const result = action === 'create' ? await createMaterialsCollection({ requestId, actorId, fromEmail })
        : action === 'invite' ? await inviteMaterialsContributors({ requestId, actorId, fromEmail })
          : action === 'remind' ? await remindMaterialsContributors({ requestId, actorId, fromEmail })
            : action === 'waive' ? await waiveMaterialsItem({ requestId, key: String(req.body.key || ''), waived: req.body.waived === true })
              : await confirmMaterialsReady({ requestId, actorId });
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message, code: error.code });
      }
      console.error('meeting tracker site visit materials error:', error);
      return res.status(500).json({ error: 'The materials collection could not be loaded or updated.' });
    }
  });
}
