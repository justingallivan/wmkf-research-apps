# Opus Adversarial Review — Workbench Observability & Read-Coalescing Plan (2026-08-14)

**Point-in-time review artifact.** Fresh-context, read-only Opus review of
`docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` @ branch
`fable/audit-refactor-planning-2026-08-14` c3d655d. Verdict: **`changes required`**. Every finding
below was re-verified by Fable against current source before disposition (see the disposition
artifact); the verification results are noted inline.

## Findings (Opus)

- **P1-1 — Stage 2's mechanism dedupes none of the reads it cites.** The three duplicate-read
  contributors are three separate HTTP requests with three separate `withDalContext` scopes
  (`my-candidates.js:52`, `reviewers.js:46`, `decline-referrals.js:63`), so a request-scoped cache
  cannot span them. The intra-service pairs run concurrently in `Promise.all`
  (`reviewers-service.js:225-228`, `my-candidates-service.js:168-180`) with **disjoint `$select`**, so
  a select-superset-keyed cache misses every time. The actual fix is the plan's parenthetical — merge
  `fetchPotentialReviewers` + `fetchResearchersByPerson` into one superset query per service — a local
  refactor needing no ALS helper, no `withDalContext` edit, no cache-key contract, no flag. The stated
  acceptance number (5→≤2) is unachievable as designed; real best case is 6→3 person queries spread
  1/1/1 across three routes. **Fable-verified: CONFIRMED** (three scopes, concurrent disjoint reads).
- **P1-2 — Stage 1 names a non-existent seam and misses a second egress.** `dynamics-service.js` is a
  facade with **0 `fetch` calls**; the real transport is `lib/services/dynamics/http.js:24`
  (`fetchWithTimeout`) — a *better* single seam that also covers Graph/SharePoint. But
  `lib/dataverse/client.js:50,106` is a second egress bypassing it, used by four runtime services incl.
  `dataverse-app-access-service.js` on the `requireAppAccess` hot path — so Stage 1 as scoped stays
  blind to auth-path Dataverse calls. Also: OData URLs embed PII (`$filter` on names/emails), so the
  metric must extract the entity-set from the path segment and never emit the raw URL. **Fable-verified:
  CONFIRMED** (0 fetch in facade; client.js second egress; both consumers confirmed).
- **P1-3 — "`withDalContext` already scopes the request" is false.** It scopes an AsyncLocalStorage
  callback, not an HTTP request: the reminders cron wraps a 400-row batch in one scope
  (`cron/reviewer-reminders.js:43`); `enterWith` is process-lifetime with no exit hook; 173 call sites.
  As scoped in the plan (helper reached only from the two staff routes, one scope each) there is no
  leakage — but the safety is justified by a false general claim and the cache is placed in a shared
  primitive. Since P1-1 removes the need for the helper, delete it. The `requestId` store field is also
  already occupied by the scope label. **Fable-verified: CONFIRMED** (context.js delegates to ALS).
- **P1-4 — T2 is armed in production, not held.** `vercel.json:61` schedules `/api/cron/reviewer-reminders`
  daily; `dryRun` defaults false (`:38`). The only remaining gate is the per-request
  `wmkf_respondreminderenabled`/`wmkf_reviewduereminderenabled` flags — whose live state is unprobed.
  The plan's and audit's "preserves the standing hold" framing is wrong; T2 is a potentially-live
  exposure. **Fable-verified: CONFIRMED** (scheduled + dryRun default false).
- **P2-5 — T2 filter repair under-specified.** Divergence confirmed exactly. Two gaps: (a) null-safe
  syntax — use `(wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null)` and
  `wmkf_selected eq true`, not `ne true` (which would exclude all-null rows and silently disable the
  cron); (b) state whether `authorizeMint` parity is in scope — the mid-sweep race is already largely
  closed by the ETag claim-before-send (`:312-322`), so it's defense-in-depth not correctness. Row-level
  checks would also need the `$select` extended.
- **P2-6 — Stage 2 file list omits `decline-referrals-service.js`**, a third contributor to the census.
- **P2-7 — Stage 1's four-way split covers only the Dataverse leg**; Postgres/Blob/client-render stay
  unmeasured, yet Stage 1 gates "measured improvement." Widen the stage or narrow the claim.
- **P3-8 — Stage 3 (T1) is a placeholder, not a stage** (no 14 elements); owner-blocked since S414.
- **P3-9 — Stage 2 rollback names a feature flag the stage never builds**; under the re-scope, honest
  rollback is plain revert.

## Confirm/refute of load-bearing claims (Opus, spot-checked by Fable)

CONFIRMED: no timing instrumentation; context.js 68-line no-memo; T1 no authz + applicant-slot
widening; T2 cron/manual divergence + line ranges; broad refresh/invite-reconcile are deliberate
correctness fixes; byte-identical test achievable both stages; Stage 2 no-new-authority as scoped.
REFUTED: "withDalContext scopes the request"; "wrap dynamics-service.js"; coalescing collapses to
≤2/≤1; "preserves the standing hold." PARTIAL: duplicate-read census (persons is 6 not 5, across 3
routes, disjoint selects); DynamicsService single-seam (a second egress bypasses it); T2 filter fix
(right shape, syntax/scope under-specified).

## Verdict

**`changes required`** — the observability-first sequencing is correct and well-evidenced, T1/T2 are
correctly identified and correctly kept out of the refactor, but Stage 2's mechanism cannot deliver
its own acceptance number, Stage 1 targets the wrong seam and misses an egress path, the cache safety
argument rests on a false claim, and T2's severity framing is wrong. All fixable without changing the
plan's direction.
