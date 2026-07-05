/**
 * POST /api/review-manager/mark-received-no-file
 *
 * Records that a review came in without storing a file. Two scenarios:
 *
 *   1. Lost / out-of-band file (mailed paper, email-attachment lost,
 *      reviewer phoned it in) — staff has the content but it never lands
 *      in SharePoint as a file we can serve back.
 *
 *   2. Informal feedback — reviewer sent comments that we want to log on
 *      the row but explicitly should not be aggregated into scores. In
 *      that case staff omits `structuredData` and the picklist/affiliation
 *      fields stay null, which is exactly how aggregates filter the row
 *      out (SQL/OData AVG ignores null).
 *
 * Body: { suggestionId: string, structuredData?: Object }
 *   `structuredData` follows the same shape the form posts (`affiliation`,
 *   `impact`, `risk`, `overallRating`). All keys optional; whatever is
 *   present is validated against the schema and written.
 *
 * Side effects (always):
 *   - wmkf_reviewreceivedat = now()
 *   - wmkf_reviewuploadedbystaff = true
 *
 * Does NOT revoke the token — reviewer might still want to send the actual
 * file later, and the link's other expiry rules apply normally.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 2): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. All business logic (live-question-set
 * validation, single-PATCH vs atomic-changeset branch) lives in
 * lib/services/review-manager/mark-received-no-file-service.js.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { markReceivedNoFile } from '../../../lib/services/review-manager/mark-received-no-file-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const { suggestionId, structuredData } = req.body || {};
  if (!suggestionId || typeof suggestionId !== 'string') {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
  }
  // GUID-validate before it becomes a Dataverse record-id selector
  // (updateRecord interpolates it raw into the request URL).
  if (!isGuid(suggestionId)) {
    return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  return withDalContext('mark-received-no-file', async () => {
    try {
      const result = await markReceivedNoFile({ suggestionId, structuredData, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('[review-manager mark-received-no-file] error:', error);
      return res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });
}
