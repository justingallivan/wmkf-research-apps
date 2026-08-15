---
title: Claude Response — Codex Adversarial Review of the Workbench Observability Plan
domain: architecture
kind: audit
status: final
summary: "Point-in-time disposition of the 2026-08-15 Codex adversarial review and its three follow-up passes (8 + 5 + 6 + 3 findings): all independently confirmed against source; plan revised; fresh Mode A verdict."
canonical: false
cataloged: 2026-08-15
last_verified: 2026-08-15
owner: product-engineering
related:
  - docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md
  - docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md
---

# Claude Response — Codex Adversarial Review of the Workbench Observability Plan

**Date:** 2026-08-15
**Author:** Claude (Fable), branch `codex/claude-workbench-plan-revision`, base `b4c8e048`
**Reviewed input (read-only):**
`docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md`
**Revised output:** `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` (this branch)
**Method:** every Codex finding independently re-verified against current worktree source (three
parallel read-only source traces; no Codex citation accepted without a fresh read). No runtime code
was changed; no production/Dataverse probes were run. This is a point-in-time artifact — do not
rewrite it to later truth.

## Finding dispositions

Disposition grades **Codex's finding**, not the plan claim it attacks (a correctly-refuted plan
claim ⇒ CONFIRMED finding).

### P1-1 (Dynamics transport does not cover Graph) — CONFIRMED

- `lib/services/dynamics/http.js:24` exports `fetchWithTimeout`; its importers are exactly the
  `dynamics/*` submodules (`auth.js:22`, `schema.js:31`, `write-core.js:37`, `read-ops.js:27`).
  `dynamics-service.js:12` imports only `buildHeaders` from it.
- `lib/services/graph-service.js:1154` defines a separate module-local `fetchWithTimeout`; the
  file's **only** import is `service-error.js` (`:12`), so it cannot route through the Dynamics
  helper. Token acquisition (`:101-135`) and ~20 Graph call sites all use the local helper. The two
  implementations differ substantively (the Graph copy has no `assertDataverseOperationAllowed`
  interlock and tags errors `'graph'`).
- **Beyond Codex:** the full runtime egress inventory is larger than the three seams Codex named —
  also `lib/services/dataverse-export/fetch-client.js:61` (a fourth local `fetchWithTimeout` copy),
  `lib/services/dataverse-export/live-taxonomy.js:38,64` (raw un-timed Dataverse fetches), and
  `lib/utils/health-checker.js:70,94,123` (Azure AD token probes); and `lib/dataverse/client.js` has
  four runtime consumers, not two (`grant-cycles-dataverse.js:12`, `dataverse-identity-map.js:13` in
  addition to app-access and settings).
- **Plan change:** new "External-egress inventory" section enumerating all seams with in/out-of-scope
  markings; Stage 1 wraps three seams (Dynamics http, Graph-local helper, `lib/dataverse/client.js`
  token + data); host-aware allowlisted classifier with fail-closed `resourceClass: 'unknown'`;
  explicit never-emit list.
- **Residual risk:** the classifier allowlist must be maintained; unknown future hosts/paths fail
  closed to `unknown`, which under-classifies but never leaks.

### P1-2 (correlation scope cannot observe the auth-path call) — CONFIRMED

- `lib/dataverse/core/context.js:46-54`: `withDalContext(scopeLabel, fn)` only; a non-string first
  arg throws; it forwards to `bypassDynamicsRestrictions`.
- `lib/services/dynamics-context.js:55-58`: the ALS store is exactly
  `{restrictions, requestId}` with `requestId` = the scope label (a constant per route, not a
  per-request id).
- `pages/api/review-manager/reviewers.js:43-46` and `pages/api/reviewer-finder/my-candidates.js:47-52`:
  `requireAppAccess` runs strictly **before** the route `withDalContext` scope.
  `pages/api/workbench/decline-referrals.js:32-33,63`: same ordering.
- `lib/utils/auth.js:321-341`: on cache miss (cold instance or >2-minute TTL,
  `_appAccessCache`/`APP_ACCESS_TTL_MS` at `:223-224`), `requireAppAccess` performs a real Dataverse
  call inside its own `withDalContext('auth-app-access-lookup', ...)` — before any route scope
  exists. The egress is `dataverse-app-access-service.js:47-58` → `lib/dataverse/client.js`
  (`:50` token fetch, `:106` data fetch).
