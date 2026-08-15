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
- **Duplicate-read census for one `refreshAll` after a bounded mutation:** `akoya_requests` row ×2
  (×3 per page visit), suggestion set ×3 (three different filters), `wmkf_potentialreviewers` same
  person ids ×5 queries — including twice *within each* of the two services with the same filter
  and different `$select`. `[VERIFIED effective — no request-scoped memoization: grep of
  lib/dataverse/core/context.js (68 lines) and lib/services/dynamics-context.js for
  cache/memo/Map/dedup returned nothing, so each query is a real Dataverse HTTP call]`.
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

## Candidate scorecard

_Pending Phase 5._

## Measurement gaps

_Pending._
