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
import { isGuid } from '../../../lib/utils/guid';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { validateReviewForm } from '../../../lib/external/review-form-schema';
import { getActiveQuestionSet } from '../../../lib/external/review-question-fetcher';
import { buildRatingSnapshotRows, answerRowUrl, answerRowBody } from '../../../lib/external/review-answer-snapshot';

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
    // GUID-validate before it becomes a Dataverse record-id selector
    // (updateRecord interpolates it raw into the request URL).
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
    }

    // Validate against the LIVE question set (fail-closed) so a staff-edited
    // rating domain/order is honoured exactly as the reviewer submit path does.
    const questionSet = await getActiveQuestionSet();
    const formResult = validateReviewForm(structuredData, { partial: true, fields: questionSet });
    if (!formResult.ok) {
      return res.status(400).json(formResult);
    }

    const patch = {
      ...formResult.dataverseValues,
      wmkf_reviewreceivedat: new Date().toISOString(),
      wmkf_reviewuploadedbystaff: true,
    };

    const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

    // Write the rating snapshot rows. Post-Phase-E ratings live ONLY in the
    // snapshot (`patch` no longer carries the rating columns). Only ratings
    // actually present get a row — the "informal feedback" scenario omits
    // structuredData, so ratings stay empty, no snapshot row is written, and
    // aggregates keep skipping the row.
    const ratingRows = buildRatingSnapshotRows(formResult.ratings, questionSet);
    const snapshotKeys = new Set(
      questionSet.filter((f) => f.type === 'picklist' || f.type === 'richtext').map((f) => f.key),
    );

    try {
      await bypassDynamicsRestrictions('mark-received-no-file', async () => {
        if (ratingRows.length === 0) {
          await DynamicsService.updateRecord(ENTITY_SET, suggestionId, patch, { actingUserSystemId });
          return;
        }
        // Atomic: rating upserts (by alternate key) + the parent PATCH in one
        // changeset, so a parent-only row can never be left behind on a partial
        // failure (the exact gap Phase D closes).
        const answerEntitySet = await DynamicsService.resolveEntitySetName('wmkf_appreviewanswer');
        const operations = ratingRows.map((row) => ({
          method: 'PATCH',
          url: answerRowUrl(answerEntitySet, suggestionId, row.questionKey, snapshotKeys),
          body: answerRowBody(row),
        }));
        operations.push({ method: 'PATCH', url: `${ENTITY_SET}(${suggestionId})`, body: patch });
        await DynamicsService.executeChangeset(operations, { actingUserSystemId });
      });
    } catch (e) {
      if (/(?:update|changeset).*404/i.test(e.message || '') || e.status === 404) {
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
