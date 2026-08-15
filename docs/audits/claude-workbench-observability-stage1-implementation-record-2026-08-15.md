---
title: Workbench Observability Stage 1 — Implementation and Adversarial-Review Record
domain: architecture
kind: audit
status: draft
summary: "Point-in-time record of the Stage 1 observability implementation on codex/claude-workbench-observability-stage1: invariant table, builder assignments, verification results, and Opus adversarial-review dispositions."
canonical: false
cataloged: 2026-08-15
last_verified: 2026-08-15
owner: product-engineering
related:
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
  - docs/audits/claude-workbench-observability-plan-response-2026-08-15.md
---

# Workbench Observability Stage 1 — Implementation and Adversarial-Review Record

**Date:** 2026-08-15
**Branch:** `codex/claude-workbench-observability-stage1`, base `31041461`
**Orchestrator:** Claude Fable; Sonnet builders A/B/C; two Opus adversarial reviewers.
**Authorization:** Stage 1 only (owner work order, 2026-08-15). Stage 2, merge, deployment,
and production measurement explicitly NOT performed.

## What was built

- `lib/observability/request-correlation.js` (new): dedicated `AsyncLocalStorage` (independent
  of the DAL restriction ALS), `withRequestCorrelation({correlationId, routeName}, fn)`,
  `getRequestCorrelation()`, `mintCorrelationId()`, `emitDependencyEvent({url, method, ms,
  response, error})`, and the three closed-set classifiers (exported for tests). Browser-import
  safe: `node:async_hooks` and `crypto` load lazily via variable-path require in try/catch;
  no `typeof window` guard (jest jsdom compatibility). Emission is exactly
  `console.log(JSON.stringify(event))`; the entire emit body is try/catch-guarded — only
  telemetry failures are swallowed.
- Instrumented seams (fetch leg only, per plan §5): `lib/services/dynamics/http.js`
  `fetchWithTimeout` (interlock assert stays before the timed span; the structured
  `buildNoResponseError('dataverse', …)` is built once, inspected for telemetry, and thrown as
  the same instance); `lib/services/graph-service.js` module-local `fetchWithTimeout` (tag
  `'graph'`, same pattern; token/site/drive cache hits perform no fetch and emit nothing);
  `lib/dataverse/client.js` `getAccessToken` + `createClient().call` (lazy variable-path
  require of the observability module per the file's browser-import contract; dryRun path and
  interlock denials emit nothing; raw fetch errors rethrown as the same instance).
- Route-entry correlation (first executable handler line, before `requireAppAccess`):
  `pages/api/review-manager/reviewers.js`, `pages/api/reviewer-finder/my-candidates.js`,
  `pages/api/workbench/decline-referrals.js` — each wraps its previous body (unchanged) in
  `withRequestCorrelation({correlationId: mintCorrelationId(), routeName: '<api path>'}, …)`.
  No shared route wrapper was invented.

## Event v1 (as implemented)

`{event:'workbench.dependency', v:1, eventId, correlationId?, routeName?, dependency,
resourceClass, operation, ms, outcome, statusClass?}` — optional keys omitted, never null.
Closed sets exactly as in the plan (hostname allowlist incl. `*.crm.dynamics.com` and the
configured `DYNAMICS_URL`/`DYNAMICS_SANDBOX_URL` hosts; six Dataverse entity-set literals;
graph `site|drive|drive-item|search`; azuread always `token`; everything else fail-closed
`unknown`). `operation` = `String(method || 'GET').toUpperCase()` ∩ the seven-method allowlist
else `unknown`. Outcomes: `resp.ok` ⇒ `success/2xx`; 3/4/5xx ⇒ `http_error/<bucket>`;
`causeKind ∈ {abort,timeout}` ⇒ `timeout` (no statusClass); all other errors ⇒
`network_error` (no statusClass).

**Named deviation (defensive branch):** a response with a status outside 200–599 (undici can
surface non-standard statuses, e.g. 999) emits `outcome:'http_error'` with `statusClass`
OMITTED — a deliberate fail-closed deviation from the strict "http_error requires 3xx/4xx/5xx"
rule, preferred over fabricating a bucket. It is unit-tested and would surface loudly in the
plan's export validator rather than corrupt a count.