- No pre-existing correlation mechanism anywhere: no Next.js middleware file, exactly one ALS in the
  repo (the DAL one, `dynamics-context.js:39`), no shared route wrapper, no
  `x-request-id`/correlation header handling (grep-verified).
- Nested DAL scopes replace-then-restore the store (`dynamics-context.js:17-20,55-58`); the
  auth-lookup scope in these routes is sequential, not nested.
- **Plan change:** Stage 1 now defines `lib/observability/request-correlation.js` with its **own
  dedicated ALS**, established at the first line of each of the three enumerated handlers before
  `requireAppAccess`, carrying `{correlationId, routeName}`; the DAL store is explicitly
  not-to-be-modified; non-HTTP callers have defined no-correlation behavior; Codex's four required
  tests are adopted verbatim into the Stage 1 test list.
- **Residual risk:** only the three enumerated routes carry correlation in Stage 1; other workbench
  routes' dependency events will have no `correlationId` until extended (visible, not silent — the
  events still emit).

### P1-3 (fixed 6→3 acceptance target is not a valid census) — CONFIRMED

- Pair 1: `reviewers-service.js:224-228` — one id set, `Promise.all` over
  `fetchPotentialReviewers` + `fetchResearchersByPerson` (`:498-512`, `:542-555`), disjoint
  `$select` apart from the key.
- Pair 2: `my-candidates-service.js:166-180` (definitions `:381-395`, `:418-432`) — active ids.
- Pair 3: `my-candidates-service.js:437-443` (`projectRemovedCandidates`) — removed-row ids from
  `findRemovedByRequest` (`:148`), distinct from the active set by construction, single-request
  mode only (`:315-316`).
- Decline: `lib/services/workbench/decline-referrals-service.js:123` is the **sole** person read
  (helper `:42-57`); nothing to merge. `lib/services/reviewer-finder/decline-referrals-service.js`
  **does not exist** (directory listing checked).
- Chunking: six `const CHUNK = 25` sites at the **service-helper layer**
  (`reviewers-service.js:502,545`, `my-candidates-service.js:384,400,421`,
  `decline-referrals-service.js:45`) — five person-read helpers plus `fetchApplicantAkas`
  (`my-candidates-service.js:400`, different entity, outside every pair) — not in the
  `potential-reviewer` adapter (grep: no chunk
  constant there; adapter-side 25 exists only for suggestion reads,
  `reviewer-suggestion.js:352,383`). Every helper short-circuits empty id sets
  (`if (!ids?.length) return {};`).
- **Plan change:** Stage 2 census table (three pairs, decline explicitly unchanged at the corrected
  path); the chunk-aware contract
  `before = 2q(reviewers)+2q(active)+2q(removed)+q(decline)`, `after = q+q+q+q`, `q(n)=ceil(n/25)`,
  empty ⇒ 0 (7→4 in the all-nonempty single-chunk case); acceptance requires adapter call-count
  tests over active-only / removed-only / combined / empty / >25-id fixtures — response equality
  alone is stated to be insufficient. The fixed 6→3 and 1/1/1 claims are removed everywhere in the
  plan, including the "Why" section's old "×6 across 3 routes" phrasing.
- **Residual risk (refinement beyond Codex):** because chunking lives in five service-level helper
  copies, the merge must preserve chunking at the call-site layer; the plan pins this in Stage 2
  step 1 so an implementer does not assume the adapter handles it. (`my-candidates-service.js:400`
  is `fetchApplicantAkas` — a different entity, flagged in the plan as not part of any pair.)

### P1-4 (T2 already fixed and shipped) — CONFIRMED

- `reviewer-reminder-sweep.js:120` and `:204`: both sweeps append
  `selectedAndNotRevokedFilter()` (+ `notExcludedFilter()`), imported at `:36`.
- `reviewer-suggestion.js:108-110`: the exact null-safe predicate
  (`wmkf_selected eq true and (wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq
  null)`), with the `ne true` hazard documented at `:92-107`.
- `reviewer-reminder-sweep.js:283-343`: fail-closed on missing ETag, single
  `mintAndStore({..., ifMatch, writeFields: claimPatch})` combining marker + token, 412 ⇒
  `claimFailed`, no send.
- `tests/unit/reviewer-reminder-sweep.test.js:134-143,439-448`: regression coverage for both
  sweeps, including a negative assertion against `ne true`.
