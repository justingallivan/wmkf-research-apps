/**
 * Pure derivation of the external-reviewer engagement state from a suggestion
 * row. Extracted from the context route so multiple routes (context, draft, and
 * future submit) can share ONE source of truth for view dispatch + the
 * reversibility lock without importing a page route's full I/O dependency graph
 * (token verifier, Dynamics, Graph, SharePoint, policy, rate-limit). Keeping it
 * dependency-free also lets it be unit-tested without stubbing those modules.
 *
 * No I/O — given a suggestion row, returns the engagement view. The single
 * import is a frozen constant map (no I/O, no dependency graph), taken instead
 * of a local copy so the terminal option values cannot drift from the adapter
 * and the provisioning script.
 */

import { TERMINAL_REVIEW_STATUS_VALUES } from '../../shared/config/reviewerStatus';

// wmkf_reviewstatus / wmkf_responsetype picklist values. The reversibility lock
// kicks in at materials_sent.
const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const RESPONSE_TYPE_WITHDRAWN_SUFFICIENT = 100000003;

// Post-accept terminal statuses (withdrew / released). These are numerically
// ABOVE materials_sent, so the `>= REVIEW_STATUS_MATERIALS_SENT` branch below
// would classify them as active stage2b reviewers and hand a withdrawn reviewer
// the live review form — fabricating exactly the review history the terminal
// status exists to prevent (Codex S369 adversarial finding, confirmed). They
// must therefore be tested BEFORE that numeric comparison.
const TERMINAL_REVIEW_STATUSES = new Set(Object.values(TERMINAL_REVIEW_STATUS_VALUES));

/**
 * Compute the high-level engagement state from suggestion fields. Drives
 * page-level view dispatch and the reversibility lock.
 *
 * `view`:
 *   stage2a   — pre-materials, reviewer can still accept/decline/flip
 *   accepted-pre-materials — accepted but materials not yet sent (post-accept screen)
 *   declined  — reviewer declined (post-decline screen)
 *   stage2b   — materials sent; existing review-form view
 *   submitted — review received; post-submission view
 *   withdrawn-sufficient — terminal, "no longer needed" copy
 *
 * `canFlipState`: true if Stage 2a's accept/decline buttons should still
 * permit transitions. Locks once review status reaches materials_sent.
 */
export function computeEngagementState(s) {
  const responseType = s.wmkf_responsetype ?? null;
  const reviewStatus = s.wmkf_reviewstatus ?? null;
  const submitted = !!s.wmkf_reviewreceivedat;
  const accepted = s.wmkf_accepted === true;
  const declined = s.wmkf_declined === true;

  // The lock: once staff have released materials, reviewer self-service flip ends.
  const canFlipState = (reviewStatus === null || reviewStatus < REVIEW_STATUS_MATERIALS_SENT)
    && !TERMINAL_REVIEW_STATUSES.has(reviewStatus)
    && responseType !== RESPONSE_TYPE_WITHDRAWN_SUFFICIENT;

  let view;
  if (responseType === RESPONSE_TYPE_WITHDRAWN_SUFFICIENT) {
    view = 'withdrawn-sufficient';
  } else if (submitted) {
    view = 'submitted';
  } else if (TERMINAL_REVIEW_STATUSES.has(reviewStatus)) {
    // A post-accept terminal engagement reuses the existing terminal view
    // rather than introducing a new `view` value: every consumer already
    // handles 'withdrawn-sufficient' (context-service, draft, submit, and the
    // portal page copy), so a new enum member would risk an unhandled view
    // rendering a blank page — a worse failure than slightly generic copy.
    // Placed AFTER `submitted` so an already-submitted row still shows its
    // submission; the terminal-transition service refuses submitted rows, so
    // that combination is unreachable through supported paths anyway.
    view = 'withdrawn-sufficient';
  } else if (reviewStatus !== null && reviewStatus >= REVIEW_STATUS_MATERIALS_SENT) {
    view = 'stage2b';
  } else if (accepted) {
    view = 'accepted-pre-materials';
  } else if (declined) {
    view = 'declined';
  } else {
    // No active terminal/accepted/declined state. Historical `held` values fall
    // through here so those reviewers can complete the single accept flow.
    view = 'stage2a';
  }

  return {
    view,
    canFlipState,
    accepted,
    declined,
    responseType,
    responseReceivedAt: s.wmkf_responsereceivedat || null,
    reviewStatus,
  };
}
