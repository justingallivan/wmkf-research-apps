/**
 * POST /api/meeting-tracker/visits/[requestId]/materials/staff-upload-token —
 * authorize one browser-direct upload of a file the PI sent to staff, for one
 * checklist slot (waived or not) or `other`, whatever the collection's state
 * (docs/plans/STAFF_APPLICANT_MATERIALS_REPLACEMENT_PLAN_2026-10-05.md §3.1).
 * The browser chooses only slot, filename, declared type, and size; scope,
 * resource, staff actor binding, pathname, and the cap are server-derived and
 * verified again by staff-finalize.
 */
import { requireAppAccess } from '../../../../../../lib/utils/auth';
import { withDalContext } from '../../../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../../../lib/utils/guid';
import { ServiceHttpError } from '../../../../../../lib/services/service-http-error';
import { isMeetingTrackerSchemaReady } from '../../../../../../shared/config/meetingTracker';
import { isSiteVisitMaterialsSchemaReady } from '../../../../../../lib/utils/site-visit-materials-readiness';
import { getUploadMaxMb, uploadMaxBytes } from '../../../../../../lib/services/site-visit-materials/upload-cap';
import { slotExtensions } from '../../../../../../lib/utils/site-visit-material-file';
import { SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED } from '../../../../../../shared/config/siteVisitMaterials';
import {
  getLatestCollectionForRequest,
  getOpenCollectionForRequest,
} from '../../../../../../lib/services/site-visit-materials/collection-store';
import {
  PORTAL_DOCUMENT_CONTENT_TYPES,
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  createPortalUpload,
  staffActorBinding,
} from '../../../../../../lib/services/portal-upload-staging';

const BODY_KEYS = new Set(['slot', 'filename', 'contentType', 'size']);

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const requestId = Array.isArray(req.query.requestId) ? '' : String(req.query.requestId || '').trim();
  if (!isGuid(requestId)) return res.status(400).json({ ok: false, reason: 'bad_request' });
  const access = await requireAppAccess(req, res, 'meeting-tracker');
  if (!access) return;
  if (!isMeetingTrackerSchemaReady() || !isSiteVisitMaterialsSchemaReady()) {
    return res.status(503).json({ ok: false, reason: 'site_visit_materials_schema_not_ready' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).every((key) => BODY_KEYS.has(key))) {
    return res.status(400).json({ ok: false, reason: 'bad_request' });
  }
  const slot = typeof body.slot === 'string' ? body.slot : '';
  const filename = typeof body.filename === 'string' ? body.filename : '';
  const contentType = typeof body.contentType === 'string' && body.contentType ? body.contentType : 'application/octet-stream';
  const size = Number(body.size);
  if (!slotExtensions(slot) || !filename || !Number.isSafeInteger(size) || size <= 0) {
    return res.status(400).json({ ok: false, reason: 'bad_request' });
  }
  const extension = (filename.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  if (!slotExtensions(slot).includes(extension)) return res.status(422).json({ ok: false, reason: 'extension_not_allowed' });

  try {
    return await withDalContext('meeting-tracker-materials-staff-upload-token', async () => {
      const collection = (await getOpenCollectionForRequest(requestId)) || (await getLatestCollectionForRequest(requestId));
      if (!collection) return res.status(404).json({ ok: false, reason: 'site_visit_materials_missing' });
      const slotKnown = (slot === 'other' && SITE_VISIT_MATERIALS_OTHER_UPLOADS_ENABLED)
        || (collection.checklist || []).some((item) => item.key === slot);
      if (!slotKnown) return res.status(400).json({ ok: false, reason: 'slot_not_open' });
      const cap = await getUploadMaxMb();
      const maxBytes = uploadMaxBytes(cap.maxMb);
      if (size > maxBytes) return res.status(400).json({ ok: false, reason: 'file_too_large', maxMb: cap.maxMb });
      const upload = await createPortalUpload({
        scope: PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL,
        resourceId: requestId,
        actorBinding: staffActorBinding(access.profileId),
        filename,
        contentType,
        maxBytes,
        allowedContentTypes: [...PORTAL_DOCUMENT_CONTENT_TYPES],
      });
      return res.status(200).json({ ok: true, slot, ...upload });
    });
  } catch (error) {
    if (error instanceof PortalUploadStagingError) return res.status(error.httpStatus).json({ ok: false, reason: error.code });
    if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.code });
    console.error('[materials/staff-upload-token] failed:', error?.message || error);
    return res.status(503).json({ ok: false, reason: 'staging_unavailable' });
  }
}
