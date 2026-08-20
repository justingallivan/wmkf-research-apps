/**
 * POST /api/external/grantee/[token]/upload-token
 *
 * Authorize one browser-direct upload into the private portal staging store.
 * The external token is re-verified here; the browser chooses only filename,
 * declared type, and size. Scope, resource, actor binding, and pathname are all
 * server-derived and are verified again by /submit.
 */

import { verifyGranteeToken } from '../../../../../lib/external/verify-grantee-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { isGranteeEditableStatus } from '../../../../../shared/config/granteeDeliverableStatus';
import { MAX_IMAGE_BYTES } from '../../../../../lib/services/grantee-upload';
import {
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  createPortalUpload,
  externalGranteeActorBinding,
} from '../../../../../lib/services/portal-upload-staging';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const token = req.query.token;
  const rl = await checkRateLimit(req, token);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return res.status(429).json({ ok: false, reason: 'rate_limited' });
  }

  const verified = await withDalContext('grantee-token-verify', () => verifyGranteeToken(token));
  await recordTokenOutcome(req, token, verified.ok);
  if (!verified.ok) {
    return res.status(verified.reason === 'not_found' ? 404 : 401)
      .json({ ok: false, reason: verified.reason });
  }
  if (!isGranteeEditableStatus(verified.deliverable?.wmkf_deliverablestatus)) {
    return res.status(409).json({ ok: false, reason: 'not_editable' });
  }

  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
  const size = Number(req.body?.size);
  if (!filename || !Number.isSafeInteger(size) || size <= 0) {
    return res.status(400).json({ ok: false, reason: 'bad_request' });
  }
  if (size > MAX_IMAGE_BYTES) {
    return res.status(400).json({ ok: false, reason: 'image_too_large' });
  }

  try {
    const upload = await createPortalUpload({
      scope: PORTAL_UPLOAD_SCOPES.GRANTEE_IMAGE,
      resourceId: verified.requestId,
      actorBinding: externalGranteeActorBinding(token),
      filename,
      contentType,
      maxBytes: MAX_IMAGE_BYTES,
      originalEtag: verified.deliverable?._etag || null,
    });
    return res.status(200).json({ ok: true, ...upload });
  } catch (error) {
    if (error instanceof PortalUploadStagingError) {
      return res.status(error.httpStatus).json({ ok: false, reason: error.code });
    }
    console.error('[grantee/upload-token] failed:', error?.message || error);
    return res.status(503).json({ ok: false, reason: 'staging_unavailable' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } },
};
