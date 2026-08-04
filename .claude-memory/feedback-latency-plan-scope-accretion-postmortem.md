---
name: feedback-latency-plan-scope-accretion-postmortem
description: "Post-mortem of the Aug 1-3 2026 Reviewer Find warm-performance debacle: a Fable-authored latency plan encoded a fail-closed receipt model and promotion-authority rewrite as 'settled decisions' on day one, shipped 76 direct-to-main commits with no tier gate, and broke a working production app. Owner verdict: 'Everything was fine a few days ago, just slow.'"
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: f1599aa5-5f17-4bae-8e91-db593608968e
  modified: 2026-08-04T02:50:03.362Z
---

## Recall Rule

Before authoring or executing any performance/caching/refactor plan — especially
one that adds state models, receipts, or authority gating on top of working
behavior — apply the failure chain from S395's post-mortem
(2026-08-03/04, conversation with Justin).

**Why:** The owner asked for one thing ("warm revisit shouldn't repeat work",
his 2026-08-01 clarification quoted in
`docs/REVIEWER_FIND_PERFORMANCE_PLAN.md:38`). The same-day Fable-authored plan
already contained a nine-stage receipt schema, fail-closed evidence model, and
promotion-authority rewrite, framed as settled decision bullets — never
presented as a scope choice. 76 commits went straight to auto-deploying `main`
(the repo's own release strategy classifies this as Tier 2/3: branch, staff
rehearsal, rollback plan, explicit owner merge). Verification was design-text
review + unit-green with mocked producers; the production data shape was never
tested. The fail-closed legacy policy silently removed working checkboxes; five
stacked hotfixes then made rollback look infeasible and the handoff docs told
the next session to forward-fix. The apps became unusable. Promote-time safety
had been server-side all along (`save-candidates-service.js`), so the entire
client-side gating layer added risk without adding safety.

**How to apply:**
- A latency/caching ask is NOT a mandate for new state models or authority
  rewrites. If the design grows beyond "cache + invalidate", stop and present
  the expansion to the owner as an explicit choice with a smaller alternative.
- Plans must not phrase their own scope expansion as "settled decisions"
  ([[feedback-cite-ground-truth]]); decisions the owner didn't explicitly make
  are proposals.
- Tier the release per
  `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` BEFORE writing code;
  record the rollback plan before merge. Direct-to-main is for Tier 0 only.
- Fail-closed gates over legacy/production data require a
  production-shaped acceptance fixture BEFORE deploy — unit-green with mocked
  producers is not evidence ([[feedback-green-requires-full-test-suite]]).
- When production breaks on a fresh deploy, evaluate revert-to-last-known-good
  FIRST, before the first forward hotfix; each stacked hotfix forecloses it.
- Display permissiveness is not a safety surface when promote-time gates are
  server-authoritative; do not add client-side authority gating that can brick
  the UI without changing safety.
