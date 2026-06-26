---
name: project-workbench-consolidation-rollout
description: The Workbench is being rolled out to non-tech-savvy PD coworkers. Surfacing dead-end / now-automated manual UI (the old Reviewer Manager manual tracking steps) is actively harmful to that rollout — removing obsolete affordances is a priority, not cosmetic.
metadata:
  type: project
  status: active
  scope: global
  last_verified: 2026-06-23 (S280) — owner stated rollout context + dead-end-UI concern directly
---

## Recall Rule

Read this when: planning workbench Reviewers-tab UI changes, deciding whether to
keep/remove a manual affordance, or scoping the reviewer-finder/review-manager
sunset.

## The facts (owner, S280)

- **Goal:** ONE Workbench (`appRegistry` key `reviewers`) covering what the legacy
  Reviewer Finder + Reviewer Manager apps did. Admin access to grant the two legacy
  apps has already been removed from the admin dashboard.
- **Rollout audience:** the owner's PD coworkers, who are NOT tech-savvy. The
  Workbench is being rolled out to them now.
- **Dead-end UI is actively harmful.** The reviewer-manager surface still exposes
  many **manual PD tracking steps** (dropdowns / buttons: "materials sent", "review
  received", etc.) that are now AUTOMATED — but the UI hasn't caught up. Surfacing
  these obsolete, no-op affordances confuses non-technical users and undermines the
  rollout. Removing them is a priority.

## Reviewers sub-tab restructure + proposal-release trigger (owner, S280)

- **Sub-tabs collapse. [SHIPPED — commit `4d45b4c8`, the S280-planned collapse.]** The
  Reviewers tab now has **3 sub-tabs** (`Find · Invite Reviewers · Track Reviewers`,
  `ReviewersTab.js:41-43`), down from 5 (`Find · Candidates · Invite · Track ·
  Completed`). Candidates→"Invite Reviewers" (where the invitation is actually sent; the
  tab key stays `candidates`), Track→"Track Reviewers"; the old "Invite" sub-tab (its
  `accepted` bucket + "Release to reviewers" action) and "Completed" were folded into
  Track Reviewers; legacy `invite`/`completed` deep-links normalize to `track`
  (`ReviewersTab.js:63`). The `reviewer-modes.js` no-fallthrough invariant holds
  (`complete` lands in Track's bucket). (Still open: whether to also fold Find into
  Invite Reviewers → 2-tab layout.)
- **Proposal-release timing.** Reviewers are invited off early-stage material; the
  FULL proposal arrives later (the "delay"). Historic process: (1) proposals received
  → (2) Connor compliance-checks → (3) put in SharePoint → (4) PDs told "ready" → they
  emailed reviewers. **Decision (this cycle): MANUAL.** No auto-detect/gate on proposal
  availability (no reliable Dataverse signal yet). PD waits for Connor's "ready to go"
  email, then presses **Release** in Track Reviewers; the proposal auto-attaches from
  SharePoint (`load-proposal`), and the release confirm shows WHICH file will be sent
  (override available) so a too-early/wrong-file send is caught before it goes.
- **Next cycle (FUTURE, not now):** owner will work with Connor so completing steps
  1–3 flips a **Dataverse status**, which auto-triggers the proposal send. Build the
  manual Release as ONE clean action so the future status-flip calls the same path —
  manual trigger now → automated trigger later, no rework.

**Why:** for a non-technical audience, a visible control that does nothing (or that
duplicates an automated step) reads as "the app is broken / I did it wrong," not "an
old affordance." That erodes trust in the tool the owner is trying to land.

**How to apply:** the dead-end-UI audit and the code carve-out are ONE exercise. Walk
the Reviewers tab affordance-by-affordance (`shared/components/reviewers/*`:
`ReviewersTab`, `ReviewerManagePanel`, `ReviewerInvitePanel`) and classify each control
keep vs now-automated-dead-end. Removing a dead-end affordance also lets its backing
route/component be deleted — which SHRINKS the surface that then needs renaming. Do
the UI dead-end removal first (rollout-blocking + reduces scope), then renomenclature
the smaller live surface. Pairs with SESSION_PROMPT next-step 0b and
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`. The connectivity map (which
legacy routes are live-via-Workbench vs orphaned) was traced in S280. Related:
[[feedback-rename-code-not-just-docs]], [[project-deferred-code-cleanup]],
[[feedback-verify-before-destructive-carryover]].
