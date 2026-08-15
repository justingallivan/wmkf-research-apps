---
title: Workbench Observability and Read-Coalescing Staged Plan
domain: architecture
kind: plan
status: draft
summary: "Staged plan: instrument the Workbench data path, then coalesce in-request duplicate Dataverse reads. Full Data Plane deferred until measured."
canonical: false
cataloged: 2026-08-14
last_verified: 2026-08-14
owner: product-engineering
related:
  - docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md
  - docs/audits/fable-performance-refactor-evidence-2026-08-14.md
  - docs/audits/fable-security-audit-2026-08-14.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
---

# Workbench Observability and Read-Coalescing Staged Plan

**Status: draft plan — NOT authorized for implementation.** Produced by the Fable audit
(`docs/FABLE_AUDIT_SECURITY_REFACTOR_MASTER_BRIEF.md`). Evidence: the three
`docs/audits/fable-*-2026-08-14.md` artifacts. Every stage leaves the build green and the old path
usable. No stage is started until the owner names it and authorizes implementation (brief Phase 8).

## Why this and not the full Data Plane

The audit found **zero per-dependency timing instrumentation** in the staff path (grep-verified
negative), so no caching or data-plane refactor can be justified on measured return today. It also
found a **source-certain** redundant-read pattern (per reviewer-tab action, with no DAL-level dedup:
`akoya_requests` ×2, suggestion set ×3, `wmkf_potentialreviewers` ×5 queries). And it found that the
broad post-mutation refreshes are **deliberate fixes for prior correctness bugs** (S213, S400/S401).

Conclusion: measure first, then remove certain-avoidable work behind stable seams, and only expand
toward the Data Plane's authoritative-response/selective-invalidation parts once Stage 1 metrics show
they pay. The reviewer authorization gap (T1) and cron-token eligibility divergence (T2) are real and
are handled as **separate smallest-safe security repairs**, not folded into the refactor.

## Release-tier and posture

All stages touch Dataverse-read paths and/or reviewer/authz surfaces → **Tier 2** under
`docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` (branch/worktree isolation, characterization
tests first, preview rehearsal, recorded last-known-good + rollback, explicit owner merge decision).
Campaign window is **[NEEDS OWNER]** — assume the restrictive posture; the security repairs (S3/S4)
may warrant campaign-blocker status the owner must rank.

---

## Stage 1 — Observability seam (measurement foundation)

1. **Objective / invariant:** add per-dependency timing + one correlation id per HTTP request across
   the Workbench data path, changing **no** user-visible behavior. Emit `{correlationId, entity,
   operation, ms}` at the `DynamicsService`/adapter boundary and a per-route server-duration line.
2. **Preconditions / characterization:** a test asserting current responses are byte-identical before
   and after (timing is additive, non-functional). Confirm no existing correlation field collides
   (the audit found only business-`requestId`; use a distinct key name, e.g. `reqCorrelationId`).
3. **Exact files (in order):** add `lib/observability/request-correlation.js` (new); wrap the shared
   transport in `lib/services/dynamics-service.js` timing emit; thread the id from the route shell via
   `lib/dataverse/core/context.js` (`withDalContext` already scopes the request — carry the id there).
   Consumers: a lightweight `api_usage_log`-style sink or structured `console` line (no new table in
   Stage 1).
4. **Caller→auth→service→persistence→consumer trace:** route shell mints id → `withDalContext` carries
   it → adapters read it for the timing emit → sink. No authz change; no durable write beyond the
   existing log path.
5. **Contracts:** timing emit must never throw into the request path (best-effort, try/catch, drop on
   error). No status-code, partial-success, or concurrency semantics change.
6. **Non-goals / denylist:** no caching, no dedup, no response-shape change, no new Dataverse entity,
   no client change. Denylist: `shared/components/**`, all mutation services.
7. **Sonnet work order size:** one focused order (~1 new file + 2 wrapped seams + tests).
8. **Tests:** unit (timing wrapper emits on success + swallows on error), integration (byte-identical
   response), and a check that the correlation id propagates through one multi-adapter route.
9. **Gates:** `check:dataverse-access-layer` + self-test (touching the transport), `check:types`,
   `check:api-routes` if a route file changes — run serially.
10. **Performance acceptance:** overhead < a small fixed budget per request (measure the wrapper cost
    itself); the *output* is the metric stream, compared against the pre-Stage-1 absence of data.
11. **Security acceptance:** the correlation id and timings carry **no** PII/token/secret (assert in a
    redaction test); the sink is not a new sensitive-content store.
12. **Release:** Tier 2; last-known-good = pre-stage deployment; rollback = revert (pure additive).
13. **Docs:** update `docs/SECURITY_OPERATING_PLAN.md` observability section and the Atlas if a sink
    table is added later (not in Stage 1).
