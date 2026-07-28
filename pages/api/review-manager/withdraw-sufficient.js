/**
 * Review Manager — PD selective decline ("no longer needed") (reviewer-engagement Phase 4)
 *
 * POST /api/review-manager/withdraw-sufficient
 *   body: { requestId: <GUID>, suggestionIds: <GUID[]>,
 *           overrides?: { <suggestionId>: { subject?, bodyText? } } }
 *   → { ok: true, withdrawn: N, results: [{ suggestionId, status }] }
 *
 * `overrides` carries staff edits from the review-before-send modal (rendered by
 * POST /api/review-manager/render-withdraw-emails). Subject/body only — the
 * recipient is always re-derived server-side, so an edited draft cannot redirect
 * the email. Omitting it reproduces the original fixed-template behavior.
 *
 * Thin route shell (Route→Service Consolidation Plan, Stage 1 pilot): method
 * dispatch → auth guard → input validation → withDalContext → one service
 * call → result/error→HTTP mapping. All business logic (still-pending guard,
 * state-before-email ordering, If-Match TOCTOU close, per-suggestion partial
 * success) lives in lib/services/review-manager/withdraw-sufficient-service.js.
 *
 * Auth: review-manager 'reviewers' (same staff-shared boundary as the rest of
 * the surface). requestId + every suggestionId are GUID-validated before use.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid, allGuids } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../../lib/services/service-http-error';
import { withdrawSufficient } from '../../../lib/services/review-manager/withdraw-sufficient-service';

const MAX_BATCH = 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;
  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

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

  // Staff edits, keyed by suggestion. Keys are GUID-validated and narrowed to the
  // selected suggestionIds, so a key for an unrelated row is dropped rather than
  // carried into the service. Values are reduced to subject/bodyText strings —
  // never a recipient — so an edited draft cannot redirect the email.
  let overrides = null;
  const rawOverrides = req.body?.overrides;
  if (rawOverrides !== undefined && rawOverrides !== null) {
    if (typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) {
      return res.status(400).json({ error: 'overrides must be an object keyed by suggestionId' });
    }
    const selected = new Set(suggestionIds.map((id) => id.toLowerCase()));
    overrides = {};
    for (const [key, value] of Object.entries(rawOverrides)) {
      if (!isGuid(key) || !selected.has(key.toLowerCase())) continue;
      if (!value || typeof value !== 'object') continue;
      const entry = {};
      if (typeof value.subject === 'string') entry.subject = value.subject;
      if (typeof value.bodyText === 'string') entry.bodyText = value.bodyText;
      if (Object.keys(entry).length > 0) overrides[key] = entry;
    }
  }

  return withDalContext('review-manager-withdraw-sufficient', async () => {
    try {
      const result = await withdrawSufficient({ requestId, suggestionIds, actingUserSystemId, overrides });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServiceHttpError) {
        return res.status(error.httpStatus).json(error.body ?? { error: error.message });
      }
      console.error('withdraw-sufficient error:', error);
      return res.status(500).json({ error: 'Failed to withdraw reviewers' });
    }
  });
}
