---
title: Workbench Observability Stage 1 — Implementation and Adversarial-Review Record
domain: architecture
kind: audit
status: active
summary: "Stage 1 implementation, adversarial-review, Production promotion, log-shape preflight, and owner-amended measurement record."
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
**Authorization:** Stage 1 owner work order and promotion complete. Stage 2 was separately
authorized by the owner on 2026-08-15 after the controlled Production baseline; it is not yet built.
The branch-closeout sections below preserve their point-in-time "not merged/deployed" state;
current promotion and measurement evidence is recorded in the final section.

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

## Opus adversarial review (2026-08-15, two independent reviewers over `ea0c207e`)

No BLOCKING findings from either reviewer. All findings and dispositions (remediation applied
by a bounded Sonnet pass; delta re-review recorded below):

| # | Severity | Finding | Disposition |
|---|---|---|---|
| A-1 | HIGH | Variable-path require does NOT defeat Turbopack — it statically resolves `require(modName)` to bundled module ids (verified in `.next/server/chunks`); browser-bundle safety actually rests on reachability (`.next/static` scan for the module's markers: zero hits), so the build gate proves reachability, not the require trick. Flip side verified clean: static resolution is why `client.js` telemetry works in the deployed bundle, and each of the three route entry graphs contains exactly ONE `request-correlation` module instance shared by the route wrapper and the app-access leg — invariant 14 holds in the bundle, not just jest. | FIXED (docs/comments): header claims corrected in `request-correlation.js` and `client.js`; invariant 17 restated below; catalog entry states the reachability basis. Residual: a scan-based CI gate over `.next/static` is a recommended follow-up (owner decision — new gate surface, not Stage 1 scope). |
| A-2 | MEDIUM | `client.js` raw timeout-shaped errors (no `causeKind`) classified `network_error` while the identical failure through `dynamics/http.js` classifies `timeout` — the app-access leg would report zero timeouts by construction. | FIXED: `classifyOutcome` now mirrors `service-error.js:88-89` for raw errors (`AbortError` name / `ETIMEDOUT`/`UND_ERR_HEADERS_TIMEOUT`/`UND_ERR_BODY_TIMEOUT` codes ⇒ `timeout`) when `causeKind` is absent; structured `causeKind` still wins. Tests added incl. a client.js seam test. |
| A-3 | MEDIUM | Measurement-semantics gaps: Graph `waitForPromiseWithin` deadline timeouts emit no event (the still-running fetch later emits its real outcome under the originating correlation); shared `tokenPromise` joiners emit nothing (one event, attributed to the initiator). Dynamics token leg has no shared promise — unaffected. | DOCUMENTED (plan "Emission-scope fidelity notes"; no emission added at the `waitForPromiseWithin` layer — a double-count decision reserved for the owner). |
| A-4 | MEDIUM | A throwing emitter at the two ESM seams would escape raw (success emit inside the try; catch-path emit unguarded), destroying Response/error identity — defense-in-depth only (the shipped emitter's whole-body try/catch makes it unreachable), but invariant 5's "both paths tested" held only for `client.js`. | FIXED: module-local `safeEmitDependencyEvent` try/catch guard at both seams (mirrors `client.js` `emitTelemetry`); emit-throw tests added at both seams. |
| A-5 | INFO | `mintCorrelationId()` is a new pre-auth expression that could in principle throw before `requireAppAccess` (not reachable on the Node runtime: `globalThis.crypto.randomUUID` always present, guarded `require('crypto')` fallback). | RECORDED; no change. |
| B-1 | HIGH | The named deviation (`http_error` with omitted `statusClass` for statuses outside 200–599) would abort an ENTIRE export slice under the plan's jq validator, not just one event. Code is right; the plan validator was unreconciled. | FIXED (plan): validator now accepts `statusClass == null` for `http_error`; contract bullet documents the deviation explicitly. |
| B-2 | MEDIUM | Negative `ms` (NTP step mid-fetch) is emittable and likewise aborts a slice (`ms >= 0` required). | FIXED: `emitDependencyEvent` clamps numeric `ms` (`Math.max(0, ms)`; `NaN`/`Infinity` ⇒ 0); non-numbers pass through so the pinned BigInt-swallow behavior is preserved. Tests added. |
| B-3 | MEDIUM | The byte-identical characterization test compared normal vs. emitter-broken runs without pinning the response (both could be identical 500s). | FIXED: test now pins `status === 200` and the proposals success body shape. |
| B-4 | LOW | Dead no-op filter line in the characterization test. | FIXED: replaced with a meaningful call-count-parity assertion (the literally-suggested "zero events recorded when console.log throws" is empirically false — jest records spy args before the implementation throws — so parity-plus-throw-evidence was implemented instead). |
| B-5 | LOW | Seeded tenant marker (`DYNAMICS_TENANT_ID` embedded in the token URL) never asserted absent from events. | FIXED: assertion added. |
| B-6 | LOW | Graph presigned/CDN download legs emit `unknown`/`unknown` (no signed-URL material leaks — probed); the manual-redirect `/content` leg emits `http_error`/`3xx` on its success path. Not reachable from the three target routes. | DOCUMENTED (plan fidelity notes). |
| B-7 | LOW | Substring-based graph path classes and `indexOf` Dataverse prefix are fail-open in principle for URL shapes unreachable from current call sites (no `/lists` call sites; no prefixed-path construction). | RECORDED; no action — noted so a future Graph list integration doesn't silently mislabel. |
| B-8 | INFO | Pre-existing `[dry-run]` console.log of raw URL/body in `client.js` (unchanged by this branch, script-only, no discriminator). | RECORDED; out of scope. |

Reviewer A additionally verified clean, with probes: transport semantics (no added await, spans
exclude body reads, dryRun/interlock paths silent), structured-error/Response identity, ALS
isolation (incl. bundle-level single-instance proof per route entry), auth/DAL interactions.
Reviewer B additionally verified clean: PII/secret leakage (hostile-URL probe battery through the
real classifiers; the emitter at `request-correlation.js` is the only logging statement added),
classification correctness (homograph hosts ⇒ `unknown`; `graph`/`token` impossible),
scope/non-goal compliance (`git diff` probes over forbidden surfaces empty), and documentation
accuracy (independently re-ran suites and three gates).

**Invariant 17 (restated per A-1):** `client.js`'s browser-import contract is preserved in that
no client bundle reaches `request-correlation.js` or its `node:async_hooks` load (verified by
static-bundle scan of `.next/static`, 2026-08-15); the lazy guarded requires provide runtime
degradation, not bundler invisibility — Turbopack statically resolves them.

## Post-remediation verification

- Six observability suites after remediation: **122/122** pass (108 baseline + 14 added by the
  remediation delta; an earlier "128/128" figure was inflated by a transient reviewer probe file
  present in the shared worktree during that run — corrected per delta findings A-NEW-2/B-N-1);
  `decline-referrals-endpoint`: pass; lint: 0 errors (65 pre-existing warnings in unrelated
  files).
- Post-remediation gates on `bd986b68`: `check:dataverse-access-layer` + self-test,
  `check:types`, `check:api-routes` + self-test, `git diff --check`, and `npm run build` — all
  PASS. Doc gates over the edited docs (`check:doc-currency` + self-test,
  `check:fact-consistency` + self-test, `check:build-claim-freshness`): PASS.

## Opus delta re-review (2026-08-15, over `bd986b68`)

Reviewer B: all eight findings RESOLVED (B-4's original suggestion withdrawn as empirically
false — jest records spy args before the mock implementation throws; the call-count-parity
replacement accepted as stronger). Reviewer A: A-3/A-4/A-5 RESOLVED; A-1 and A-2 PARTIAL with
new findings. New findings and dispositions (fixed in the follow-up commit):

| # | Severity | Finding | Disposition |
|---|---|---|---|
| A-NEW-1 | LOW–MED | `client.js` `loadEnvLocal` comment still claimed variable-path require "defeats Turbopack's static tracer" — falsified by the same compiled-output probe (fs/path statically resolved) and contradicting the corrected comment below it. | FIXED: comment rewritten to the reachability framing. |
| A-NEW-2 / B-N-1 | MED (doc) | Record claimed 128/128; committed tree yields 122/122 (both reviewers reproduced). | FIXED above with derivation. |
| A-NEW-3 | MEDIUM | Node fetch rejects as `TypeError('fetch failed')` with the undici code on `.cause`, not top-level — so the A-2 raw-code timeout check never fired on real `client.js` fetch errors (probed). | FIXED: `classifyOutcome` reads `error.code ?? error.cause?.code` in the raw-error branch only; structured errors still never reach it (buildNoResponseError always sets causeKind), so the plan's structured mapping (`'unknown'` ⇒ `network_error`) is intact. Real-shape fixtures added (TypeError+cause timeout ⇒ timeout; TypeError+cause ECONNREFUSED ⇒ network_error). Residual: a cause-wrapped undici timeout surfacing through `dynamics/http.js` is structured `causeKind:'unknown'` ⇒ `network_error` by the plan's own mapping while the same wire failure through raw `client.js` now reads `timeout` — a plan-contract consequence, recorded, not silently "fixed". |
| A-NEW-4 | INFO | `NaN`/`Infinity` `ms` normalizes to 0 — converts "unmeasurable" to "instant"; unreachable from the seams (`Date.now()` diffs are finite). | RECORDED as a disclosed design choice of the B-2 clamp. |
| B-N-2a | LOW | Factory-created `emitDependencyEvent` mock never cleared between tests (restoreAllMocks doesn't touch it) — latent order-dependency. | FIXED: `mockClear()` added to both seam suites' `beforeEach`. |
| B-N-3 | LOW | Catalog phrasing implied laziness satisfies the browser contract. | FIXED: reworded to "guarded lazy require that keeps the load off that module's import-time path". |

Reviewer B also independently verified the applied SECURITY_OPERATING_PLAN /
SERVICE_AND_UTILITY_CATALOG text as accurate, and confirmed the A-3/B-6 fidelity notes match
both reviewers' probes.

## Convergence and closeout (2026-08-15)

- **Final confirmation round over `7e384ec9`:** reviewer A verified all four delta findings
  RESOLVED (incl. probing the `.cause` unwrap against the live classifier across nine error
  shapes) and raised no new issue; reviewer B had already closed all its findings. **No
  blocking finding was raised at any point; zero findings remain open.**
- **Final verification on `7e384ec9`:** six observability suites 124/124; full
  `tests/unit` + `tests/integration`: **8173/8175 — the only 2 failures are the two known
  baseline failures** (`reconcile-probe-entity-set-count`, `notification-trust-model-pushup`),
  reproduced in isolation and unrelated to the changed files; lint 0 errors; `check:types`,
  `check:dataverse-access-layer` + self-test, `check:api-routes` + self-test,
  `check:doc-currency` + self-test, `check:fact-consistency` + self-test,
  `check:build-claim-freshness`, `git diff --check`, and `npm run build` all PASS
  (build re-verified on `bd986b68`; `7e384ec9` changed only comments, tests, and docs beyond
  one classifier expression covered by the passing suites).
- **Commits:** `ea0c207e` (implementation), `bd986b68` (remediation + doc reconciliation),
  `7e384ec9` (delta-review closure). Base `31041461`.
- **Residual risks / carry-forwards (named, not blockers):**
  1. The browser-import contract's only automated guard is the production build; a
     `.next/static` marker-scan CI gate is a recommended owner follow-up (new gate surface,
     deliberately not added in Stage 1).
  2. The measurement window must be read with the plan's emission-scope fidelity notes
     (Graph token-leg under-attribution; deadline-timeouts surfacing as later successes;
     download legs as `unknown`/`unknown`).
  3. Cause-wrapped undici timeouts through `dynamics/http.js` classify `network_error`
     (structured `causeKind:'unknown'`) while the same wire failure through raw `client.js`
     classifies `timeout` — a plan-contract consequence; closing it fully would require a
     `service-error.js` change, which invariant 3 forbids in this stage.
- **Not performed (per authorization):** Stage 2 items, merge, deployment, production
  measurement, production data access, durable persistence, Vercel CLI housekeeping. No
  DEVELOPMENT_LOG milestone added — the repo records milestones on merge/ship, and this
  branch was unmerged and pending Codex independent read-only review at this closeout checkpoint.

## Codex independent review and owner measurement amendment (2026-08-15)

Codex independently re-ran the six focused suites (**124/124**), production build, post-build
`.next/static` marker scan (zero telemetry/`node:async_hooks` markers), typecheck, lint,
Dataverse-access gate + self-test, API-route gate + self-test, applicable documentation gates +
self-tests, and `git diff --check`; all passed. The review found no runtime, security, or contract
blocker and recommended merge with two P3 cleanups, both applied on this branch:

1. The route characterization test now snapshots and restores each `console.log` spy before the
   next run. Previously both result objects referenced Jest's same reused spy, making the
   normal-vs-broken call-count comparison tautological even though the response-equivalence and
   dedicated seam tests remained valid.
2. `docs/SECURITY_OPERATING_PLAN.md` now states UUID optionality precisely: `eventId` is universal;
   `correlationId` is additionally present on the three correlated target routes.

The owner also confirmed that dormant campaign surfaces may see no organic activity for months.
The plan's former `≥20 requests per route within two calendar weeks` Stage 2 prerequisite
conflicted with the active campaign-cadence memory and is withdrawn. Measurement now separates:
(A) a passive 48-hour app-wide operational-safety check; (B) a deliberate signed-in **GET-only**
before/after baseline over representative existing requests, with production mutations prohibited;
and (C) optional organic latency evidence that never blocks Stage 2 and must be reported as
insufficient when sparse. The Deferred Data Plane remains gated on genuine organic latency
evidence. **At that branch-closeout checkpoint**, Stage 2, merge, deployment, and measurement were
unperformed and separately owner-controlled; the promotion addendum below supersedes that
point-in-time statement for merge, deployment, and Stage 1 measurement only.

## Production promotion and measurement opening (2026-08-15)

The owner authorized promotion after Codex review. `main` advanced to merge commit `30ed5fe0` and
Vercel deployment `dpl_AEHShYKKSb4WxeuxkUZgMRbLp3kB` reached READY in Production at
2026-08-16 00:53:40Z. The custom application domain was independently verified through the Vercel
alias API to resolve to that exact deployment. Six focused suites remained green on merged main
(124/124) before push.

A signed-in GET/read-only Production smoke loaded Workbench dashboard, detail, Find, and Track
views without any application mutation. The three target routes emitted 39 correlated dependency
events across three non-identifying fixture strata; every correlated target event reported success,
and the observed `wmkf_potentialreviewerses` counts matched the pre-Stage-2 formula for available
empty, small/typical, active, removed, and decline sets. A >25-id fixture was unavailable and was
not manufactured.

The window-start log preflight discovered and corrected a plan-only extraction defect: Vercel JSON
request records carry all console lines under `.logs[]`, while the top-level `.message` duplicates
only one child line. A bounded complete slice contained 116 validated nested telemetry events but
only 14 top-level matches. The plan now flattens `.logs[]`, retains only safe record metadata plus
the validated event, and deletes the unfiltered RAW capture after validation. Across the bounded
preflight/baseline slices, 293 unique events passed the full v1 validator after overlap-safe
`eventId` deduplication.

Live probes verified the team is Pro, Observability Plus is not enabled, and no Log Drain exists;
current base-Pro runtime-log retention is one day. Track A therefore requires daily-or-more-frequent
exports during its 48-hour window and remains open through 2026-08-18 00:53:40Z. Full evidence,
fixture counts, limitations, and the corrected extraction contract are in
`docs/audits/workbench-observability-stage1-production-baseline-2026-08-15.md`.

**Owner decision after baseline:** Stage 2 may build while Track A continues. The 48-hour duration
and sparse organic traffic are not prerequisites; only a named Track A stop condition pauses the
Stage 2 work or promotion.