- `SESSION_PROMPT.md` §3 and `DEVELOPMENT_LOG.md` record Session 428 shipping this to production.
- **Plan change:** "Stage 4" deleted as prospective work; replaced by a closed-history section (T2 —
  FIXED AND SHIPPED, Session 428) with the source/test citations. The verifier-deselect hardening
  question remains tracked in `SESSION_PROMPT.md` as an owner decision, outside the plan.
- **Residual risk:** none for the plan; the flow is shipped and regression-covered.

### P2-1 (telemetry envelope and failure contract incomplete) — CONFIRMED

- The old envelope `{correlationId, entitySet, operation, ms}` cannot represent the Azure AD/Graph
  token calls (no entity set — `client.js:45-68`, `graph-service.js:101-135`) nor distinguish
  outcome classes; "swallows on error" was ambiguous as written.
- **Plan change:** versioned v1 event contract
  `{v, correlationId?, routeName?, dependency, resourceClass, operation, ms, outcome, statusClass?}`
  with outcome taxonomy `success | http_error | timeout | network_error`; emission in
  `finally`-equivalent across all paths; original `Response`/error identity preserved; **only
  telemetry-emission failures swallowed**; tests assert preservation both when telemetry works and
  when the emit itself throws.
- **Residual risk:** none structural; contract evolution requires a version bump.

### P2-2 (sink and usage window unresolved) — CONFIRMED

- `docs/atlas/postgres-infra-tables.md:147-149`: `api_usage_log` is the per-Claude-call LLM
  token/cost ledger written by `llm-client.js` via `usage-logger.js` — not a dependency-event table.
- **Plan change:** sink chosen — structured Vercel platform logs, event name
  `workbench.dependency`, 100% sampling, defined query/export workflow, retention verified at
  window start (`[NEEDS OWNER]` for plan-tier confirmation), failure isolation via guarded
  `console.log`. `api_usage_log` explicitly not repurposed. A durable sink is named as a re-scope
  with migration/Atlas/retention/privacy contracts, not an implementer option.
- **Residual risk:** platform log retention could be shorter than the low-traffic window — mitigated
  by the verify-at-start + periodic-export requirement.

### P2-3 (evidence gate cannot falsify Stage 2) — CONFIRMED

- The old "one real usage window" had no environment, sample, aggregation, or decision rule; and a
  per-request correlation id cannot prove a single client tab action across three requests.
- **Plan change:** executable measurement window — production, the three named routes, ≥20 requests
  per route with a 2-week shortfall-reporting bound, per route × dependency × resourceClass
  aggregation (counts, calls/request, p50/p95, outcomes). The plan now states **plainly that Stage 2
  is source-certain and not latency-gated**; the window is the before/after verification baseline
  for Stage 2 and the latency gate for the *Deferred* Data Plane work only. Route-level (not
  action-level) measurement is explicitly what is claimed.
- **Residual risk:** low workbench cadence may stretch the window
  (`.claude-memory/project-reviewer-find-usage-cadence-blocks-observation-windows.md`); the
  shortfall rule makes that visible instead of silently extrapolated.

### P2-4 (final T1 verdict contradicts the owner decision) — CONFIRMED

- Old plan `:147-156` declared T1 closed/accepted by design (owner, 2026-08-15) while `:195` said
  "T1 stays owner-blocked". `SESSION_PROMPT.md` records the owner decision and the
  do-not-reopen rule.
- **Plan change:** T1 is uniformly stated as closed/accepted-by-design in a closed-findings history
  section; the "owner-blocked" sentence is gone; the fresh contract-reconcile verdict carries no T1
  contradiction.
- **Residual risk:** none.

## Prior-Opus re-evaluation table (Codex §"Prior Opus findings re-evaluated") — spot-checked

Codex's nine-row re-evaluation is consistent with the evidence above; no row contested. The two
rows marked "unresolved" (P1-3 `withDalContext` correlation claim, P2-7 Graph omission) are resolved
by the P1-2/P1-1 plan changes respectively.

## Recommendation-evidence table

