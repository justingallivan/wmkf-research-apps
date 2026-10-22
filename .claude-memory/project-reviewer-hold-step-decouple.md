---
name: project-reviewer-hold-step-decouple
description: Current reviewer engagement contract: one accept/decline decision; the retired hold/finalize path must not be rebuilt, and post-accept work runs through the durable acceptance drain.
metadata:
  type: project
  status: active
  scope: reviewer-finder
  last_verified: 2026-10-22 via respond-service response locks/withdrawal and acceptance-drain source; retired hold history retained
---

## Recall Rule

Read before changing the external reviewer accept flow, engagement states,
honorarium onboarding, acceptance confirmation, or reviewer removal. Preserve the
single-decision contract and the durable acceptance-job seam; do not restore a
reviewer-facing hold/finalize step.

## Current contract

The external response API accepts exactly `accept` or `decline`.
`Stage2aView` sends `action:'accept'` with the required acknowledgements, contact
confirmation, board identity, and honorarium choice/address. There is no separate
"willing," `hold`, or `finalize` reviewer action.

On a fresh accept, the route validates and commits the engagement state, stages a
`reviewer_acceptance_jobs` row, and returns without waiting for every downstream
side effect. `lib/services/reviewer-acceptance-drain.js` durably performs the
post-accept work, including honorarium onboarding, board-identity capture, and
the acceptance-confirmation email. Preserve this queue boundary and its retry/
claim semantics if the accept flow changes.

The acceptance confirmation carries the review due date and calendar attachment
when available. Proposal/material delivery is a staff readiness event, not a
second reviewer decision. In the steady-state release-on-accept case, materials
can accompany the accepted reviewer without introducing another acceptance state.

## Honorarium posture

The portal may create the no-BILL reviewer honorarium request at accept while
`BILL_ONBOARDING_DEFERRED=true` keeps payment automation off. Capture-only remains
the explicit safety mode. Current configuration and payment constraints live in
`docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md` and
`project-honorarium-payment-landscape`; do not infer payment completion from an
accepted reviewer or a created honorarium request.

## Retired path

The `hold`/`finalize` templates, UI, response actions, proposal-readiness helper,
and readiness-gated reviewer dispatch were removed in S279. The historical
`held=100000004` option and `wmkf_heldat` column remain only for read safety; old
held rows fall through to the current accept form. The implementation history is
preserved in `docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md` and
`docs/REVIEWER_ENGAGEMENT_SPEC.md`.

## Post-accept exit

Before materials have been released and before any review receipt, an accepted
reviewer may decline through the portal. The ETag-bound response changeset
deletes only that engagement's exact linked honorarium request. Acceptance jobs
are cancelled where possible; the drain rechecks state after honorarium creation
and compensates for a racing withdrawal. The person and suggestion history remain.
See [[project-reviewer-accept-decline-links]].

After materials release or review receipt, portal response changes are locked;
the reviewer contacts the PD. Staff withdrawal and foundation-initiated release
have distinct financial semantics: withdrawal deletes the exact linked request,
while release retains and withdraws a safely open honorarium. Do not generalize
this bounded cleanup into a reset of submitted-review or financial history.
Closeout eligibility remains separate from Finance's final remit authority; see
`project-reviewer-closeout-payability`.

**Historical boundary:** the July 22 instruction prohibited portal teardown and
routed later exits to the PD. July 24 self-withdrawal (`08c718d3a`) and staff
withdrawal (`a4fdd7366`) superseded that blanket prohibition; the single-decision
and retired hold/finalize rationale remains in force.

## Ground truth

- `lib/services/external-review/respond-service.js`
- `lib/services/reviewer-acceptance-drain.js`
- `shared/components/external/Stage2aView.js`
- `lib/services/reviewer-acceptance-email.js`
- `lib/external/calendar-invite.js`
- `docs/REVIEWER_ENGAGEMENT_SPEC.md`
