---
name: project-reviewer-hold-step-decouple
description: Reviewer invite-to-accept direction (REVISED S279, supersedes the S256 deferral plan). Collapse invite-to-hold-to-finalize-to-accept into ONE final Accept that onboards up front: COI/AI acks plus honorarium opt-in/address. As of the 2026-07-01 no-BILL decision, the forward plan is app-created honorarium request with BILL deferred; capture-only remains the safety/off mode. Proposal/materials are delivered separately when ready. Post-accept exit is out-of-band (personal email to PD, renegotiate due date, or manual Remove that also resets engagement flags). No separate willing/held or finalize reviewer step.
metadata:
  type: project
  status: active
  scope: reviewer-finder
  last_verified: 2026-07-02 against honorarium strategy doc; accept-flow direction still from S279
---

## Recall Rule

Read when planning or building the external reviewer invite→accept flow, the Stage-2a accept
(`pages/api/external/review/[token]/respond.js`), honorarium onboarding at accept, the reviewer
engagement state machine, reviewer scheduling / `.ics`, the reviewer email templates, or the PD
remove-reviewer action.

## DIRECTION (REVISED S279 — supersedes the S256 plan at the bottom)

Justin confirmed: onboarding moves UP FRONT, and the multi-step engagement collapses to ONE reviewer
action. The earlier "park a lightweight slate now, collect acks/payment/proposal at a later finalize"
model is dropped.

**The single Accept (the only reviewer decision):**
- "Yes, I'll review" + COI/AI acknowledgements + honorarium opt-in.
- If honorarium wanted -> collect mailing address. As of the 2026-07-01
  no-BILL-cycle decision, the forward target is to run `ensureHonorariumOnboarding`
  with the three discriminator GUIDs set and `HONORARIUM_ONBOARDING_DEFERRED`
  unset, so accepting creates the honorarium `akoya_request` directly while
  `BILL_ONBOARDING_DEFERRED=true` keeps BILL/payment offline. See
  `docs/HONORARIUM_PORTAL_CREATION_STRATEGY.md`.
- Capture-only remains the safety/off mode: `HONORARIUM_ONBOARDING_DEFERRED=true`
  or missing discriminator GUIDs makes `ensureHonorariumOnboarding()` ensure the
  contact + PATCH the address, then stop before creating the honorarium request
  or calling BILL. This was the explicit 2026-06-22 production lock before the
  no-BILL creation decision.
- Full BILL onboarding is still later: after the no-BILL creation cycle, keeping
  the honorarium GUIDs configured but unsetting `BILL_ONBOARDING_DEFERRED` and
  setting BILL credentials re-enables the BILL tail.
- Reviewer receives an acceptance-confirmation email carrying an `.ics` save-the-date keyed to
  `wmkf_reviewduedate` (`lib/external/calendar-invite.js`, rewired off the removed hold template;
  rekey `meetingDate` → `reviewDueDate`). This reviewer-facing confirmation now sends on fresh accept;
  preserve the fire-once behavior if the acceptance flow changes.

**Acceptance is FINAL at this step.** There is NO separate "willing/agree-in-principle" state and NO
separate "finalize" reviewer step — those were artifacts of the S256 deferral plan and disappear once
acks/payment are collected up front. The only thing that stays time-separated is WHEN the proposal
becomes available, which is a **staff/readiness event** (this cycle: PD "Release to reviewers" after a
QA pass; steady state: immediately on accept), NOT a second reviewer action.

**Post-accept exit** (a reviewer who later can't review): OUT-OF-BAND, not a portal self-service
decline. The reviewer emails the PD; the PD may renegotiate the due date; if no compromise, the PD
manually removes them via the workbench Remove button. The existing Remove
(`my-candidates` DELETE → `softDelete`) clears selection plus accepted/declined/response/review/held
state and revokes the token; preserve that clear-accepted-state path if removal behavior changes.
[VERIFIED 2026-06-23 — `pages/api/reviewer-finder/my-candidates.js`, `lib/dataverse/adapters/reviewer-suggestion.js`]

**Templates / hold path — RETIRED (S279, commit `a8676af1`).** The `hold` + `finalize` EMAIL
templates + their send-path branches, `HoldView`, `lib/external/proposal-readiness.js`, the <!-- doc-symbol-refs:ignore reason=retired-s279 -->
`respond.js` hold action, and the readiness-gated dispatch were all REMOVED. Template set is now
`invitation` + `materials` + `followup` + `thankyou`. The `held` responsetype value (100000004) and
the `wmkf_heldat` column are KEPT for read-safety; a historical `held` row routes to the accept form
(`computeEngagementState` fall-through). Probe confirmed 0 held rows before removal.

**Steady-state convergence:** next cycle (release-on-accept), the proposal is available at accept time,
so the acceptance-confirmation email also carries the materials link and the separate `materials` send
folds in. The `.ics` already lives on that email, so nothing moves.

**Docs reconciled (S279 /sweep; honorarium sub-state refreshed 2026-07-02):** `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`
(four templates, no hold view), `docs/REVIEWER_ENGAGEMENT_SPEC.md` (hold path removed),
`docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md` (RETIRED banner). `docs/CREDENTIALS_RUNBOOK.md` +
`docs/agent-wiki/topics/finance-honoraria.md` carry the honorarium gate posture.

## SUPERSEDED — original S256 plan (kept for context only)

The S256 plan built a NEW pre-accept "hold/soft-confirm" state to **defer** COI/AI acks + honorarium
payment + proposal delivery to a later "finalize," so a lightweight confirmed slate could be parked
before Phase II proposals arrived. The portal `HoldView` / `held` responsetype / readiness-gated
`context.js` were built for it; no client UI ever sent the `hold`/`finalize` EMAIL templates. Reason
superseded (S279): Justin chose to ONBOARD at the willing stage (acks + address up front), which
collapses "willing" and "accept" into a single step and removes the reason the two states existed.

Related: [[project-reviewer-accept-prod-automation]], [[project-reviewer-address-collection-provisional]],
[[project-reviewer-workbench-invite-workflow]], [[project-reviewer-lifecycle]],
[[feedback-verify-before-destructive-carryover]].
