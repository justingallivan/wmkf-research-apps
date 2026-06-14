/**
 * Proposal readiness for external reviewers — the single predicate that gates the
 * reviewer "hold step" (docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md, chunk 2).
 *
 * "Ready" means a proposal has cleared staff QA and been RELEASED to reviewers —
 * i.e. reviewers should see the full finalize/accept form (COI/AI acks + payment).
 * "Not ready" means reviewers should only be asked to HOLD (agree in principle).
 *
 * Consumed by BOTH layers (so they can never disagree):
 *   - the view dispatch (`context.js::computeEngagementState`) — which screen renders
 *   - the write boundary (`respond.js`, chunk 3) — whether a finalize accept is allowed
 *
 * ── GO-LIVE GATE (read before changing the return value) ───────────────────────
 * Two things are not done yet:
 *   1. The real post-QA "release to reviewers" signal is OPEN (Justin/Connor). The
 *      Phase-II intake writes `wmkf_phaseiisubmittedat` on submit — that marks RECEIPT
 *      / start of the QA window, NOT readiness. There is no release field yet.
 *   2. The hold UI (HoldView, chunk 4) and hold emails (chunk 6) are not built.
 *
 * Until BOTH land, this returns `true` for every proposal — so reviewers go straight
 * to the existing finalize/accept form exactly as today (zero behavior change; no
 * `held` rows exist yet because chunk 3 isn't built). Returning `true` here means
 * "treat as ready ⇒ bypass hold."
 *
 * The go-live step is to flip this to the real signal (false until staff release).
 * DO NOT flip it before chunk 4 ships: with no `hold-invite`/`held` view wired into
 * the portal Dispatcher, a not-ready fresh reviewer would hit the UnknownState screen
 * instead of the accept form. When wiring the real signal, replace the body below and
 * read the released-state field off `request`.
 */
export function isProposalReadyForReviewers(request) {
  // GO-LIVE GATE — see module header. No release signal wired + hold UI not built ⇒
  // treat every proposal as ready (bypass hold), preserving today's direct-to-accept
  // flow. `request` is the akoya_request row; it will carry the release signal once
  // wired (e.g. a staff "released to reviewers" field).
  void request;
  return true;
}
