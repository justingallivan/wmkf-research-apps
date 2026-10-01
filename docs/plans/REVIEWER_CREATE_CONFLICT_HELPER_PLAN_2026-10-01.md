---
title: Reviewer suggestion create-conflict predicate extraction
status: planned
domain: architecture
kind: plan
summary: Extract the identical applicant and staff-manual create-conflict predicates without changing recovery behavior.
canonical: false
owner: product-engineering
---

# Reviewer suggestion create-conflict predicate extraction

[PLANNED] Root plan → ordinary Fable OAuth review → Luna implementation and validation → Sol and root review → Fable adversarial review. Bound iterations to substantive findings. PR #390 remains on hold. No merge or production deployment is authorized by this plan.

Base: `6b9478d442b3100b0f80434e8ea8a3368ed90367`; branch: `codex/reviewer-create-conflict-helper`.

## Surface and evidence

[VERIFIED via source] `lib/dataverse/adapters/reviewer-suggestion.js` contains identical predicates in `ensureApplicantRecommended` and `ensureStaffManualCandidate`: numeric status 412 OR numeric status 409 OR case-insensitive message match for `duplicate|already exists|matching key values|alternate key`. This is existing behavior, not a confirmed defect. Message matches can recover regardless of status. String statuses alone do not match.

[VERIFIED via caller search and caller regions] Applicant-slot ingestion in `lib/services/workbench/applicant-reviewers-service.js` consumes created/id/exclusion/engagement results with per-slot failure isolation. `lib/services/reviewer-merge.js` requires ETags for provenance transfer and refuses an excluded winner before deleting a colliding loser. `lib/services/workbench/manual-reviewer-service.js` consumes exclusion and promotion/restore/already-handled outcomes before identity enrichment. These callers and their routes/UI are unchanged.

[VERIFIED via adapter logical regions] Persistence is the existing Dataverse suggestion lifecycle row keyed by reviewer/request. Both catches reread the winner and rethrow the original error if missing; exclusion wins. Applicant recovery unions applicant provenance, preserves selection, and honors requireEtag. Staff recovery delegates to its existing provenance-only or reselection helper; those helpers retain their own conditional-write recovery. No new write, retry, status, field, schema, route, response shape, or authentication behavior.

[VERIFIED via sibling source] General suggestion `upsert` uses status AND a broader message regex including Entity Key and 0x80060892. Potential-reviewer creation has email-field duplicate translation and ambiguous-owner handling. Neither belongs in this extraction. The shared duplicate-key translator is not equivalent.

## Implementation and invariants

[PLANNED] Add one private synchronous predicate, `isSuggestionCreateConflict`, in the same adapter. Move the exact existing expression into it without changing short-circuit order, optional access, fallback, regex, or coercion. Replace only the two identical checks with calls. The helper performs no I/O, has no recovery logic, and is not exported. Keep the recovery blocks and all other predicates untouched. A short comment should identify its two scoped create paths; avoid describing it as a universal Dataverse classifier.

| Invariant | Verification |
|---|---|
| Both call sites retain status OR message behavior | Parameterized caller-level cases for numeric 409/412 with neutral messages; each regex alternative with no conflict status, including case variation and a non-conflict numeric status |
| Complement still surfaces original failure | Neutral 400/403/429/500, absent status/message, string 409/412, and Entity Key/code-only messages reject the original value and do not perform a recovery lookup or write |
| Conflict requires an actual winner | Accepted conflict followed by no row rethrows the same original error after exactly one recovery lookup and no PATCH |
| Recovery remains path-specific | Existing and minimal additional caller tests cover excluded winners; applicant selection/provenance and ETag preservation; staff applicant provenance and ordinary winner behavior |
| Neighboring contracts remain separate | Diff inspection proves general upsert, potential-reviewer and PATCH-412 retry logic unchanged; existing sibling tests remain green |

[PLANNED] Reuse existing adapter test fixtures. Do not export the helper or create a generic classifier framework for tests. Run new characterization tests against the original implementation before extraction; they should pass because behavior is intentionally unchanged. Existing tests may satisfy recovery invariants; add only gaps. No production probes or live Dataverse mutations.

[PLANNED] Luna runs focused adapter/caller baseline and regressions, then types, lint, canonical build, full Jest once stable, and relevant available gates/self-tests serially: Dataverse access layer, Dynamics context boundary, route/service boundary, API routes, Atlas, secret scan, doc currency, doc symbol refs, build claim freshness, docs catalog. Discover exact scripts from package.json; do not parallelize a gate with its self-test or fixture battery. Root and Sol inspect the complete diff. Fable reviews the plan and final diff through ordinary OAuth CLI, with API-key variables removed.

## Contract reconciliation and release

[PLANNED] Whole-flow audit is limited to unchanged adapter callers and their existing result contracts. Partial-success and async behavior are unchanged: this helper adds no await or batch accounting. Helper-extraction audit explicitly preserves differing sibling semantics. Durable-surface and symbol-consumer audits are N/A: no new persisted field, enum, or status. Documentation reconciliation is limited to this plan; no catalog entry is needed for a private local predicate. Held assessment PR #390 remains untouched.

[PLANNED] Conservative Tier 2 due to proximity to Dataverse writes. Use synthetic isolated fixtures, a reviewed branch and PR; promotion is a later explicit owner decision. Rollback is a source revert with no data repair. Residual risk is accidental classification drift, addressed by caller-level characterization and the tiny runtime diff. No production correctness improvement or incidence reduction is claimed.

Review and validation record: pending.
