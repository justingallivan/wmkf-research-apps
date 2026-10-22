---
name: project-workbench-consolidation-rollout
description: Owner stated in S280 (2026-06-23) that the Workbench rollout serves non-technical PD coworkers and dead-end manual controls harm adoption. Treat this as dated rollout context; current route connectivity is unknown.
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

## Dated owner context (S280, 2026-06-23)

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

## Dated Reviewers sub-tab restructure + proposal-release trigger (owner, S280)

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

**How to apply:** treat the UI audit and any route/component retirement as separate
evidence-backed decisions. For each proposed removal, inspect current UI callers, API
callers, background consumers, and owner-approved scope first; hiding a control does not
show that its route or component is unused. The S280 connectivity map is historical;
current route connectivity is UNKNOWN until those callers and consumers are checked.
Preserve the owner’s audience/rationale, manual Release decision for this cycle, and
future status-trigger direction. Do not use old SESSION_PROMPT next-step 0b as authority
for automatic retirement. Related:
[[feedback-rename-code-not-just-docs]], [[project-deferred-code-cleanup]],
[[feedback-verify-before-destructive-carryover]].