14. **Stop conditions / owner:** if adding the seam requires touching authz or a durable write, stop
    and re-scope. **This stage must ship and run through one real usage window before Stage 2+ can
    claim measured improvement.**

## Stage 2 — In-request read coalescing

1. **Objective / invariant:** coalesce identical Dataverse reads within a single request/action so the
   duplicate `akoya_requests` / suggestion / `wmkf_potentialreviewers` reads collapse to one each,
   with **identical response data** to today.
2. **Preconditions:** Stage 1 metrics exist (so improvement is measurable, not "feels faster"); a
   characterization test capturing the exact current response of `getReviewers` + `getMyCandidates` +
   `decline-referrals` for one fixture request.
3. **Exact files:** add a request-scoped memoization helper keyed inside `withDalContext`
   (`lib/dataverse/core/context.js` — the audit verified it has none today, 68 lines); route the two
   services' `fetchRequestByIdOrNumber` / `fetchPotentialReviewers` / `fetchResearchersByPerson`
   through it (`lib/services/review-manager/reviewers-service.js`,
   `lib/services/reviewer-finder/my-candidates-service.js`). Prefer merging the two near-identical
   `$select` field lists into one superset read per entity per request.
4. **Trace:** caller → service → coalescing helper (cache-hit returns the prior read within the same
   `withDalContext` scope) → adapter on miss. No authz change; reads only.
5. **Contracts:** cache key MUST include the `$select` superset so a narrower earlier read cannot
   satisfy a wider later one with missing fields; scope is strictly per-request (cleared at context
   exit) — never cross-request, never cross-user. Partial-failure: a miss that errors propagates as
   today.
6. **Non-goals / denylist:** no cross-request cache, no client cache, no invalidation logic, no
   mutation-path change, no change to the deliberate broad post-mutation `refreshAll` (that is a
   separate correctness invariant — S213). Denylist: all mutation services, `shared/components/**`.
7. **Sonnet work order size:** one order for the helper + one order per service (2–3 total).
8. **Tests:** the characterization test must pass byte-identical; a test proving the coalesced read
   count drops (assert adapter call counts via mock); a test proving a wider `$select` after a
   narrower read does NOT return stale/missing fields.
9. **Gates:** `check:dataverse-access-layer` + self-test, `check:types`, reviewer test suites.
10. **Performance acceptance:** Stage-1 metric shows the per-action `wmkf_potentialreviewers` query
    count drop from 5→≤2 and suggestion 3→≤1 for the traced journey, with response unchanged.
11. **Security acceptance:** per-request scoping proven (no leakage across `withDalContext` scopes);
    negative test that a second request does not see the first's cached rows.
12. **Release:** Tier 2; rollback = disable the helper (feature-flagged server-side) → old path.
13. **Docs:** Atlas note on request-scoped read coalescing; `docs/SYSTEM_MODEL.md` if it changes the
    read-path description.
14. **Stop conditions:** if any journey depends on reading the *same* entity with genuinely different
    freshness within one action, stop — that is a correctness signal, not duplication.

## Stage 3 (security repair, parallel track) — Reviewer merge authorization (T1)

Smallest-safe repair for the confirmed gap (`pages/api/reviewer-finder/merge-candidates.js` +
`lib/services/reviewer-merge.js`): add a caller/request-scope or superuser authorization to the
destructive merge, mirroring a real server guard. **[NEEDS OWNER]** decision on the intended trust
model (S207 org-open vs request-scoped) — this repair is owner-gated on that decision, already pending
since S414. Not part of the refactor; its own tier/rollback/tests. Note the merge now also writes
`akoya_request` applicant slots, widening the unauthorized write reach.

## Stage 4 (security repair, parallel track) — Cron reminder token eligibility (T2)

Add `wmkf_selected eq true` and a revoked-token refusal to both reminder sweep filters
(`lib/services/reviewer-reminder-sweep.js:111-117, 195-199`), mirroring the manual path
(`lib/services/reviewer-manual-reminder.js:67-73`), so an automatic reminder cannot mint a fresh live
link for a staff-revoked or deselected reviewer. Preserves the standing hold on arming automatic
reminders. Characterization test first (current cron behavior), then the tightened filter, then a test
proving a revoked/deselected row is skipped.

## Deferred (evidence-gated, not scheduled)

Authoritative mutation responses (`patchReviewers` returning the confirmed record) and selective
invalidation are the Data Plane's remaining parts. They are deferred until Stage 1 metrics show the
broad `refreshAll` is a measured cost worth the added invalidation complexity — and any such change
must preserve the S213/S400/S401 correctness invariants. Component decomposition (ReviewerSearchSection)
is deferred until a measured render cost justifies it.

## Contract-reconcile verdict

_To be run (Mode A) over this plan after Opus review and disposition._
