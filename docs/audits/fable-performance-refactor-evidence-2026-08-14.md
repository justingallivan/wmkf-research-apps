# Fable Performance & Refactor Evidence — 2026-08-14

**Point-in-time audit artifact** (skeleton; populated during Phases 4–5). Evidence labels per the
legend in `docs/audits/fable-task-ledger-2026-08-14.md`.

## Representative journeys

Scout 3 (performance/data-flow trace) returned 2026-08-14. Full per-journey trace tables with
file:line citations are in the scout report; Fable-verified highlights:

- **Reviewer tab entry (J2):** three parallel client fetches (`reviewers`, `my-candidates`,
  `decline-referrals`), but `getReviewers` is a 5-stage sequential server waterfall
  (`reviewers-service.js:175-441`) and `getMyCandidates` a 6-stage one
  (`my-candidates-service.js:128-337`).
- **Duplicate-read census for one `refreshAll` (corrected count, Opus P1-1):** `akoya_requests` row
  ×2, suggestion set ×3 (three different filters), `wmkf_potentialreviewers` same person ids
  **×6 queries across 3 routes** (Scout 3's ×5 was low — the removed-rows read is a 6th, on a
  different id set). Critically, the three loaders are **three separate HTTP requests** with three
  separate `withDalContext` scopes (`my-candidates.js:52`, `reviewers.js:46`,
  `decline-referrals.js:63`), and the two person reads *within each* service run concurrently in
  `Promise.all` with **disjoint `$select`**. So the fix is NOT a request-scoped cache (which dedupes
  none of them) but a local **sibling-query merge** per service — see the revised Stage 2.
  `[VERIFIED — lib/dataverse/core/context.js (68 lines) delegates to ALS with no memoization; the
  three route scopes and concurrent disjoint reads confirmed in source]`.
- **Tab navigation (J3):** conditional-render chain unmounts tabs; return re-fires all mount
  effects. `key={requestId}` remount is a documented *correctness* choice (stale cross-request
  leak), not perf.
- **Mutations (J4–J6):** `refreshAll` fires all three loaders after any mutation (documented S213
  rationale: single-list refresh left the sibling list stale). Invite path deliberately
  double-fetches with a 4s reconcile (S401 rationale). `patchReviewers` returns only
  `{success,message}` — there is no authoritative record in the response to consume.
- **AwardeeTab (J7–J8):** three response-handling patterns coexist — authoritative response
  consumed (abstract save), partial-then-reload, and response-discarded-full-reload
  (replace-submission).

## Hypothesis verdicts (Scout 3, sampled by Fable)

(a) broad reloads + remount reloads CONFIRMED (deliberate, bug-driven); (b) overlapping independent
re-hydration CONFIRMED incl. intra-route double reads; (c) size/coupling CONFIRMED
(ReviewerSearchSection 3,487 lines / 44 useState; runtime cost NOT asserted — unmeasured; its
4-stage client waterfall analyze→discover→enrich→roster IS source-proven); (d) AwardeeTab mixed
contracts CONFIRMED; (e) conditional mounting CONFIRMED (correctness-keyed); (f) NO per-dependency
timing/correlation instrumentation anywhere in the staff path — "Dataverse is slow" is unproven,
and so is every alternative attribution.

**Design constraint carried forward:** the broad refreshes and the 4s invite double-fetch are
deliberate fixes for prior correctness bugs (S213, S400/S401). Any data-plane change must preserve
cross-surface freshness and post-write read-lag invariants or it re-opens closed bugs.

## Latency and call-count evidence

_Pending. Uninstrumented boundaries will be marked `[UNKNOWN]`; no production instrumentation is
added during the planning authorization._

## Code hypotheses (confirm or refute)

_Per the master brief: ReviewersTab broad reloads, overlapping service hydration, large coupled
components, AwardeeTab mixed contracts, active-tab conditional mounting, missing per-dependency
timing. Each pending source inspection._

## Phase 4 conclusion — the four-way split

The brief requires separating external latency, application-generated network work, server
computation, and client rendering. Current evidence:

- **External (Dataverse/Blob/SharePoint) latency:** `[UNKNOWN measured]`. No per-dependency timing
  exists anywhere in the staff path (Scout 3 (f), grep-verified negative across services, routes,
  `dynamics-service.js`, `lib/dataverse/core/`). "Dataverse is slow" is unproven.
- **Application-generated network work:** `[VERIFIED — source-proven, unmeasured cost]`. One
  reviewer-tab action issues, with no DAL-level dedup: `akoya_requests` ×2, suggestion set ×3,
  `wmkf_potentialreviewers` same ids ×5 queries. This is avoidable work whose *existence* is certain
  and whose *cost* is unmeasured.
