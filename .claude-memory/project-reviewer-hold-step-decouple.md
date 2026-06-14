---
name: project-reviewer-hold-step-decouple
description: This cycle's reviewer goal — decouple invite/confirm from policy-acks + honorarium-payment by building a pre-accept "hold" step (find→validate→invite→hold→calendar invite→park), so a confirmed slate of reviewers is parked BEFORE Phase II proposals arrive; COI/AI acks + payment + proposal delivery deferred to a later finalize. Build it to merge cleanly into next cycle's no-delay flow.
metadata:
  type: project
  status: active
  scope: reviewer-finder
  last_verified: 2026-06-13 (S256) — direction confirmed by Justin; respond.js code state verified
---

## Recall Rule

Read when planning or building the external reviewer invite→accept flow this cycle, or any
change to the Stage-2a accept (`pages/api/external/review/[token]/respond.js`), the reviewer
engagement state machine, or reviewer scheduling/calendar invites.

## The cycle plan (Justin, S256)

This is the **last cycle with a delay** before Phase II proposals arrive — a buffer we exploit.
Goal: get a **confirmed, parked slate of interested reviewers** into the pipeline NOW, before the
proposals land. Staff gain confidence they hold a committed slate; reviewers "sit tight," are told
when proposals will arrive, and get **calendar invites**. COI/AI policy commitment, honorarium
payment info, and proposal delivery are **deferred a few weeks** to a later "finalize." Attrition
when reviewers see the terms is not a worry; the point is to develop the pipeline infrastructure.

## Why a new step is needed (code finding, verified S256)

The current Stage-2a accept (`respond.js`) **hard-requires at accept time exactly what we want to
defer**: both policy acks (`reviewer-coi` + `reviewer-ai-use` — 400 `policy_ack_required`, enforced
even on honorarium opt-out) AND a complete payment contact (mailing address + phone — 422
`payment_contact_required` unless opt-out), and it runs `ensureHonorariumOnboarding`. Accept goes
straight to the `accepted` pre-materials state; there is **no confirm-without-commitment path
today.** So this cycle's build is a NEW pre-accept "hold/soft-confirm" state, not a run of the
existing chain. Bonus: the hold step keeps the Connor-gated honorarium/Bill.com prod automation
([[project-reviewer-accept-prod-automation]]) from firing this cycle at all.

## Design constraint — merge-forward (Justin, S256)

Build "hold" as a proper engagement state that **"finalize" transitions out of** (hold → finalize),
so that next cycle — when there is NO delta between agreeing in principle, entering the info (acks +
payment), and getting the proposal — the two collapse into one continuous accept in a single sitting.
No throwaway scaffolding: the hold is the permanent front of the flow, just temporally separated from
finalize this cycle only. Mechanics are delegated to us — pick what's easiest this cycle that still
lends itself to the merge.

**Decision chosen:** option 1 (new pre-accept hold step) over splitting the existing accept or
staff-side-only handling. Related: [[project-reviewer-workbench-invite-workflow]],
[[project-reviewer-lifecycle]], [[project-reviewer-address-collection-provisional]].

## Readiness trigger — what flips hold → finalize (decision, S256)

The portal shows the lightweight HoldView vs the full finalize (Stage2aView) based on **proposal
readiness**, NOT a throwaway flag — so next cycle (no delay) "ready" is true from the start and the
reviewer lands straight on finalize (hold collapses to zero). Justin's cue: the **Phase II
submission housekeeping that makes a proposal visible to STAFF is the same moment it's ready to share
with accepted REVIEWERS** — one "proposal is ready" event, two audiences.

**Build accommodation:** gate finalize behind a single predicate `isProposalReadyForReviewers(request)`
so the exact Dataverse flag is one swap-later detail, never a blocker. Interim: a manual staff
"release to reviewers" override so the full chain is testable before the real signal is wired.

**Concrete candidate signal (verified S256):** our Phase II intake already PATCHes
`wmkf_phaseiisubmittedat` onto `akoya_request` on submit
(`shared/forms/phase-ii-research-2026-06/map-to-dynamics.js`) — a ready-made "Phase II is in"
timestamp. **Justin's todo (with Connor):** confirm whether the staff-visibility housekeeping gates
anything BEYOND that timestamp (a QA/release step) or whether `wmkf_phaseiisubmittedat` alone is
sufficient. Not a stopper for the build. Related: [[project-reviewer-accept-prod-automation]].

## Still open (S256)

- **ICS calendar invite scope** — true `.ics` (VEVENT) attachment is net-new (no calendar mechanism
  exists anywhere in the repo); decide build-now vs ship hold + "save-the-date" email body as a
  fast-follow. The invite belongs at hold-confirmation time (review window / `wmkf_meetingdate`).
