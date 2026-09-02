/**
 * POST /api/review-manager/revoke-token
 *
 * Sets `wmkf_externaltokenrevoked = true` on the suggestion. The presented
 * token's hash stays in place so audit logs can still identify which token
 * was active at revocation time.
 *
 * Body: { suggestionId: string }
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { revoke } from '../../../lib/external/token-lifecycle';
import ReviewDraftService from '../../../lib/services/review-draft-service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    const { suggestionId } = req.body || {};
    if (!suggestionId || typeof suggestionId !== 'string') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
    }
    // GUID-validate before it becomes a Dataverse record-id selector (revoke →
    // updateRecord) and before the draft cleanup hits deleteBySuggestion's UUID
    // assertion. Mirrors regenerate-token; a non-GUID is a clean 400, not a 500.
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
    }

    try {
      // S333 Stage 4b: trust-model tightening — this route now establishes
      // the trusted context itself (the sole caller), matching Route→Service
      // Decision 3 ("services assume a trusted DAL context already exists;
      // establishment stays at the route"). Label byte-preserved from the
      // wrap that used to live inside revoke() itself.
      await withDalContext('external-token-revoke', () => revoke(suggestionId, { actingUserSystemId }));
    } catch (e) {
      if (/update.*failed.*404/i.test(e.message || '')) {
        return res.status(404).json({ ok: false, reason: 'not_found' });
      }
      throw e;
    }

    // Revoke is a leak/compromise action — drop any in-progress review draft so a
    // stale (possibly tampered) draft can't resurface if a new token is later
    // minted for this suggestion (drafts key on the stable suggestion_id, not the
    // token; plan §9 #draft-token / Codex P1-4). Best-effort: the revoke already
    // succeeded, and a leftover draft is otherwise swept by GC, so a delete
    // failure must not fail the revoke. Regeneration deliberately preserves a
    // matching draft and is not a cleanup fallback.
    //
    // ACCEPTED RESIDUAL (Codex S302 P1): a sub-second TOCTOU exists — a draft PUT
    // whose verifySuggestionToken passed JUST before this revoke flipped the flag
    // can land its upsert AFTER this delete, resurrecting the draft under a now-
    // dead token. Not closed because the resurrected draft is harmless: the dead
    // token can't GET it back or submit it, and GC eventually sweeps it.
    // A pre-write re-check in the draft route would only narrow (not close) the
    // window at the cost of a Dataverse read on every autosave.
    try {
      await ReviewDraftService.deleteBySuggestion(suggestionId);
    } catch (e) {
      console.error('[review-manager revoke-token] draft cleanup failed (non-fatal):', e.message);
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[review-manager revoke-token] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
