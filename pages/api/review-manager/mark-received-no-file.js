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
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { validateReviewForm } from '../../../lib/external/review-form-schema';

const ENTITY_SET = 'wmkf_appreviewersuggestions';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  try {
    const { suggestionId, structuredData } = req.body || {};
    if (!suggestionId || typeof suggestionId !== 'string') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
    }

    const formResult = validateReviewForm(structuredData, { partial: true });
    if (!formResult.ok) {
      return res.status(400).json(formResult);
    }

    const patch = {
      ...formResult.dataverseValues,
      wmkf_reviewreceivedat: new Date().toISOString(),
      wmkf_reviewuploadedbystaff: true,
    };

    const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

    try {
      await bypassDynamicsRestrictions('mark-received-no-file', () =>
        DynamicsService.updateRecord(ENTITY_SET, suggestionId, patch, { actingUserSystemId }),
      );
    } catch (e) {
      if (/update.*failed.*404/i.test(e.message || '')) {
        return res.status(404).json({ ok: false, reason: 'not_found' });
      }
      throw e;
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[review-manager mark-received-no-file] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
