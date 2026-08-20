/**
 * POST /api/workbench/grantee-deliverables/replacement-upload-token
 *
 * Authenticated staff mint for one private, request-bound replacement image.
 * The server verifies app access, request GUID, current package status, and ETag
 * before returning a short-lived token for a server-chosen pathname.
 */

import { requireAppAccess } from '../../../../lib/utils/auth';
import { withDalContext } from '../../../../lib/dataverse/core/context';
import { isGuid } from '../../../../lib/utils/guid';
import { getDeliverableForRequest } from '../../../../lib/services/grantee-deliverable-record';
import { MAX_IMAGE_BYTES } from '../../../../lib/services/grantee-upload';
import { isStaffReplaceableStatus } from '../../../../shared/config/granteeDeliverableStatus';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  createPortalUpload,
  staffActorBinding,
} from '../../../../lib/services/portal-upload-staging';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
  const clientEtag = typeof req.body?.etag === 'string' ? req.body.etag.trim() : '';
  const size = Number(req.body?.size);
  if (!isGuid(requestId)) return res.status(400).json({ error: 'requestId must be a GUID' });
  if (!filename || !clientEtag || !Number.isSafeInteger(size) || size <= 0) {
    return res.status(400).json({ error: 'filename, size, contentType, and etag are required' });
  }
  if (size > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'The image is too large.' });

  return withDalContext('grantee-replacement-upload-token', async () => {
    const deliverable = await getDeliverableForRequest(requestId);
    if (!deliverable?.wmkf_granteedeliverableid) {
      return res.status(404).json({ error: 'No grantee deliverable package for this request.' });
    }
    if (!isStaffReplaceableStatus(deliverable.wmkf_deliverablestatus)) {
      return res.status(409).json({ code: 'not_replaceable', error: 'This package cannot be edited in its current status.' });
    }
    if (!deliverable._etag || deliverable._etag !== clientEtag) {
      return res.status(409).json({ code: 'stale', error: 'This package changed since you loaded it. Reload and try again.' });
    }

    try {
      const upload = await createPortalUpload({
        scope: PORTAL_UPLOAD_SCOPES.STAFF_GRANTEE_IMAGE,
        resourceId: requestId,
        actorBinding: staffActorBinding(access.profileId),
        filename,
        contentType,
        maxBytes: MAX_IMAGE_BYTES,
        originalEtag: deliverable._etag,
      });
      return res.status(200).json({ ok: true, ...upload });
    } catch (error) {
      if (error instanceof PortalUploadStagingError) {
        return res.status(error.httpStatus).json({ code: error.code, error: 'Could not prepare the image upload.' });
      }
      console.error('[grantee-deliverables/replacement-upload-token] failed:', error?.message || error);
      return res.status(503).json({ error: 'Could not prepare the image upload.' });
    }
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};
