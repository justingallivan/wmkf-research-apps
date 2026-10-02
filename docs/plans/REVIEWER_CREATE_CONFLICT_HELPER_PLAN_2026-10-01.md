---
title: Reviewer suggestion create-conflict predicate extraction
status: implemented
domain: architecture
kind: plan
summary: Extract the identical applicant and staff-manual create-conflict predicates without changing recovery behavior.
canonical: false
owner: product-engineering
---

# Reviewer suggestion create-conflict predicate extraction

[VERIFIED via review records below] Root planned with ordinary Fable OAuth review; Luna implemented; Sol, root, and Fable approved the implementation. All planned local validation and remote CI passed. Owner authorized the merge of PR #397 as `2cd1987dac6a7e35b0fe87a4c7df2d9ecbfbd7b5`; Justin confirmed it in production. GitHub Production deployment `6798624722` for that commit reports success. No independent functional production smoke is claimed. PR #390 remains on hold.

Base: `6b9478d442b3100b0f80434e8ea8a3368ed90367`; branch: `codex/reviewer-create-conflict-helper`.

## Pre-change surface and evidence

[VERIFIED via source] `lib/dataverse/adapters/reviewer-suggestion.js` contains identical predicates in `ensureApplicantRecommended` and `ensureStaffManualCandidate`: numeric status 412 OR numeric status 409 OR case-insensitive message match for `duplicate|already exists|matching key values|alternate key`. This is existing behavior, not a confirmed defect. Message matches can recover regardless of status. String statuses alone do not match.

[VERIFIED via caller search and caller regions] Applicant-slot ingestion in `lib/services/workbench/applicant-reviewers-service.js` consumes created/id/exclusion/engagement results with per-slot failure isolation. `lib/services/reviewer-merge.js` requires ETags for provenance transfer and refuses an excluded winner before deleting a colliding loser. `lib/services/workbench/manual-reviewer-service.js` consumes exclusion and promotion/restore/already-handled outcomes before identity enrichment. These callers and their routes/UI are unchanged.

[VERIFIED via adapter logical regions] Persistence is the existing Dataverse suggestion lifecycle row keyed by reviewer/request. Both catches reread the winner and rethrow the original error if missing; exclusion wins. Applicant recovery unions applicant provenance, preserves selection, and honors requireEtag. Staff recovery delegates to its existing provenance-only or reselection helper; those helpers retain their own conditional-write recovery. No new write, retry, status, field, schema, route, response shape, or authentication behavior.

[VERIFIED via sibling source] General suggestion `upsert` uses status AND a broader message regex including Entity Key and 0x80060892. Potential-reviewer creation has email-field duplicate translation and ambiguous-owner handling. Neither belongs in this extraction. The shared duplicate-key translator is not equivalent.

## Implementation and invariants

[VERIFIED via implementation `850fa8895`] Added one private synchronous predicate, `isSuggestionCreateConflict`, in the same adapter. Moved the exact existing expression into it without changing short-circuit order, optional access, fallback, regex, or coercion. Replaced only the two identical checks with calls. The helper performs no I/O, has no recovery logic, and is not exported. The recovery blocks, all other predicates, and applicant rationale comment remain untouched. A short comment identifies its two scoped create paths.

| Invariant | Verification |
|---|---|
| Both call sites retain status OR message behavior | Parameterized caller-level cases for numeric 409/412 with neutral messages; each regex alternative with no conflict status, including case variation and a non-conflict numeric status |
| Complement still surfaces original failure | Neutral 400/403/429/500, absent status/message, string 409/412, and Entity Key/code-only messages reject the original value and do not perform a recovery lookup or write |
| Conflict requires an actual winner | Accepted conflict followed by no row rethrows the same original error after one additional lookup beyond the pre-create read (two total suggestion lookups) and no PATCH; assert error identity, not merely shape |
| Recovery remains path-specific | Existing and minimal additional caller tests cover excluded winners; applicant selection/provenance and ETag preservation; staff applicant provenance and ordinary winner behavior |
| Neighboring contracts remain separate | Diff inspection proves general upsert, potential-reviewer and PATCH-412 retry logic unchanged; existing sibling tests remain green |

[VERIFIED via implementation/tests and Luna run logs] Existing fixtures support 35 added caller-level cases. The pre-extraction characterization run passed two suites / 247 tests; the final focused run passed four suites / 275 tests. No production probes or live Dataverse mutations.

[VERIFIED via validation logs and PR #397] Luna completed focused adapter/caller baseline and regressions, types, lint, canonical build, full Jest, and relevant available gates/self-tests serially: Dataverse access layer, Dynamics context boundary, route/service boundary, API routes, Atlas, secret scan, doc currency, doc symbol refs, build claim freshness, docs catalog. Gates and their self-tests ran serially. Root and Sol inspected the complete diff. Fable reviewed the plan and final diff through ordinary OAuth CLI, with API-key variables removed.

## Contract reconciliation and release

[VERIFIED via source, diff, and reviews] Whole-flow audit is limited to unchanged adapter callers and their existing result contracts. Partial-success and async behavior are unchanged: this helper adds no await or batch accounting. Helper-extraction audit explicitly preserves differing sibling semantics. Durable-surface and symbol-consumer audits are N/A: no new persisted field, enum, or status. Documentation reconciliation is limited to this plan; no catalog entry is needed for a private local predicate. Held assessment PR #390 remains untouched.

[VERIFIED via PR #397 promotion record] Conservative Tier 2 due to proximity to Dataverse writes. Used synthetic isolated fixtures, a reviewed branch and PR, and explicit owner-authorized promotion. Rollback is a source revert with no data repair. Residual risk is accidental classification drift, addressed by caller-level characterization and the tiny runtime diff. No production correctness improvement or incidence reduction is claimed.

Review record: Fable plan session `baa46a60-292f-491a-a2a6-7d25a70437c2` APPROVED WITH NAMED CHANGES, incorporated above: distinguish the additional recovery lookup from the initial lookup and keep the applicant rationale comment in place. [VERIFIED via Luna baseline] Four adapter/caller suites pass, 240 tests. Implementation `850fa88957b2479033284392d98be533c3b4b1a6` approved by Sol and root. Fable final session `376ce7d3-e825-414d-b990-58fef8cb4089` APPROVED with no required changes. Type check, lint (0 errors / 124 warnings, none in changed files), and canonical build passed. Full Jest passed: 1,196 suites / 18,958 tests / 5 snapshots; 6 suites / 98 tests skipped. Dataverse access layer, Dynamics context boundary, route/service boundary, API routes, Atlas, and secret-scan gates and their self-tests passed serially. Doc currency, doc symbol refs, build claim freshness and available self-tests, plus docs catalog, passed before publication. [VERIFIED via merge-time fetched-main diff and merge-tree] Intervening main changes had no overlap with the changed adapter/test files and combined cleanly. PR #397 was merged after all checks passed; production confirmation and deployment evidence are recorded above.
