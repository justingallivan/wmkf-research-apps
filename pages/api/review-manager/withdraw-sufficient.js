/**
 * Review Manager — PD selective decline ("no longer needed") (reviewer-engagement Phase 4)
 *
 * POST /api/review-manager/withdraw-sufficient
 *   body: { requestId: <GUID>, suggestionIds: <GUID[]>,
 *           overrides?: { <suggestionId>: { subject?, bodyText?, to? } } }
 *   → { ok: true, withdrawn: N, results: [{ suggestionId, status }] }
 *
 * `overrides` carries complete staff-reviewed copy plus the previewed recipient.
 * The recipient is always re-derived server-side; `to` is only an expected-value
 * binding and can never redirect the email. Omitting the override reproduces the
 * original fixed-template behavior.
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
  // carried into the service. Mixed-case GUID keys are canonicalized to the
  // submitted suggestionId. Values are reduced to own string subject/bodyText/to
  // properties; `to` is an expected-recipient binding, never a send destination.
  let overrides = null;
  const rawOverrides = req.body?.overrides;
  if (rawOverrides !== undefined && rawOverrides !== null) {
    if (typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) {
      return res.status(400).json({ error: 'overrides must be an object keyed by suggestionId' });
    }
    const selected = new Map(suggestionIds.map((id) => [id.toLowerCase(), id]));
    overrides = Object.create(null);
    for (const [key, value] of Object.entries(rawOverrides)) {
      const canonicalId = selected.get(String(key).toLowerCase());
      if (!isGuid(key) || !canonicalId) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = {};
      if (Object.prototype.hasOwnProperty.call(value, 'subject') && typeof value.subject === 'string') {
        entry.subject = value.subject;
      }
      if (Object.prototype.hasOwnProperty.call(value, 'bodyText') && typeof value.bodyText === 'string') {
        entry.bodyText = value.bodyText;
      }
      if (Object.prototype.hasOwnProperty.call(value, 'to') && typeof value.to === 'string') {
        entry.to = value.to;
      }
      if (Object.keys(entry).length > 0) overrides[canonicalId] = entry;
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
