/**
 * Reviewer Lifecycle Stage 6D — shared `skipped[].reason` vocabulary for
 * `POST /api/review-manager/send-emails`.
 *
 * `SEND_SKIP_REASON` is the single named producer of every value the send
 * service pushes as `skipped[].reason`; the service imports and pushes
 * `SEND_SKIP_REASON.x` everywhere instead of a bare string literal, so a new
 * reason cannot bypass this file. `SEND_SKIP_REASON_LABEL` is the matching
 * consumer — user-facing copy for both modals' sent-summary lists.
 * `scripts/check-status-enum-parity.js` enforces every produced value has a
 * label (rule: subset — the label map may also carry render-time `d.skipped`
 * values the invite modal labels separately; 6D does not merge the two
 * vocabularies).
 *
 * Both object literals below must stay bare `{ ... }` literals (no
 * `Object.freeze`, no computed values) — the parity gate's extractors match
 * `NAME = { ... }` textually and would silently stop extracting otherwise.
 */

export const SEND_SKIP_REASON = {
  no_email: 'no_email',
  program_director_sender_unavailable: 'program_director_sender_unavailable',
  not_accepted: 'not_accepted',
  materials_already_sent: 'materials_already_sent',
  materials_release_ineligible: 'materials_release_ineligible',
  address_conflict_pending: 'address_conflict_pending',
  email_research_only: 'email_research_only',
  email_unconfirmed: 'email_unconfirmed',
  already_invited: 'already_invited',
  unresolved_placeholder: 'unresolved_placeholder',
  missing_secure_link: 'missing_secure_link',
  // Literal, not an imported identifier reference: the parity gate's
  // extractor only reads quoted string values, so aliasing this to the
  // `INVALID_SECURE_LINK_SKIP_REASON` import would hide it from the gate.
  // Identity with that constant is pinned by a unit test instead.
  invalid_secure_link: 'invalid_secure_link',
  draft_stale: 'draft_stale',
  draft_fingerprint_missing: 'draft_fingerprint_missing',
};

export const SEND_SKIP_REASON_LABEL = {
  no_email: 'No email address on file.',
  program_director_sender_unavailable: 'The assigned Program Director\'s sender mailbox is unavailable.',
  not_accepted: 'The reviewer has not accepted — materials were withheld.',
  materials_already_sent: 'Materials were already sent to this reviewer.',
  materials_release_ineligible: 'The reviewer is not currently awaiting materials.',
  address_conflict_pending: 'The stored and newly found addresses conflict and need review.',
  email_research_only: 'The address is research-only, not invite-ready.',
  email_unconfirmed: 'The address has not been confirmed.',
  already_invited: 'This reviewer was already invited.',
  unresolved_placeholder: 'The invitation has an unfilled field placeholder — not sent.',
  missing_secure_link: 'The invitation is missing its secure link — not sent.',
  invalid_secure_link: 'The invitation has an invalid secure link — restore the external link placeholder in the template.',
  draft_stale: 'The reviewer or proposal details changed after this preview was rendered. '
    + 'Nothing was sent to this reviewer — reopen the preview to render a fresh draft.',
  draft_fingerprint_missing: 'This draft was rendered before the current version of the app. '
    + 'Nothing was sent — reopen the preview to render it again.',
};
