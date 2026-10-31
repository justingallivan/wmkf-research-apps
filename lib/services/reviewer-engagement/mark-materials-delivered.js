/**
 * Staff "Mark as delivered" for a materials release that went out but whose
 * reviewer row was never recorded (D46/D49; release row in migration 091).
 *
 * Holds the business logic for POST /api/review-manager/materials-release-delivered.
 * Only a release at `sent` (confirmed delivery) qualifies; nothing is sent.
 * The reviewer bookkeeping (`recordDeliveredEmail`: `wmkf_materialssentat`,
 * status `materials_sent`) is tried first; when the reviewer row cannot take
 * it (closed, withdrew, binding changed), the release is closed as a staff
 * decision (`error_code = staff_marked_delivered`). Either way the release
 * alert is resolved.
 */
import * as materialsReleaseStore from './materials-release-store';
import * as suggestionAdapter from '../../dataverse/adapters/reviewer-suggestion';
import { recordDeliveredEmail } from './record-email-outcome';
import AlertService from '../alert-service';
import { ServiceHttpError } from '../service-http-error';

const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function markMaterialsDelivered({ suggestionId, actorProfileId, actingUserSystemId }) {
  if (!actorProfileId) throw new ServiceHttpError('Your staff profile could not be confirmed.', { httpStatus: 403 });
  const release = await materialsReleaseStore.getMaterialsRelease(suggestionId);
  if (!release || release.state !== 'sent') {
    throw new ServiceHttpError('Only a materials email that was confirmed sent can be marked as delivered.', {
      httpStatus: 409,
      body: { ok: false, reason: 'release_not_sent', state: release?.state || null,
        error: 'Only a materials email that was confirmed sent can be marked as delivered.' },
    });
  }

  let reviewerRecorded = false;
  try {
    const fresh = await suggestionAdapter.findById(suggestionId);
    if (fresh && sameId(fresh._wmkf_request_value, release.request_id)) {
      await recordDeliveredEmail({
        suggestionId,
        originalSuggestion: { _wmkf_request_value: release.request_id, _wmkf_potentialreviewer_value: fresh._wmkf_potentialreviewer_value },
        templateType: 'materials',
        sentAt: release.sent_at instanceof Date ? release.sent_at.toISOString() : release.sent_at,
        actingUserSystemId,
      });
      reviewerRecorded = Boolean(await materialsReleaseStore.recordMaterialsRelease(suggestionId));
    }
  } catch (err) {
    console.warn(`[mark-materials-delivered] reviewer bookkeeping unavailable for ${suggestionId}:`, err.message);
  }

  if (!reviewerRecorded && !(await materialsReleaseStore.closeSentMaterialsRelease({ suggestionId, actorProfileId }))) {
    // Another path finished or changed the release first; report what it is now.
    const now = await materialsReleaseStore.getMaterialsRelease(suggestionId);
    if (now?.state !== 'recorded') {
      throw new ServiceHttpError('The materials release changed while it was being marked. Reload and try again.', {
        httpStatus: 409,
        body: { ok: false, reason: 'release_changed', state: now?.state || null,
          error: 'The materials release changed while it was being marked. Reload and try again.' },
      });
    }
  }

  try {
    await AlertService.autoResolve(materialsReleaseStore.materialsReleaseAlertKey(suggestionId));
  } catch (err) {
    console.warn(`[mark-materials-delivered] alert settlement unavailable for ${suggestionId}:`, err.message);
  }
  return { ok: true, reviewerRecorded };
}
