/**
 * remove-reviewer-confirm — pure (React-free) copy for the "Remove from this
 * request/proposal" confirm dialogs in ReviewerManagePanel and
 * ReviewerInvitePanel.
 *
 * Why: "Remove" soft-deletes the engagement row
 * (`suggestionAdapter.softDelete`: wmkf_selected/accepted/declined/responsetype
 * /reviewstatus all reset). For a reviewer who ACCEPTED and later backed out,
 * that erases the acceptance from the request's history, so the row reads as
 * "never engaged" instead of "withdrew". The dedicated action for that case is
 * "Record reviewer withdrawal" (terminal-transition `withdrew`), which keeps the
 * acceptance and records the exit. Request 1002833, 2026-09-02: an accepted
 * reviewer with materials sent was removed instead of withdrawn, and the
 * withdrawal path is unreachable once accepted is cleared. This module makes
 * the confirm dialog steer staff to the right action; it does not block Remove.
 */

/**
 * Where the withdrawal action lives relative to the dialog the staffer is in.
 * - 'same-menu': ReviewerManagePanel row menu, which also offers
 *   "Record reviewer withdrawal" for accepted, not-yet-submitted reviewers.
 * - 'track-reviewers': ReviewerInvitePanel, which has no withdrawal action;
 *   point to the reviewer's row in Track Reviewers.
 */
const WITHDRAWAL_LOCATION = Object.freeze({
  'same-menu': 'in this same menu',
  'track-reviewers': 'on their row in Track Reviewers',
});

/**
 * Warning paragraph prepended to the Remove confirm when the reviewer has
 * accepted. Returns '' when not accepted so callers can concatenate blindly.
 *
 * @param {Object} args
 * @param {boolean} args.accepted - reviewer has accepted (Invite: `c.accepted`;
 *   Manage: `reviewer.responseType === 'accepted'`, the direct accept signal
 *   that only decline/withdraw/remove clear).
 * @param {'same-menu'|'track-reviewers'} args.withdrawalLocation
 * @returns {string}
 */
export function acceptedReviewerRemoveWarning({ accepted, withdrawalLocation }) {
  if (!accepted) return '';
  const where = WITHDRAWAL_LOCATION[withdrawalLocation] || WITHDRAWAL_LOCATION['track-reviewers'];
  return 'This reviewer accepted the invitation. Removing them erases that acceptance '
    + 'from this request, so it will look as if they were never engaged.\n\n'
    + `If they backed out after accepting, click Cancel and use “Record reviewer withdrawal” ${where} `
    + 'so the withdrawal stays on record.\n\n';
}
