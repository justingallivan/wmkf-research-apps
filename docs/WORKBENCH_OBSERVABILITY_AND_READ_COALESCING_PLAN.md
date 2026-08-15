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

**Revised 2026-08-14 after Opus adversarial review** (`docs/audits/fable-refactor-plan-opus-review-2026-08-14.md`,
disposition `docs/audits/fable-refactor-plan-disposition-2026-08-14.md`). The review accepted the
observability-first direction but corrected Stage 1's seam, Stage 2's mechanism, and the T2 severity
framing. All accepted changes are folded in below.

## Why this and not the full Data Plane

The audit found **zero per-dependency timing instrumentation** in the staff path (grep-verified
negative), so no caching or data-plane refactor can be justified on measured return today. It also
found a **source-certain** redundant-read pattern (per reviewer-tab action, with no DAL-level dedup:
`akoya_requests` ×2, suggestion set ×3, `wmkf_potentialreviewers` ×6 queries across 3 routes). And it found that the
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

1. **Objective / invariant:** add **external-dependency (Dataverse + Graph/SharePoint) timing** + one
   correlation id per HTTP request across the Workbench data path, changing **no** user-visible
   behavior. Emit `{correlationId, entitySet, operation, ms}` at the shared transport. (Scope
   corrected per Opus P2-7: this stage times the external leg only; Postgres and client-render timing
   are named later measurement, not gated by this stage.)
2. **Preconditions / characterization:** a test asserting current responses are byte-identical before
   and after (timing is additive, non-functional). Confirm no existing correlation field collides
   (the audit found only business-`requestId`; the `withDalContext` store's `requestId` slot is
   already occupied by the scope label, so use a **distinct** key, e.g. `reqCorrelationId`).
3. **Exact files (in order) — corrected per Opus P1-2:** add `lib/observability/request-correlation.js`
   (new); wrap the **real transport `lib/services/dynamics/http.js:24` (`fetchWithTimeout`)** — NOT the
   `dynamics-service.js` facade, which contains zero `fetch` calls; this seam also covers
   `graph-service.js` (all its calls route through the same helper). **PII rule:** derive `entitySet`
   from the URL **path segment only**; never emit the raw URL or `$filter` string (OData filters embed
   names/emails). **Second-seam follow-up:** `lib/dataverse/client.js:50,106` is a separate egress used
   by `dataverse-app-access-service.js`/`dataverse-settings-service.js` (on the `requireAppAccess` hot
   path); it must be wrapped too or Stage 1 stays blind to auth-path Dataverse calls — do it in the
   same stage or name it as the immediate Stage 1b. Thread the correlation id from the route shell.
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

## Stage 2 — Merge the disjoint-`$select` sibling reads (re-scoped per Opus P1-1)

**Why the original request-scoped-cache design was dropped:** the three duplicate-read contributors
are three *separate HTTP requests* with three separate `withDalContext` scopes
(`my-candidates.js:52`, `reviewers.js:46`, `decline-referrals.js:63`), so a request-scoped cache
cannot span them. The two reads *within* each service run concurrently in `Promise.all`
(`reviewers-service.js:225-228`, `my-candidates-service.js:168-180`) with **disjoint `$select`**, so a
select-keyed cache would miss every time. An ALS memo dedupes zero of the cited reads. The real fix is
a local query merge; it needs no cache, no `withDalContext` edit, no flag.

1. **Objective / invariant:** in each of the two services, replace the concurrent
   `fetchPotentialReviewers` + `fetchResearchersByPerson` pair (same entity, same OR-chain id filter,
   disjoint `$select`) with **one superset-`$select` read of `wmkf_potentialreviewers`**, projecting
   the same fields the two projections produce today, with **identical response data**. This removes 3
   of the 6 per-action person queries (best case 6→3, spread 1/1/1 across the three routes; suggestion
   reads are cross-request and stay at 3).
