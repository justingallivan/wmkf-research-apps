---
name: project-nomenclature-and-app-sunset-sweep
description: "Owner-requested DEFERRED initiative (2026-06-25): a deeper sweep to fix overloaded/stale reviewer-domain nomenclature, sunset legacy apps no longer in use, and reconcile stale memories + wiki entries. Not yet started — a TODO."
metadata:
  node_type: memory
  type: project
  status: active
  scope: repo
  last_verified: 2026-06-25
---

## Recall Rule

Read this when planning any reviewer-domain rename, app sunset, or memory/wiki
cleanup session. This is the owner's parked "deeper sweep" TODO — a candidate
initiative, NOT green-lit work. Verify live callers before any destructive step
([[feedback-verify-before-destructive-carryover]]).

## What the owner asked for (2026-06-25)

A deeper, deliberate sweep of the naming/sunset debt left by collapsing the two
legacy apps (**Reviewer Finder** + **Reviewer Manager**) into the single
**Workbench** app (`appRegistry` key `reviewers`). Three strands, one exercise:

1. **Nomenclature.** Legacy/overloaded language causes real routing errors (it
   misled this agent mid-session). Live examples observed 2026-06-25:
   - Tab label **"Invite Reviewers"** (`ReviewersTab.js:42`) is backed by
     `CandidatesPanel.js`, whose in-panel header still renders **"Candidates (N)"**
     (`CandidatesPanel.js:187`) — same surface, two user-visible names. (Owner
     approved keeping the tab label "Invite Reviewers"; a local header fix to match
     may land with the nearby edit-affordance work — see
     [[project-workbench-consolidation-rollout]].)
   - Stale comments cite tabs that no longer exist ("Invite"/"Completed" folded into
     Track Reviewers): `CandidatesPanel.js:11`, `:200`.
   - **One app, three API namespaces:** `/api/reviewer-finder/*`,
     `/api/review-manager/*`, `/api/workbench/*`. Consolidation is a question for the
     sweep, not a casual rename (route paths are contracts).
   - The word **"candidate"** is overloaded: UI noun, API path (`my-candidates`,
     `save-candidates`), component name, AND data-model concept (a *selected*
     `wmkf_appreviewersuggestion` row). Disambiguate in any target glossary.
2. **Sunset apps no longer in use.** Admin access to grant the two legacy apps was
   already removed (per [[project-workbench-consolidation-rollout]]); this strand is
   verifying which legacy routes/components are now orphaned vs still live-via-Workbench
   and retiring the dead ones. Pairs with the inert-code registry
   [[project-deferred-code-cleanup]].
3. **Doc hygiene.** Reconcile stale memories and wiki entries against current state
   (e.g. the consolidation memory's "5 sub-tabs" line is already stale — the 3-tab
   `Find · Invite Reviewers · Track Reviewers` collapse SHIPPED). Use `/sweep` for
   fact-level reconciliation.

## Why / How to apply

**Why:** for the non-tech-savvy PD rollout, two names for one surface reads as "the
app is broken / I did it wrong." Overloaded language also keeps re-causing agent
mis-routing and stale-doc churn.

**Recommended strategy (S290):** `docs/NOMENCLATURE_AND_APP_LIFECYCLE_STRATEGY.md` —
classification framework (deprecated-app vs borrowed-live-infra vs pure-naming), a separate
`APP_LIFECYCLE_REGISTRY` export (never re-add dead apps to `APP_REGISTRY`), route-paths-as-
contracts → LEAVE+DOCUMENT, a phased plan, and the first 3 commits. Codex-reviewed.

**How to apply:** follow the sequencing already decided in
[[project-workbench-consolidation-rollout]] — **dead-end UI removal FIRST** (shrinks
the surface), THEN renomenclature the smaller live surface. Build a grounded inventory
(every legacy name → target) before renaming; treat route-namespace consolidation as
its own sub-decision (paths are contracts). Rename the CODE/ground truth, not just
docs ([[feedback-rename-code-not-just-docs]]) — a docs-only pass will keep re-surfacing
the same drift. Related: [[project-deferred-code-cleanup]].
