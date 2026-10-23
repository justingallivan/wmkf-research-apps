/**
 * Review Manager — render the "no longer needed" courtesy emails for staff review
 *
 * POST /api/review-manager/render-withdraw-emails
 *   body: { requestId: <GUID>, suggestionIds: <GUID[]> }
 *   → { ok: true, drafts: [{ suggestionId, status, name?, to?, from?,
 *                            senderId?, subject?, bodyText?,
 *                            templateSource?, templateNotice? }] }
 *
 * Read-only counterpart to POST /api/review-manager/withdraw-sufficient, mirroring
 * the existing render-emails → send-emails split: this renders what WOULD be sent
 * so staff can edit it, and withdraws/sends nothing. Staff then post their edits
 * back to withdraw-sufficient as `overrides`. Recipient and sender identity
 * values are expected-value guards: the send re-derives both and refuses a
 * changed value before the lifecycle write.
 *
 * Thin route shell: method dispatch → auth guard → input validation →
 * withDalContext → one service call → result/error→HTTP mapping. The per-row
 * guards (belongs-to-request, still-pending) live in the service and are the same
 * ones the send applies, so a draft can never be offered for a row the send
 * would refuse.
 *
 * Auth: review-manager 'reviewers', then lead PD for every target or superuser
 * (authorizeReviewerRequestMutation), matching withdraw-sufficient and the
 * accepted-release preview. The draft starts from the sending PD's saved
 * wording, so it is not shown to other staff. requestId + every suggestionId
 * are GUID-validated before use.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { actorRefFromSession } from '../../../lib/utils/actor-ref';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { renderWithdrawPreviews } from '../../../lib/services/review-manager/withdraw-sufficient-service';
import { authorizeReviewerRequestMutation } from '../../../lib/services/reviewer-request-authorization';

const MAX_BATCH = 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  const suggestionIds = Array.isArray(req.body?.suggestionIds) ? req.body.suggestionIds : null;
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }
  if (!suggestionIds || suggestionIds.length === 0) {
    return res.status(400).json({ error: 'suggestionIds (non-empty array) is required' });
  }
  if (suggestionIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `at most ${MAX_BATCH} suggestionIds per request` });
  }
  if (!allGuids(suggestionIds)) {
    return res.status(400).json({ error: 'suggestionIds must all be valid GUIDs' });
  }

  return withDalContext('review-manager-render-withdraw-emails', async () => {
    try {
      await authorizeReviewerRequestMutation({
        profileId: access.profileId,
        callerSystemId: actorRefFromSession(access.session),
        requestIds: [requestId],
        suggestionIds,
      });
      const result = await renderWithdrawPreviews({ requestId, suggestionIds });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json({ error: error.message });
      }
      console.error('render-withdraw-emails error:', error);
      return res.status(500).json({ error: 'Failed to render withdrawal emails' });
    }
  });
}