| Recommendation (revised plan) | Evidence verdict | Basis |
|---|---|---|
| Observability before a broader Workbench Data Plane | SUPPORTED | No correlation/timing exists anywhere (one ALS repo-wide, no middleware, no correlation headers — grep-verified this session); broad invalidation changes carry known S213/S400/S401 correctness risk |
| Instrument `dynamics/http.js:24` for Dynamics traffic | SUPPORTED | It is the shared transport for all `dynamics/*` submodules including token acquisition (importer trace) |
| Instrument `graph-service.js` local helper separately | SUPPORTED | Graph's only import is `service-error.js`; ~20 call sites use the module-local helper |
| Instrument `lib/dataverse/client.js` (token + data) | SUPPORTED | Second egress on the `requireAppAccess` cache-miss hot path (`auth.js:321-341` → `dataverse-app-access-service.js:47-58`); four runtime consumers |
| Independent pre-auth correlation ALS | SUPPORTED | `requireAppAccess` precedes route DAL scopes in all three routes; DAL store is `{restrictions, requestId=scope label}`; separate ALS instances cannot disturb each other |
| Structured platform-log sink, no durable write | SUPPORTED | Matches Stage 1's own stop condition; `api_usage_log` is the LLM ledger (Atlas) |
| Merge three sibling pairs across two services; decline unchanged | SUPPORTED | Census verified at all four sites; decline has a single read; the reviewer-finder decline path does not exist |
| Chunk-aware formula acceptance (7→4 best case), not 6→3 | SUPPORTED | `CHUNK = 25` at five service-helper sites; empty-set short-circuits verified |
| Stage 2 proceeds on source-certainty, not a latency gate | SUPPORTED | The duplicate pairs are structural in source; latency data cannot falsify their existence |
| T2 as completed history only | SUPPORTED | Filters, atomic ETag write, and tests all present in current source |

## Narrow sweep report

**Mode:** narrow durable-state sweep over the two live surfaces Codex marked STALE, plus a
restatement search across `docs/**`, `.claude-memory/**`, `docs/agent-wiki/**`, `SESSION_PROMPT.md`,
`CLAUDE.md`, `AGENTS.md` for the four stale claims (Graph-via-Dynamics-helper, `withDalContext`
carries correlation, fixed 6→3/×6 denominator, prospective-T2/owner-blocked-T1).

- `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` — **revised this branch**; zero
  remaining stale claims (re-grepped post-edit).
- `SESSION_PROMPT.md` — **revised this branch**; no longer calls Stage 1 fully specified, no fixed
  ×6/6→3 denominator; correct historical commit and shipped-T2 information preserved.
- Historical dated artifacts (`docs/audits/fable-*-2026-08-14.md`,
  `docs/audits/codex-workbench-observability-plan-adversarial-review-2026-08-15.md`) — contain the
  superseded claims **as point-in-time records**; intentionally not rewritten.
- `.claude-memory/**`, `docs/agent-wiki/**`, `CLAUDE.md`, `AGENTS.md` — no live restatements found
  (the wiki's "Stage 4" hits are the unrelated Q9 app-access migration).
- Other doc hits of "6→3" (`docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md`) are unrelated counts.

**Live stale claims remaining: 0** *(first-pass scope; passes two and three each corrected further
wording in these same surfaces — see the per-pass sections below. Current status as of the third
pass: zero known live stale claims, re-verified by the third-pass semantic re-search.)*

## Remaining assumptions and owner decisions

1. `[NEEDS OWNER]` Campaign window / release posture (unchanged from the audit).
2. `[NEEDS OWNER]` Vercel plan log-retention confirmation at measurement-window start (Stage 1
   sink contract).
3. `[NEEDS OWNER]` Authorization to implement any stage (brief Phase 8 remains dormant; this
   revision does not authorize anything).
4. Superseded by item 7 (third pass): the sampling assumption is whole-application volume/cost,
   not "workbench traffic", and carries a defined validation and stop threshold.
5. Verifier-deselect hardening stays an open owner decision tracked in `SESSION_PROMPT.md`, outside
   this plan.
6. The Stage 1 export command is `[VERIFIED via vercel --version / vercel logs --help]` against
   installed CLI `59.0.0` (2026-08-15). `[ASSUMED]` only that the installed CLI at
   measurement-window start still matches — the plan requires re-verifying then and forbids
   assuming an upgrade preserves flags; Log Drain / dashboard export is the required fallback if
   completeness cannot be proven.
7. `[ASSUMED — explicitly unverified]` Whole-application dependency-call volume and platform log
   cost under 100% emission; validated within 48 hours of enablement against the plan's
   ~50,000-lines/day stop/re-scope threshold.

## Follow-up review — second Codex pass (2026-08-15), five additional findings

**Provenance:** no on-disk artifact for this second review was found in the worktree, the main
checkout tree, any origin branch, or `outputs/` at revision time; the five findings were relayed
verbatim in the owner-issued work order and are dispositioned from that enumeration. All five
were verified against source before revision.

### F1 (telemetry must preserve existing structured error transformations) — CONFIRMED

- `lib/services/dynamics/http.js:41-50`: the Dynamics transport deliberately wraps every
  no-response throw via `buildNoResponseError('dataverse', err)` so the drain's retry classifier
  sees structured `err.noResponse`/`err.isTransient`/`err.causeKind`; the interlock assert sits
  **before** the try block (`:32-38`) precisely so policy denials propagate un-reclassified.
  `graph-service.js` applies the same transformation with tag `'graph'`. The prior plan text
  ("rethrows the original error … no wrapping") was ambiguous against this.
- **Plan change:** Stage 1 step 5 now states "original error" = the error the seam throws today
  including these transformations; telemetry adds **no additional wrapping**; `outcome` is derived
  by inspecting the existing structured error, never by replacing it; the timed span covers the
  fetch leg only, excluding the pre-try interlock assert; `lib/dataverse/client.js` errors (raw
  fetch, no existing transform) propagate unwrapped.

### F2 (`lib/dataverse/client.js` browser-import safety) — CONFIRMED

- `lib/dataverse/client.js:11-29`: the module carries an explicit browser-import-safety contract —
  `fs`/`path` deferred behind variable-path requires because the module is reachable from a browser
  bundle via the settings-service dispatch chain; its single static require (`core/interlock.js`)
  is bundler-safe by that module's own contract. A top-level observability require (transitively
  `node:async_hooks`) would violate this.
