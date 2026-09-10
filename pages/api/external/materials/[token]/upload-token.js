/**
 * POST /api/external/materials/[token]/upload-token — authorize one
 * browser-direct upload into the private staging store for one checklist
 * slot. The browser chooses only slot, filename, declared type, and size;
 * scope, resource, actor binding, pathname, and the cap are server-derived
 * and verified again by /finalize.
 */
import { verifyMaterialsToken } from '../../../../../lib/external/verify-materials-token';
import { checkRateLimit, recordTokenOutcome } from '../../../../../lib/external/rate-limit';
import { withDalContext } from '../../../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../../../lib/services/service-http-error';
import { getUploadMaxMb, uploadMaxBytes } from '../../../../../lib/services/site-visit-materials/upload-cap';
import { slotExtensions } from '../../../../../lib/utils/site-visit-material-file';
import {
  PORTAL_DOCUMENT_CONTENT_TYPES,
  PORTAL_UPLOAD_SCOPES,
  PortalUploadStagingError,
  createPortalUpload,
  externalMaterialsActorBinding,
} from '../../../../../lib/services/portal-upload-staging';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }
  const { token } = req.query;
  const rl = await checkRateLimit(req, token);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSeconds));
    return res.status(429).json({ ok: false, reason: 'rate_limited' });
  }
  const verified = await verifyMaterialsToken(token);
  await recordTokenOutcome(req, token, verified.ok);
  if (!verified.ok) return res.status(verified.reason === 'not_found' ? 404 : 401).json({ ok: false, reason: verified.reason });

  const slot = typeof req.body?.slot === 'string' ? req.body.slot : '';
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const contentType = typeof req.body?.contentType === 'string' && req.body.contentType ? req.body.contentType : 'application/octet-stream';
  const size = Number(req.body?.size);
  const slotOpen = slot === 'other' || (verified.collection.checklist || []).some((item) => item.key === slot && !item.waived);
  if (!slotOpen || !slotExtensions(slot) || !filename || !Number.isSafeInteger(size) || size <= 0) {
    return res.status(400).json({ ok: false, reason: 'bad_request' });
  }
  const extension = (filename.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  if (!slotExtensions(slot).includes(extension)) return res.status(422).json({ ok: false, reason: 'extension_not_allowed' });

  try {
    const cap = await withDalContext('external-materials-upload-token', () => getUploadMaxMb());
    const maxBytes = uploadMaxBytes(cap.maxMb);
    if (size > maxBytes) return res.status(400).json({ ok: false, reason: 'file_too_large', maxMb: cap.maxMb });
    const upload = await createPortalUpload({
      scope: PORTAL_UPLOAD_SCOPES.SITE_VISIT_MATERIAL,
      resourceId: verified.requestId,
      actorBinding: externalMaterialsActorBinding(token),
      filename,
      contentType,
      maxBytes,
      allowedContentTypes: [...PORTAL_DOCUMENT_CONTENT_TYPES],
    });
    return res.status(200).json({ ok: true, slot, ...upload });
  } catch (error) {
    if (error instanceof PortalUploadStagingError) return res.status(error.httpStatus).json({ ok: false, reason: error.code });
    if (error instanceof ServiceHttpError) return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.code });
    console.error('[materials/upload-token] failed:', error?.message || error);
    return res.status(503).json({ ok: false, reason: 'staging_unavailable' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
