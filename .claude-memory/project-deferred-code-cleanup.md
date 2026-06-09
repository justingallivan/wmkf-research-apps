---
name: project-deferred-code-cleanup
description: "Registry of code that is now INERT / superseded but deliberately NOT deleted yet, each with its safe-retirement precondition. Read at the start of a code-cleanup session; append here whenever a change leaves something dead-but-load-bearing-looking rather than removing it inline."
metadata:
  node_type: memory
  type: project
  status: active
  scope: repo
  last_verified: 2026-06-08
---

## Recall Rule
Read this at the START of any "code cleanup" / dead-code / simplification session —
it's the backlog of retirements that were deferred (each was left in place because
deleting it was a destructive change needing its own caller verification, per
[[feedback-verify-before-destructive-carryover]]). When a feature change makes some
path inert but you don't retire it in that PR, **append an entry here** instead of
losing the knowledge. Don't act on an entry without first re-running its
"retire when" check live — these go stale as the code moves.

## Why this exists
Inline deletion of now-inert code mixes a destructive change into a feature PR and
skips the caller check. Parking it here keeps the feature PR clean AND keeps the
retirement from being forgotten. Each entry is a *candidate*, not a green-lit task
(treat like destructive carryover: verify live callers first).

## Backlog

### 1. `evaluateCrossFieldNamesakeGuard` — inert for physical/eng proposals (S236)
- **What:** `lib/services/discovery-service.js` — the PubMed cross-field namesake
  guard that demoted a biomedical-only same-name PubMed match for a
  non-biomedical proposal.
- **Why inert:** S236 field-aware verification ([[project-reviewer-field-aware-verification]])
  routes clearly-non-biomedical proposals to the OpenAlex/ORCID spine, so they
  never reach the PubMed branch where this guard lives. The guard's target
  population (physical/eng proposals with biomedical namesake articles) no longer
  flows through it; the spine's abstention supersedes it (and is safer — never
  *verifies* the wrong namesake).
- **Retire when:** confirm no other live caller (Codex S236 post-impl CHECK 5
  found none) AND re-confirm no input both routes to the PubMed path and triggers
  the guard. Then remove the guard + its now-unreachable branch. Low risk; left in
  place only because deletion is destructive and wasn't this change's scope.
