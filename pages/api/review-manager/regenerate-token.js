/**
 * POST /api/review-manager/regenerate-token
 *
 * Mint a fresh external-access token for a suggestion and persist its hash.
 * Use cases: reviewer lost the email, link was leaked, or the prior token
 * was revoked and the reviewer is now back in good standing.
 *
 * Body: { suggestionId: string, expiresAt?: ISO8601 }
 *
 * `expiresAt` defaults to 90 days from now if omitted. The eventual UI will
 * surface a date picker (review-due-date + 4 weeks grace per plan); until
 * that ships, callers can supply any future date explicitly.
 *
 * Response: { ok: true, url, expiresAt, jti }
 *
 * Side-effect: any prior outstanding token for this suggestion immediately
 * stops verifying — the verifier compares the presented JWT's hash against
 * the stored hash, and we just overwrote it.
 */

import { requireAppAccess } from '../../../lib/utils/auth';
import { isGuid } from '../../../lib/utils/guid';
import { mintAndStore } from '../../../lib/external/token-lifecycle';
import { DynamicsService } from '../../../lib/services/dynamics-service';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { APPLICANT_DISPOSITION_EXCLUDED } from '../../../lib/dataverse/adapters/reviewer-suggestion';

const DEFAULT_TTL_DAYS = 90;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, reason: 'method_not_allowed' });
  }

  const access = await requireAppAccess(req, res, 'review-manager', 'reviewers');
  if (!access) return;

  const actingUserSystemId = access.session?.user?.dynamicsSystemuserId || null;

  try {
    const { suggestionId, expiresAt: rawExpires } = req.body || {};
    if (!suggestionId || typeof suggestionId !== 'string') {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId required.'] });
    }
    // GUID-validate before it becomes a Dataverse record-id selector (getRecord
    // interpolates it raw into the request URL).
    if (!isGuid(suggestionId)) {
      return res.status(400).json({ ok: false, reason: 'validation', errors: ['suggestionId must be a valid GUID.'] });
    }

    let expiresAt;
    if (rawExpires) {
      expiresAt = new Date(rawExpires);
      if (Number.isNaN(expiresAt.getTime())) {
        return res.status(400).json({ ok: false, reason: 'validation', errors: ['expiresAt must be a valid ISO date.'] });
      }
      if (expiresAt.getTime() <= Date.now()) {
        return res.status(400).json({ ok: false, reason: 'validation', errors: ['expiresAt must be in the future.'] });
      }
    } else {
      expiresAt = new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
    }

    // Look up the suggestion to get its requestId — required for token payload.
    let suggestion;
    try {
      suggestion = await bypassDynamicsRestrictions('regenerate-token-lookup', () =>
        DynamicsService.getRecord('wmkf_appreviewersuggestions', suggestionId, {
          select: 'wmkf_appreviewersuggestionid,_wmkf_request_value,wmkf_applicantdisposition',
        }),
      );
    } catch (e) {
      if (/Get record failed \(404\)/.test(e.message || '')) {
        return res.status(404).json({ ok: false, reason: 'not_found' });
      }
      throw e;
    }

    // Fail closed on an applicant-"excluded" engagement. This is a direct-mint
    // path (mintAndStore, not ensureToken), so it carries its own disposition
    // chokepoint — never regenerate a magic link for a reviewer the applicant
    // asked us not to use (Phase 0.7).
    if (suggestion?.wmkf_applicantdisposition === APPLICANT_DISPOSITION_EXCLUDED) {
      return res.status(409).json({ ok: false, reason: 'excluded' });
    }

    const requestId = suggestion?._wmkf_request_value;
    if (!requestId) {
      return res.status(404).json({ ok: false, reason: 'not_found' });
    }

    const result = await mintAndStore({ suggestionId, requestId, expiresAt, actingUserSystemId });

    return res.status(200).json({
      ok: true,
      url: result.url,
      expiresAt: result.expiresAt.toISOString(),
      jti: result.jti,
    });
  } catch (error) {
    console.error('[review-manager regenerate-token] error:', error);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
}