- **Plan change:** Stage 1 now mandates a **lazy, server-only** integration inside the call bodies
  using the file's existing deferred-require pattern; `request-correlation.js` must itself be
  browser-import-safe; **`npm run build`** added to Stage 1 gates as the enforcement check.

### F3 (explicit `event` field and `'unknown'` dependency variant) — CONFIRMED

- The prior v1 contract named `workbench.dependency` only in prose and declared
  `dependency: 'dataverse' | 'azuread' | 'graph'` while the classifier prose emitted `'unknown'` —
  an internal union/prose mismatch.
- **Plan change:** the contract now includes a literal `event: 'workbench.dependency'`
  discriminator field and `'unknown'` as a first-class member of the dependency union.

### F4 (global shared-seam vs Workbench-only sampling justification) — CONFIRMED

- The three seams are app-wide transports (all `DynamicsService`/Graph/`client.js` callers emit
  once wrapped — other routes, crons, cold-start checks), so "workbench traffic is low-volume"
  was the wrong denominator for a 100% sampling claim.
- **Plan change:** sampling is now stated as 100% of **all** seam traffic; un-instrumented
  callers emit without correlation fields (the defined behavior); the window filters on
  `routeName`; the event name is documented as naming the initiative, not a scope restriction;
  any volume-driven sampling change is a named follow-up, not an implementer choice. (The
  "justified by whole-app volume" phrasing this pass introduced was itself unverified and is
  superseded by third-pass T5: the volume/cost assumption is now explicitly labeled unverified
  with a validation plan and stop threshold.)

### F5 (executable, bounded log-export command) — CONFIRMED

- The prior "dashboard export or `vercel logs`" workflow was not executable.
- **Plan change:** a concrete capture-slice command (`timeout`-bounded `npx vercel logs
  <production-deployment-url> --json` piped through a `jq` filter on the `event` discriminator,
  appended to date-stamped NDJSON in scratch), with stated preconditions (`vercel login` +
  `vercel link`, or `--scope`/`--token`), per-event timestamps sourced from the platform log
  record, volume bounded by the filter, rotation by filename, and window-end aggregation. The
  exact CLI flag/JSON shapes are labeled `[ASSUMED]` pending window-start confirmation, with the
  dashboard export / Log Drain named as the fallback.

## Third pass — Codex third review (2026-08-15), six findings

**Provenance:** as with the second pass, no on-disk artifact for this review was found (worktree,
main checkout tree, origin branches, `outputs/`); findings are dispositioned from the owner-relayed
work order and were verified locally before revision.

### T1 (helper timeouts classify as `causeKind: 'abort'`, not `'timeout'`) — CONFIRMED

