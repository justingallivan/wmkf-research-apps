/**
 * Pure classification of the stored reviewer magic-link authority.
 *
 * This intentionally answers only whether the stored token metadata represents
 * a live link. Reminder-specific deadline coverage belongs in
 * `reviewer-reminder-eligibility.js` so UI actions such as Revoke remain
 * available for every live token.
 */
export function deriveReviewerTokenState(row, { nowMs = Date.now() } = {}) {
  if (row?.wmkf_externaltokenrevoked === true) return 'revoked';

  const hash = typeof row?.wmkf_externaltokenhash === 'string'
    ? row.wmkf_externaltokenhash.trim()
    : '';
  if (!hash) return 'not_minted';

  const expiryMs = Date.parse(row?.wmkf_externaltokenexpires || '');
  if (!Number.isFinite(expiryMs)) return 'invalid';
  if (expiryMs <= nowMs) return 'expired';
  return 'active';
}