2. **Preconditions:** Stage 1 metrics exist (so improvement is measured per-route, not "feels
   faster"); a characterization test capturing the exact current response of `getReviewers`,
   `getMyCandidates`, and `decline-referrals` for one fixture request.
3. **Exact files:** `lib/services/review-manager/reviewers-service.js` (merge `:504`/`:548` reads),
   `lib/services/reviewer-finder/my-candidates-service.js` (merge `:387`/`:424` reads; the
   `:440-442` removed-rows read is a **different id set** — leave it or merge separately),
   `lib/services/reviewer-finder/decline-referrals-service.js` (its `:48-49` person read — added per
   Opus P2-6; merge or explicitly non-goal). **No** new helper, **no** `context.js` change.
4. **Trace:** caller → service → single merged adapter read → existing projection. No authz change;
   reads only.
5. **Contracts:** the merged `$select` is the union of the two prior selects, so every field the
   current projections read is present. **Partial-failure guard (Opus P4d):** `my-candidates-service.js:176-179`
   deliberately catches `aggregateReviewHistory` failures so history loss doesn't fail the list — that
   is a *different* read and must stay a separate fail-soft call; do NOT fold it into the merged
   fail-hard person read.
6. **Non-goals / denylist:** no cross-request cache, no ALS memo, no client cache, no invalidation, no
   mutation-path change, no change to the deliberate broad post-mutation `refreshAll` (separate
   correctness invariant — S213). Denylist: all mutation services, `shared/components/**`,
   `lib/dataverse/core/context.js`.
7. **Sonnet work order size:** one order per service (2–3 total), each a local read merge.
8. **Tests:** characterization test passes byte-identical; a test asserting the person-query count per
   route drops (adapter call-count mock); a test proving the merged projection returns every field the
   two prior projections did.
9. **Gates:** `check:dataverse-access-layer` + self-test, `check:types`, reviewer test suites.
10. **Performance acceptance:** Stage-1 metric shows per-action `wmkf_potentialreviewers` queries drop
    6→3 (1 per route) with response unchanged. (The earlier "5→≤2" was against a wrong denominator.)
11. **Security acceptance:** no authority change; the merged read uses the same filter and the same DAL
    path, so restriction/interlock behavior is unchanged (assert the adapter call is unchanged shape).
12. **Release:** Tier 2; rollback = plain revert (local change, no flag — corrected per Opus P3-9).
13. **Docs:** Atlas note if the read-path description changes; `docs/SYSTEM_MODEL.md` only if needed.
14. **Stop conditions:** if the two projections turn out to read genuinely different row *sets* (not
    just different fields of the same rows), stop — the merge is unsound and they are not duplicates.

## Security finding T1 — Reviewer merge authorization: RESOLVED, no repair (owner, 2026-08-15)

**Closed as accepted by-design — no stage, no repair.** The owner decided (2026-08-15) to keep the
merge org-open: **there is no technical ownership of requests or data in Dataverse**, so a
request-scoped or PD-scoped merge fence has nothing to key on and app-level access is the correct and
only meaningful boundary. The data-only block predicate (`reviewer-merge.js:242-265`) remains the
safety mechanism. Characterization (retained for the record): `merge-candidates.js:23` guards with
`requireAppAccess('reviewer-finder','reviewers')` only; no `requestId`; `actingUserSystemId` is write
attribution; the merge also writes `akoya_request` applicant slots (`reviewer-merge.js:472-481`). This
is accepted risk, not an open gap. See `.claude-memory/project-merge-candidates-authorization-gap.md`.

## Stage 4 (security repair, parallel track) — Cron reminder token eligibility (T2)

**Severity note (corrected per Opus P1-4): the reviewer-reminders cron is LIVE-SCHEDULED, not held.**
`vercel.json:61` runs `/api/cron/reviewer-reminders` daily; `reviewer-reminders.js:38` defaults
`dryRun` to false. The only remaining gate is the per-request `wmkf_respondreminderenabled` /
`wmkf_reviewduereminderenabled` flags, whose live state is unprobed (added to the Phase 2 probe
list). Treat T2 as a **potentially-live exposure**, not a hold.

Repair: extend **both** reminder sweep filters (`lib/services/reviewer-reminder-sweep.js:113-116`
respond-by, `:197-199` review-due) with null-safe eligibility mirroring the manual path
(`lib/services/reviewer-manual-reminder.js:69-70`):
`wmkf_selected eq true and (wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null)`.
**Do NOT use `ne true`** — these are nullable booleans and `ne true` would exclude every never-revoked
(null) row, silently disabling the cron (house pattern is the two-branch form, `:114-115`). If
row-level checks are chosen instead of filter-level, extend each sweep's `$select` (`:112`, `:196`) to
include `wmkf_selected` and `wmkf_externaltokenrevoked`. `authorizeMint`-parity (a fresh-read
re-authorize like the manual path) is **optional defense-in-depth, not a correctness requirement** —
the mid-sweep race is already largely closed by the ETag claim-before-send (`:312-322`), which 412s if
a staff revoke/deselect bumps the row. Characterization test first (current cron behavior), then the
tightened filter, then a test proving a revoked/deselected row is skipped.

## Deferred (evidence-gated, not scheduled)

Authoritative mutation responses (`patchReviewers` returning the confirmed record) and selective
invalidation are the Data Plane's remaining parts. They are deferred until Stage 1 metrics show the
broad `refreshAll` is a measured cost worth the added invalidation complexity — and any such change
must preserve the S213/S400/S401 correctness invariants. Component decomposition (ReviewerSearchSection)
is deferred until a measured render cost justifies it.

## Contract-reconcile verdict

**Mode A, 2026-08-14 (post-Opus, post-revision): READY WITH NAMED CHANGES — all named changes already
folded in.** Stage 2's sibling-merge mechanism matches its target (3 separate route scopes + concurrent
disjoint selects verified); Stage 1's seam corrected to `dynamics/http.js:24` with PII redaction and
the `lib/dataverse/client.js` second-egress follow-up named; Stage 4's null-safe filter is the total
predicate with the ETag claim as the named idempotency guard. No new issues. No plan intent is stated
as current state; all live-state claims carry `[VERIFIED]`/`[NEEDS OWNER]` labels. Remains a draft NOT
authorized for implementation (brief Phase 8 dormant); T1 stays owner-blocked (not a stage).