- `[VERIFIED via lib/utils/service-error.js:88-92]` `AbortError` → `causeKind: 'abort'`;
  `'timeout'` is reserved for `ETIMEDOUT`/undici header/body-timeout codes. Both helpers implement
  their timeout via `AbortController.abort()` (`dynamics/http.js:39-42`, agent-verified Graph
  equivalent), and caller signals are overwritten (`http.js:25-30`), so a helper-seen abort IS the
  helper's timeout. The prior mapping ("timeout-shaped causeKind → 'timeout'") would have
  misclassified every helper timeout as `network_error`.
- **Plan change:** exact mapping `causeKind ∈ {'abort','timeout'}` → `outcome: 'timeout'`; all
  other causeKinds → `network_error`; `service-error.js` unchanged; the structured error object
  and public semantics preserved (telemetry only reads it).

### T2 (emitter must be `console.log(JSON.stringify(event))`) — CONFIRMED

- `[VERIFIED via local Node check]` `console.log(object)` emits inspect format
  (`{ event: 'workbench.dependency', … }`) which `JSON.parse` rejects; `JSON.stringify` output
  parses.
- **Plan change:** emitter contract is exactly `console.log(JSON.stringify(event))`, guarded so
  telemetry failures (including a stringify throw) cannot fail the request; planned unit test
  asserts the captured argument parses as JSON and contains the literal
  `event: 'workbench.dependency'` discriminator; the documented log filter
  (`"event":"workbench.dependency"`) matches this exact serialization.

### T3 (log workflow was a false live-tail; CLI 59.0.0 is historical-by-default) — CONFIRMED

- `[VERIFIED via `vercel --version` = 59.0.0 and `vercel logs --help`]` `vercel logs` performs
  historical queries by default; `--follow` streams; flags `--project`, `--environment`,
  `--since`, `--until`, `--query`, `--json`, `--limit` (default 100) all present.
- **Plan change:** the capture command is now a fail-closed historical slice: `set -euo pipefail`
  (no stderr suppression), `mktemp -d` (or defined path) for output, explicit
  `--project`/`--environment production`/`--since`/`--until`, server-side `--query` on the
  discriminator, `--json`, explicit `--limit 5000`, line-count-at-limit ⇒ truncated ⇒ exit 1 and
  re-slice; Log Drain / dashboard export is the **required** fallback when completeness cannot be
  proven within retention/result limits; overlap dedup rule (request id + timestamp, `sort -u`
  fallback); command/version contract re-verified at window start with no assumption that a CLI
  upgrade preserves flags. The retention bullet now states that historical queries reach only
  records within retention, so capture cadence must beat retention.

### T4 (misleading "Out of scope" conflated emission and measurement) — CONFIRMED