- **Server computation:** `[UNKNOWN measured]`. The 5- and 6-stage sequential service waterfalls are
  source-proven; their wall-clock is not.
- **Client rendering:** `[UNKNOWN measured]`. 3,487-line ReviewerSearchSection with 44 useState is
  source-proven size; render cost deliberately not asserted.

**The decisive fact for candidate selection: three of four legs are unmeasured, and the one measured
leg (redundant application reads) is a code fact with no attached latency.** No caching or data-plane
refactor can be justified on measured return today because there is no measurement. Per the brief's
own guidance, this makes observability the mandatory first stage.

Also resolved this phase (source-answerable, not requiring production):
- **Drain-cron overlap protection: PRESENT** `[VERIFIED via lib/db/migrations/028...sql:21-22
  (locked_until, lease_token) + reviewer-acceptance-drain.js:91-99 lease-lost handling]`. Not a risk.
- **New routes in security matrix: all present** `[VERIFIED via grep API_ROUTE_SECURITY_MATRIX.md]`.

## Phase 5 — candidate scorecard

Weighted 1–5 (impact 25 / security-correctness 20 / duplication-removed 15 / reversibility 15 /
verification-feasibility 10 / delivery-fit 10 / authority-simplicity 5).

| Candidate | Impact | Sec/Corr | Dup | Rev | Verify | Delivery | Authority | Weighted | Note |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1. Request Workbench Data Plane (full) | ?/5 | 3 | 5 | 3 | 2 | 3 | 2 | ~2.9 | Impact UNMEASURED — cannot score leg 1; verification weak w/o metrics; authority risk if it becomes a durable cache |
| 2. Reviewer orchestration + uniform mutation/authz contract | 3 | 5 | 4 | 4 | 4 | 4 | 4 | ~4.0 | Absorbs T1/D4 authz gap + patchReviewers no-authoritative-response; deterministic to test |
| 3. Workbench client-state/component decomposition | ?/5 | 2 | 3 | 3 | 2 | 3 | 4 | ~2.7 | Size≠cost unproven; premature before data contracts stabilize |
| 4. Dataverse transport dedup/caching | ?/5 | 3 | 4 | 4 | 3 | 4 | 3 | ~3.4 | In-request read coalescing is safe + high-dup-removal; cross-request cache is authority risk |
| 5. Background-job lifecycle/security consolidation | 2 | 4 | 3 | 4 | 4 | 3 | 4 | ~3.3 | Drains already leased; smaller marginal gain |
| **6. Observability + targeted security/correctness repairs** | **4** | **5** | **3** | **5** | **5** | **5** | **5** | **~4.6** | Everything else depends on its measurement; unblocks scoring candidates 1/3/4 |

## Architecture verdict

**Selected: Candidate 6 (measure/repair first), sequenced ahead of a scoped slice of Candidate 4
(in-request read coalescing) and the Candidate 2 authorization repairs.** The full Request Workbench
Data Plane (Candidate 1) is **deferred, not rejected** — it cannot be scored on verified impact until
observability produces the latency/call-count evidence, and its stronger sub-parts (in-request
dedup, authoritative mutation responses, selective invalidation) are exactly Candidate 4 + Candidate
2 done incrementally behind stable seams.

Three strongest pieces of evidence:
1. Zero per-dependency timing instrumentation exists (grep-verified negative) → no measured basis for
   any caching/data-plane refactor; observability is the precondition, not an option.
2. The redundant-read pattern is source-certain (5× `wmkf_potentialreviewers`, 3× suggestions, 2–3×
   request per action, no DAL memoization) → in-request coalescing is a safe, high-duplication-removal
   slice that needs no new authority.
3. The broad post-mutation refreshes and 4s invite double-fetch are deliberate fixes for prior
   correctness bugs (S213, S400/S401) → any invalidation redesign must preserve those invariants,
   which argues for incremental slices behind seams over a Workbench rewrite.

**Non-goals of the selected direction:** no durable client cache, no second Dataverse copy, no
receipts-as-authority, no cross-user shared cache without a reviewed authorization-aware key, no
big-bang Workbench rewrite. Security repairs (T1 merge authz, T2 cron token eligibility, D3/D4) are
tracked as their own smallest-safe repairs, NOT folded into or deferred behind the refactor.

## Measurement gaps (become Stage 1 acceptance criteria)

Per-dependency `{entity, operation, ms}` timing under one correlation id per HTTP request; server
route p50/p95; client render/commit count for one tab-entry + one mutation. Until these exist, every
latency attribution stays `[UNKNOWN]`.