## Builder assignments (disjoint ownership, shared worktree, no git ops by builders)

| Builder | Files |
|---|---|
| Sonnet A | `lib/observability/request-correlation.js`; `tests/unit/request-correlation.test.js`; `tests/unit/observability-event-contract.test.js` |
| Sonnet B | `lib/services/dynamics/http.js`; `lib/services/graph-service.js`; `tests/unit/dynamics-http-observability.test.js`; `tests/unit/graph-service-observability.test.js` |
| Sonnet C | `lib/dataverse/client.js`; the three route files; `tests/unit/dataverse-client-observability.test.js`; `tests/unit/workbench-route-correlation.test.js` |

## Invariant table (Mode B contract-reconcile, pre-implementation)

| # | Invariant | Verification |
|---|---|---|
| 1 | Original `Response` identity returned by both `fetchWithTimeout` seams | identity tests, incl. emit-throw |
| 2 | Thrown error = the same structured instance the seam throws today; `client.js` raw errors rethrown unchanged | instance-identity tests |
| 3 | `lib/utils/service-error.js` unchanged | `git diff` (untouched) |
| 4 | Interlock asserts stay before the timed span; policy denials neither timed nor emitted | denial ⇒ zero events tests |
| 5 | Only telemetry-emission failures swallowed | console.log-throws tests both paths |
| 6 | Emitter exactly `console.log(JSON.stringify(event))`, literal discriminator, `v:1` | capture + `JSON.parse` tests |
| 7 | Fresh `eventId` UUID per event | uniqueness test |
| 8 | `operation` derivation incl. omitted⇒GET, invalid⇒unknown | tests |
| 9 | Hostname-allowlist dependency classification, fail-closed | fixture tests |
| 10 | Closed per-dependency resourceClass sets; `graph/token` impossible | fixtures + compatibility tests |
| 11 | Outcome/statusClass consistency rules | tests |
| 12 | No URL/query/id/filename/token/header/body material in events | hostile-URL redaction tests |
| 13 | Correlation ALS independent of DAL ALS; nested `withDalContext` preserves correlation | real-module nesting test |
| 14 | Correlation before `requireAppAccess`; app-access Dataverse leg shares the request's correlationId | route test via real `client.js` |
| 15 | Concurrent requests cannot leak correlation | interleaved tests |
| 16 | Non-HTTP callers emit valid events with correlation keys absent | tests |
| 17 | `client.js` browser-import contract preserved; module's `node:async_hooks` lazy | production build + source-guard tests |
| 18 | Route behavior byte-identical | characterization test through real `/api/reviewer-finder/my-candidates` stack (normal vs. emitter-throwing runs) |
| 19 | Non-goals: no sampling knob/cache/dedup/durable write; `dynamics-context.js`, `core/context.js`, `shared/components/**`, mutation services untouched | diff surface check |
| 20 | `client.js` dryRun path emits nothing | test |

Complement/fall-through check: every classifier branch's complement lands on `'unknown'` or an
omitted optional field; unparseable URLs, unknown hosts, unmatched paths, hostile methods,
missing `causeKind`, unavailable ALS, and emit-time throws are each explicitly handled and
tested. No open `else` falls through to raw input material.

## Verification (2026-08-15, pre-review integration pass)

- Six new suites: 108/108 pass.
- Full `tests/unit` + `tests/integration` (Builder C run): 8157/8159 — the two failures are the
  known baseline failures (`reconcile-probe-entity-set-count`, `notification-trust-model-pushup`),
  which reproduce on the pristine base and reference none of the changed files.
- `check:dataverse-access-layer` + self-test: PASS (sequential). `check:types`: PASS.
  `check:api-routes` + self-test: PASS (sequential). `npm run lint`: PASS.
  `git diff --check`: clean.
- `npm run build` (production, browser-import gate): PASS (exit 0, 2026-08-15).

## Opus adversarial review

Recorded after the review passes; see the dispositions section appended below.