- Wrapping shared seams instruments **all** their callers, including the ~55 operational scripts
  requiring `lib/dataverse/client.js` (script events carry no correlation fields and land on the
  invoking terminal's stdout, not platform logs). Labeling the scripts row "Out of scope" was
  misleading.
- **Plan change:** the inventory now defines instrumentation/emission scope (all wrapped-seam
  callers) versus target measurement scope (the three Workbench routes, selected by `routeName`),
  the table columns are "Stage 1 wrapped?" / "Who emits once wrapped", and the not-wrapped rows
  (export tooling, health-checker) are labeled "no emission" rather than "out of scope". This
  supersedes the second pass's F4 wording in place.

### T5 (remaining "low volume" justification was unverified) — CONFIRMED

- No measurement of whole-application dependency-call volume or log cost exists; "a staff/intake
  app is low-volume" was an inference presented as justification.
- **Plan change:** the sampling choice now rests on an explicitly labeled
  `[ASSUMED — explicitly unverified]` whole-application volume/cost assumption, with a defined
  validation (count `workbench.dependency` lines per day in the first 48 hours after enabling)
  and a concrete stop/re-scope threshold (~50,000 lines/day, observed throttling/truncation, or a
  visible cost line item ⇒ STOP; revert or land a named sampling knob as a reviewed follow-up).

### T6 (durable-state cleanup: sweep claim and stale present-tense baseline) — CONFIRMED

- The narrow-sweep "zero live stale claims" statement below is a **first-pass** record; passes two
  and three each found and removed further contradictions, so it holds only as of each pass's own
  scope. Restated: **as of the third pass, the two live surfaces again contain zero known stale
  claims** — the pass-1/pass-2 wordings corrected in later passes are visible in this artifact's
  per-pass sections, which is the audit trail, not a live contradiction.
- `SESSION_PROMPT.md` said "`main` is at `171c46a9` and auto-deployed" — present-tense and stale
  (the local baseline has advanced). Reworded as historical Session 428 state.

## Fourth pass — Codex fourth review (2026-08-15), findings Q1–Q3

**Provenance:** findings relayed in Codex's review message accompanying the owner work order
(with Vercel documentation citations); verified against the plan text and the emission/count
semantics before revision. Codex independently re-verified the third-pass corrections and re-ran
the ten documentation gates + self-tests, lint, and production build (all passed) before raising
these.

### Q1 (dedup key `requestId`+timestamp / `sort -u` is not sound) — CONFIRMED

- Vercel's `requestId` identifies the whole HTTP request (every log line of a request shares it),
  multiple dependency events in one request can share a timestamp resolution, and full-line
  `sort -u` collapses legitimate identical calls — corrupting exactly the dependency-call-count
  numerator Stage 2's acceptance formula depends on.
- **Plan change:** `eventId` (fresh `crypto.randomUUID()` per emitted event, PII-free by
  construction) added to the v1 envelope with a planned uniqueness test; deduplication is
  permitted **only** on parsed `eventId`; `requestId`+timestamp and full-line `sort -u` are
  prohibited; a verified-unique platform log-record id is an acceptable alternative only after
  explicit window-start preflight confirms its presence and uniqueness, failing closed when
  absent.

### Q2 (`--query` exact-match overclaim; truncation must precede filtering) — CONFIRMED

- `vercel logs --help` (the basis of the third-pass verification) proves the `--query` flag
  exists; it does not prove matching semantics. Vercel documents `--query` as full-text search;
  the quoted colon expression may be parsed as query syntax. Additionally, checking truncation on
  a server-filtered result says nothing about what the server dropped.
- **Plan change:** two-step workflow — coarse full-text `--query 'workbench.dependency'`
  explicitly labeled a volume-reduction hint; RAW unfiltered NDJSON written first; truncation
  checked on RAW line count **before** any filtering (at-limit ⇒ exit 1); the filter of record is
  local `jq` parsing of `.message` via `fromjson?` selecting `event == "workbench.dependency"`,
  failing closed (error, not silent skip) on events missing required fields; dedup on the Q1
  `eventId`; Log Drain / dashboard export remains the required fallback when completeness or JSON
  shape cannot be proven. The plan now separates what `--help` verified (flag existence) from
  what a window-start preflight against a known emitted event must confirm (query behavior,
  `--json` record field shape). The sink bullet's "filter matches this exact serialization"
  claim was corrected to match.

### Q3 (`operation` declared but underived in a PII-safe contract) — CONFIRMED

- The envelope declared `operation` while defining allowlisted derivation only for `dependency`
  and `resourceClass` — an open field in a contract whose whole point is a closed value space.
- **Plan change:** `operation` = uppercase HTTP method matched against the fixed allowlist
  `{'GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS'}`, anything else → `'unknown'`
  (fail-closed); never a URL, path, query fragment, entity id, filename, or caller-provided
  string; redaction/contract tests assert membership including a seeded weird-method →
  `'unknown'` case.

### Fourth-pass corrections of record

- Script-consumer count: Codex independently counted **56** files under `scripts/` directly
  importing/requiring `lib/dataverse/client.js`; the plan's "~55" (from the first-pass trace) is
  corrected to the verified 56.
- CLI pinning: installed 59.0.0 is behind published 59.1.3; the plan stays pinned to the tested
  version, forbids silent upgrade mid-plan, and requires complete workflow revalidation on any
  upgrade.
- The third-pass "the revised plan contains no claim contradicted by current source" statement is
  **superseded for the Q1–Q3 surfaces** (they contained the defects above at the time it was
  written); the original third-pass wording remains in the branch history (`5f38f006`) as the
  point-in-time record.

## Final verdict

**READY WITH NAMED CHANGES** — contract-reconcile Mode A over the revised plan (2026-08-15,
fourth pass). The named changes are the owner items above plus the window-start preflight
obligations now written into the plan, not structural rework. All findings across the four review
passes (8 + 5 + 6 + 3) are CONFIRMED and folded in; as of this pass the revised plan contains no
known claim contradicted by current source or platform documentation; it remains a draft not
authorized for implementation.
