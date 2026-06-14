---
name: project-reviewer-hold-step-decouple
description: This cycle's reviewer goal — decouple invite/confirm from policy-acks + honorarium-payment by building a pre-accept "hold" step (find→validate→invite→hold→calendar invite→park), so a confirmed slate of reviewers is parked BEFORE Phase II proposals arrive; COI/AI acks + payment + proposal delivery deferred to a later finalize. Build it to merge cleanly into the steady-state flow (a short staff-QA window between receipt and release, not zero).
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
so that in steady state the gap between agreeing in principle, entering the info (acks + payment), and
getting the proposal SHRINKS — but does NOT collapse to zero (corrected S256, see readiness trigger
below: a staff-QA/release step persists every cycle). The merge-forward win is that ONE machinery
handles both a long buffer (this cycle's Phase II delay) and a short steady-state QA window — not that
hold ever vanishes. No throwaway scaffolding: the hold + readiness gate are permanent infrastructure.
Mechanics are delegated to us — pick what's easiest this cycle that still lends itself to the merge.

**Decision chosen:** option 1 (new pre-accept hold step) over splitting the existing accept or
staff-side-only handling. Related: [[project-reviewer-workbench-invite-workflow]],
[[project-reviewer-lifecycle]], [[project-reviewer-address-collection-provisional]].

## Readiness trigger — what flips hold → finalize (decision, S256)

The portal shows the lightweight HoldView vs the full finalize (Stage2aView) based on **proposal
readiness**, NOT a throwaway flag. **Crucial correction (Justin, S256): "Phase II submitted" ≠
"ready to send to reviewers."** Staff run a QA pass between receipt and release (do the figures
render, is it actually shareable — a holdover from resubmission days that Justin does NOT expect to
ever fully disappear). So readiness-for-reviewers is the staff's affirmative **"release to
reviewers" after QA**, not raw submission.

**Build accommodation:** gate finalize behind a single predicate `isProposalReadyForReviewers(request)`.
The real signal is fundamentally a **staff-released flag** — so the manual staff "release to reviewers"
action is most likely the **PERMANENT** trigger, not just an interim stand-in. Connor's Phase-II-
becomes-visible housekeeping is an upstream **precondition** (start of the QA window — you can't
release what hasn't landed), not the release event itself.

**Candidate signals (verified S256):** our Phase II intake PATCHes `wmkf_phaseiisubmittedat` onto
`akoya_request` on submit (`shared/forms/phase-ii-research-2026-06/map-to-dynamics.js`) — this marks
RECEIPT / start of the QA window, a precondition, NOT readiness. **Justin's todo (with Connor):**
identify the staff-release/visibility signal that fires AFTER QA (or confirm we add an explicit staff
"release to reviewers" control). Not a stopper for the build — `isProposalReadyForReviewers` localizes
it. Related: [[project-reviewer-accept-prod-automation]].

## Still open (S256)

- **ICS calendar invite scope** — true `.ics` (VEVENT) attachment is net-new (no calendar mechanism
  exists anywhere in the repo); decide build-now vs ship hold + "save-the-date" email body as a
  fast-follow. The invite belongs at hold-confirmation time (review window / `wmkf_meetingdate`).
