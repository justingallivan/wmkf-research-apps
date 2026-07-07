/**
 * Review Manager — update a proposal's abstract of record.
 *
 * POST /api/review-manager/update-abstract
 *   body: { requestId: <GUID>, abstract: <string>, expectedCurrent?: <string> }
 *   → { success: true, requestId, abstract }
 *
 * A program director edits the canonical `wmkf_abstract` on `akoya_requests`
 * from the invite flow when the stored abstract is a hard-wrapped block that
 * would render with stray line breaks (see lib/utils/abstract-format.js). The
 * field is written once by GoApply at submission and is not re-synced, so the
 * edit is durable and fixes these reviewer invites plus any later read that
 * starts from `wmkf_abstract`; it does NOT retroactively rewrite an
 * already-generated derived version (`wmkf_abstractformatted`/`wmkf_abstractapproved`).
 * `expectedCurrent` (the text the editor was seeded from) makes the save an
 * optimistic compare-and-set — a concurrent edit yields 409.
 *
 * Thin route shell (Route→Service Consolidation Plan): method dispatch → auth
 * guard → input validation → withDalContext → one service call → result/error→
 * HTTP mapping. All business logic lives in the service.
 *
 * Auth: same boundary as the rest of the review-manager reviewer surface —
 * requireAppAccess('review-manager','reviewers') + withDalContext (reviewer
 * outreach is a foundation-owned, staff-shared workflow, not user-private).
 * requestId is GUID-validated before it reaches a Dataverse selector
 * (trust-boundary-guid). The abstract is staff-authored (trusted actor).
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { updateAbstract } from '../../../lib/services/review-manager/update-abstract-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
  if (!isGuid(requestId)) {
    return res.status(400).json({ error: 'requestId must be a GUID' });
  }

  const abstract = req.body?.abstract;
  if (typeof abstract !== 'string') {
    return res.status(400).json({ error: 'abstract string is required' });
  }

  // Optional optimistic-concurrency token: the abstract text the editor was
  // seeded from. Forwarded only when the client sends a string; a non-string
  // (absent) simply skips the compare-and-set in the service.
  const expectedCurrent = typeof req.body?.expectedCurrent === 'string' ? req.body.expectedCurrent : undefined;

  return withDalContext('review-manager-update-abstract', async () => {
    try {
      const result = await updateAbstract({ requestId, abstract, expectedCurrent, actingUserSystemId });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('update-abstract error:', error);
      return res.status(500).json({ error: 'Failed to update abstract' });
    }
  });
}
