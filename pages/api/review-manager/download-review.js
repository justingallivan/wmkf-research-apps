/**
 * GET /api/review-manager/download-review?suggestionId=...&filename=...
 *
 * Stream a completed review back to staff. File lives in SharePoint,
 * pointed at by `wmkf_reviewsharepointfolder`; streamed via Graph as
 * the foundation's app registration.
 *
 * Authorization scope: staff-shared. Any user with `review-manager` app
 * access can download any review by suggestionId. This is intentional —
 * Review Manager is a shared staff workflow (multiple program directors,
 * grant managers, and the CSO collaborate across proposals), and reviews
 * are not user-owned data. The PD-scoping you see in `my-candidates` and
 * `reviewers.js` is a UX convenience for the default listing view, not an
 * auth boundary. If the org-wide model later changes, tighten by resolving
 * suggestion → request → PD here.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. The 200 is BINARY: the shell owns the
 * golden headers + res.send(buffer); the service returns a plain file
 * descriptor. All lookup/Graph logic lives in
 * lib/services/review-manager/download-review-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { downloadReview } from '../../../lib/services/review-manager/download-review-service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const { suggestionId, filename: requestedFilename } = req.query;
  if (!suggestionId || typeof suggestionId !== 'string') {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
  }
  // GUID-validate before it becomes a Dataverse record-id selector (getRecord
  // interpolates it raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }

  return withDalContext('download-review-lookup', async () => {
    try {
      const file = await downloadReview({ suggestionId, requestedFilename });
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeFilename(file.filename)}"`,
      );
      res.setHeader('Content-Length', file.size);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(file.buffer);
    } catch (e) {
      if (e instanceof ServiceHttpError) {
        return res.status(e.httpStatus).json(e.body ?? { error: e.message });
      }
      console.error('[download-review] error:', e);
      return res.status(500).json({
        ok: false,
        reason: 'server_error',
        details: process.env.NODE_ENV === 'development' ? e.message : undefined,
      });
    }
  });
}

function encodeFilename(name) {
  return String(name || 'review').replace(/["\r\n]/g, '');
}

export const config = {
  api: { responseLimit: '60mb' },
};
