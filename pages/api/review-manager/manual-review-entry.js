/**
 * GET/POST /api/review-manager/manual-review-entry
 *
 * Authenticated staff rescue for recording a complete structured review when
 * the external reviewer portal cannot be used. GET returns the live form and
 * version for one accepted, outstanding suggestion; POST commits the complete
 * answer snapshot and parent receipt atomically.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import {
  getManualReviewEntryForm,
  submitManualReviewEntry,
} from '../../../lib/services/review-manager/manual-review-entry-service';

function sendError(res, error) {
  if (error instanceof ServiceHttpError) {
    return res.status(error.httpStatus).json(error.body ?? { ok: false, reason: error.message });
  }
  console.error('[manual review entry] error:', error);
  return res.status(500).json({ ok: false, reason: 'server_error' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  if (req.method === 'GET') {
    const { suggestionId } = req.query || {};
    if (!isGuid(suggestionId)) {
      return res.status(400).json({
        ok: false,
        reason: 'validation',
        message: 'suggestionId must be a valid GUID.',
      });
    }
    return withDalContext('manual-review-entry', async () => {
      try {
        return res.status(200).json(await getManualReviewEntryForm({ suggestionId }));
      } catch (error) {
        return sendError(res, error);
      }
    });
  }

  const { suggestionId, answers, setVersion } = req.body || {};
  if (!isGuid(suggestionId)
    || !answers || typeof answers !== 'object' || Array.isArray(answers)
    || typeof setVersion !== 'string' || setVersion.length === 0) {
    return res.status(400).json({
      ok: false,
      reason: 'validation',
      message: 'suggestionId, answers, and setVersion are required.',
    });
  }

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;
  return withDalContext('manual-review-entry', async () => {
    try {
      return res.status(200).json(await submitManualReviewEntry({
        suggestionId,
        answers,
        setVersion,
        actingUserSystemId,
      }));
    } catch (error) {
      return sendError(res, error);
    }
  });
}
