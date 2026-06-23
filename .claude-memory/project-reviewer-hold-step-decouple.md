---
name: project-reviewer-hold-step-decouple
description: Reviewer invite→accept direction (REVISED S279, supersedes the S256 deferral plan). Collapse invite→hold→finalize→accept into ONE final Accept that onboards up front — COI/AI acks + honorarium opt-in/address via the existing capture-only path (NO Bill.com) — and sends an acceptance-confirmation email carrying an .ics save-the-date (review due date). Proposal/materials are delivered separately when ready. Post-accept exit is out-of-band (personal email to PD → renegotiate due date → manual Remove that also resets engagement flags). No separate willing/held or finalize reviewer step.
metadata:
  type: project
  status: active
  scope: reviewer-finder
  last_verified: 2026-06-22 (S279) — direction revised + confirmed by Justin; honorarium capture-only path and Remove-button behavior re-verified in code
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
- If honorarium wanted → collect mailing address. Runs the EXISTING capture-only path
  (`ensureHonorariumOnboarding` with `isDeferred()` true): ensures the contact + PATCHes the address,
  then STOPS — does NOT create the honorarium `akoya_request` and does NOT call BILL. So accepting does
  NOT fire the Connor-gated "Bill.com - Push Payments" automation. The contact-address PATCH DOES still
  fire `AkoyaGo.Sync_BusinessCentral` (benign — the address landing in accounting, which is what makes
  it usable for mailing a check, as last cycle). [VERIFIED S279 — `lib/bill/honorarium-onboard-orchestrator.js:53-134`]
- "Partial now, full later": address captured now; if Bill.com gets the go-ahead THIS cycle, append it
  by configuring the 3 discriminator GUIDs / unsetting `HONORARIUM_ONBOARDING_DEFERRED` — the full
  create+onboard tail then runs on a later accept (reversible, by design).
- Reviewer receives an acceptance-confirmation email carrying an `.ics` save-the-date keyed to
  `wmkf_reviewduedate` (reuse `lib/external/calendar-invite.js`, rewired off the removed hold template;
  rekey `meetingDate` → `reviewDueDate`). NOTE: today the `respond.js` accept branch sends the reviewer
  NO email — only staff notifications — so this reviewer-facing confirmation send is **net-new**.

**Acceptance is FINAL at this step.** There is NO separate "willing/agree-in-principle" state and NO
separate "finalize" reviewer step — those were artifacts of the S256 deferral plan and disappear once
acks/payment are collected up front. The only thing that stays time-separated is WHEN the proposal
becomes available, which is a **staff/readiness event** (this cycle: PD "Release to reviewers" after a
QA pass; steady state: immediately on accept), NOT a second reviewer action.

**Post-accept exit** (a reviewer who later can't review): OUT-OF-BAND, not a portal self-service
decline. The reviewer emails the PD; the PD may renegotiate the due date; if no compromise, the PD
manually removes them via the workbench Remove button. The existing Remove
(`my-candidates` DELETE → `softDelete`) sets `wmkf_selected=false` + revokes the token but does NOT
clear `wmkf_accepted` / `wmkf_responsetype` / `wmkf_reviewstatus` — so it must be ENHANCED to reset
those engagement flags (else a removed accepted reviewer still counts toward quota / doesn't free a
slot). [VERIFIED S279 — `pages/api/reviewer-finder/my-candidates.js:553-585`]

**Templates:** REMOVE the `hold` + `finalize` EMAIL templates + their send-path branches. Keep
`invitation` + `materials` + `followup` + `thankyou`. The `HoldView` / `held` two-view portal is
**bypassed now** (route straight to Accept) and **retired as a follow-up cleanup** — it is LIVE this
cycle, so do not rip it out in the same change ([[feedback-verify-before-destructive-carryover]]).

**Steady-state convergence:** next cycle (release-on-accept), the proposal is available at accept time,
so the acceptance-confirmation email also carries the materials link and the separate `materials` send
folds in. The `.ics` already lives on that email, so nothing moves.

**Docs to reconcile AFTER the build** (they describe soon-to-be-superseded BUILT state — do NOT
pre-rewrite them as built; that would present plan as built state):
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`, `docs/REVIEWER_ENGAGEMENT_SPEC.md`,
`docs/REVIEWER_HOLD_STEP_BUILD_PLAN.md`.

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
