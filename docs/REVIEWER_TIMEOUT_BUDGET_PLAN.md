---
title: "Reviewer Search Time-Budget Plan (S223)"
domain: reviewer-workbench
kind: plan
status: active
summary: "Status: IMPLEMENTED — pre-impl Codex design review + post-impl Codex review (findings #1–#5 fixed, see \"Post-impl\" below). 1943 tests + 10 gates +..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - lib/services/honorarium-config.js
  - lib/services/reviewer-time-budget.js
  - pages/api/reviewer-finder/
  - pages/api/workbench/enrich-recommended.js
---

# Reviewer Search Time-Budget Plan (S223)

**Status:** IMPLEMENTED — pre-impl Codex design review + **post-impl Codex review (findings #1–#5 fixed, see "Post-impl" below)**. 1943 tests + 10 gates + lint green.
**Owner task:** Topic #1 from `project-reviewer-finder-next-topics` — "extend / make-configurable the Claude reviewer-call timeout." Justin nearly lost a reviewer search to a timeout.

## Problem

A reviewer search can be killed by a timeout before it returns. There are **two distinct timeout layers**, routinely conflated:

| Layer | Current value | Bounds | Runtime-configurable? |
|---|---|---|---|
| **Route wall** — Vercel `maxDuration` (`export const config`) | **300s** on `reviewer-finder/{analyze,discover,generate-emails}.js` + `workbench/enrich-recommended.js`; 120s on `load-proposal.js` | the **sum** of all work in the request (DB searches + every Claude call + enrichment) | **No** — provisioned at deploy time |
| **Per-Claude-call timeout** — `llm-client.js` `DEFAULT_TIMEOUT_MS` | **120s**, `maxRetries:3` (retries on 429/529 **only**, NOT on timeout) | a single Claude API call | Yes — constructor `timeoutMs`, but reviewer callers pass no override |

`discover.js` is the long pole: it chains `DiscoveryService.discover` (external DB searches) → COI checks → `ClaudeReviewerService.generateDiscoveredReasoning` (Claude) → enrichment (`contact-enrichment-service`, more Claude + Scholar/ORCID/SerpAPI), all sequential. That **sum** is what hits the 300s route wall. The S222 incident (`analyze.js` raised 90→300) was this same route-wall failure, surfacing as a silent "Analysis returned no result."

## Hard platform constraint (verified, not assumed)

`maxDuration` is **build-time only**. Vercel provisions a function's timeout at deploy from `export const config` / `vercel.json`; there is **no runtime API for a function to extend its own provisioned timeout**. (Confirmed against the Vercel Functions reference; not from memory.) Therefore an admin-editable Dataverse value **cannot** change the platform route wall live — that would always require a redeploy.

**Plan tier (verified by inference):** `vercel.json` declares **12 cron jobs**, three sub-daily (`*/2`, `*/15`, `0 */6`). Hobby caps crons at 2 jobs / daily-only — impossible on either count. So this is **Pro (or Enterprise)**, where the `maxDuration` cap with Fluid Compute (default-on) is **800s**. (Hobby 300 / Pro 800 / Enterprise 800.) Dashboard caveat to confirm once: Fluid Compute not explicitly disabled.

## Decision (Justin, S223)

- Admin-configurable time budget, **default 600s, hard cap 800s** (can't be raised above the plan ceiling).
- Per-call timeout **also tunable**, **derived from remaining budget** (single knob — no separate per-call admin setting).

Because the platform wall can't be live-editable, the admin number is implemented as an **application-level wall-clock deadline** *below* a statically-pinned platform ceiling.

## Design

### 1. Pin the platform wall at the plan max (static)
Set `maxDuration: 800` on the reviewer search routes: `reviewer-finder/{analyze,discover,generate-emails}.js` and `workbench/enrich-recommended.js`. Maximum platform headroom; the app-level budget always lives at or below it, so the platform never 504s before the graceful deadline fires. `load-proposal.js` stays 120 (not a long-pole; out of scope unless review disagrees). Update the inline comment on each to point at this doc.

> These routes do not match any `vercel.json` `functions` glob (`analyze-*.js` matches top-level `analyze-funding-gap.js`, not `reviewer-finder/analyze.js`), so the in-file `export const config` is the live lever — confirmed.

### 2. Admin-configurable budget (Dataverse, live)
New `wmkf_appsystemsettings` key **`reviewer.time_budget_seconds`**, modeled exactly on `honorarium.default_amount` (`lib/services/honorarium-config.js` + `getSettingStrict`):
- **Default 600** (documented first-run fallback when key absent).
- **Clamped to [120, 800] inside the leaf** (Codex Q1: clamp once in the service, routes consume trusted seconds/ms) — out-of-range values are clamped, not rejected. Malformed/non-numeric → clamp-fail to the **600 default** with a `console.warn` (this is a soft time limit, not a money write — do NOT throw the way honorarium-config does; a search on the default budget beats no search).
- **Settings-fetch failure → return the 600 default** (log it), do not throw. This is the deliberate divergence from the `honorarium-config` template: honorarium throws on fetch failure because it gates a money write; the time budget gates search duration, where falling back to a sane default is correct. (Codex Q1 confirmed.)
- New leaf `lib/services/reviewer-time-budget.js` exporting `getReviewerTimeBudgetSeconds()` (always returns a clamped, finite number — never throws) + the KEY/DEFAULT/MIN/MAX constants.

### Scope of enforcement (Codex correction — read first)
The budget is a **soft bound on the LLM calls**, **best-effort on the full pipeline** — NOT a hard wall on every operation. Honest framing so the abort behavior isn't oversold:
- **Enforced (deadline-aware):** every reviewer Claude call (the long pole) and its retry backoff.
- **Best-effort (first pass):** `discovery-service.js` rate-limit `setTimeout` sleeps and external-service calls (PubMed/ArXiv/Scholar/ORCID/SerpAPI) do **not** accept the signal today; an in-flight external call after the deadline runs to its own timeout, then the next LLM call aborts immediately. Making those deadline-aware is a follow-up, explicitly out of scope here.
- **Backstop:** the static `maxDuration:800` platform wall still hard-kills anything that blows past the budget by a wide margin.

### 3. Deadline plumbing (the real work)
At request start in each reviewer route, read the budget and create one shared deadline. **The `clearTimeout` in `finally` is mandatory, not optional** (Codex: leaked-timer risk otherwise):
```js
const budgetMs = (await getReviewerTimeBudgetSeconds()) * 1000; // already clamped+defaulted by the leaf
const deadlineAt = Date.now() + budgetMs;
const ac = new AbortController();
const deadlineTimer = setTimeout(() => ac.abort(new Error('reviewer_time_budget_exceeded')), budgetMs);
try {
  // ... pass ac.signal + a per-call timeoutMs (see below) into every reviewer LLM call
} finally {
  clearTimeout(deadlineTimer); // REQUIRED — every route, no exceptions
}
```
Thread `signal` (and `deadlineAt`, to derive the per-call ceiling) through the existing call chains (all currently accept no signal):
- `DiscoveryService.discover(analysisResult, options)` → add `options.signal`/`options.deadlineAt`, forward to internal Claude + enrichment calls.
- `ClaudeReviewerService._callLLM({...})`, `generateDiscoveredReasoning(...)`, and `analyzeProposal(...)` → accept `signal`/`deadlineAt`, pass to `client.complete({ ..., signal })`, and construct the `LLMClient` with the derived per-attempt `timeoutMs` below.
- `contact-enrichment-service` enrichment calls → accept + forward `signal`/`deadlineAt`.
- `generate-emails.js` → `personalizeWithClaude()` is per-candidate and builds an `LLMClient` with no signal/timeout today; it needs the same plumbing, not just the `maxDuration` bump (Codex Q5).

**"Derived per-call timeout" (Codex Q2 — keep a per-attempt ceiling, do NOT use `timeoutMs = budgetMs`):** construct each reviewer `LLMClient` with
```js
const remainingMs = deadlineAt - Date.now();
timeoutMs = Math.max(1, Math.min(remainingMs, PER_ATTEMPT_CAP_MS)); // PER_ATTEMPT_CAP_MS = 180_000
```
and pass the shared deadline `ac.signal` alongside. The per-attempt cap is a hung-socket guard (a single stalled call dies at ≤180s instead of silently eating the whole budget); the deadline signal bounds the total. Because `timeoutMs` is a constructor arg, the client is constructed per-call (or per-stage) so `remainingMs` is current. This is the faithful reading of "derive from remaining budget" — the bound is `min(remaining budget, 180s)` per attempt, total bounded by the deadline. No separate per-call admin knob.

### 3a. `llm-client.js` changes — REQUIRED (Codex correction; my "no change needed" was wrong)
The external signal is currently detached in `_fetchOnce`'s `finally` (~L252) **before** `complete()` reads `response.json()` (~L111) or `stream()` consumes the body via `parseClaudeStream()` (~L148). So as written the deadline does **not** cover body consumption — a budget that fires after headers arrive but mid-body would not abort. Two fixes:
1. **Keep the abort active through body consumption.** Extend the external-signal listener (and a body-read timeout) to cover `response.json()` in `complete()` and the `reader.read()` loop in `stream()`/`parseClaudeStream()` — i.e. don't tear down the abort wiring until the body is fully read or the call resolves. `parseClaudeStream()` must accept the signal and break its read loop with a clean timeout error on abort (Codex: mid-stream timeout gap).
2. **Make retry backoff abort-aware (Codex Q3 — real gap).** `sleep()` (~L450) is a plain `setTimeout`; a cancelled call waits the full backoff before noticing. Change to `sleep(ms, signal)` that clears its timer and rejects immediately on abort, and pass the signal at the `await sleep(delay)` call site in `_fetchWithRetries` (~L229).

These are surgical changes to a shared, high-risk file (`llm-client.js` is the canonical Anthropic transport for every app) — gate behind existing tests + add abort-path tests; verify no behavior change when no signal is passed (the common case for non-reviewer callers).

### 4. Graceful abort surfacing (SSE)
`analyze.js` and `discover.js` stream SSE. On abort (signal fired, error is `reviewer_time_budget_exceeded` or an `AbortError`), emit a terminal frame `data: {stage, status:'timeout', message:'Search exceeded the configured N-minute time budget. An admin can raise it up to 13 minutes at /admin.'}` and close cleanly — never a bare platform 504 or silent "no result." Distinguish budget-abort from a genuine error in the catch. Verify per-route whether each actually uses SSE before assuming the frame shape.

`generate-emails.js` / `enrich-recommended.js` (non-SSE / JSON) → on budget-abort, return a `503` with `{ error: 'time_budget_exceeded', message: '…raise at /admin' }` rather than a generic 500, so the client can show the same guidance.

### 5. /admin UI
Add `reviewer.time_budget_seconds` to the existing settings section that renders `honorarium.default_amount` (number input, min 120 / max 800, helper text: "Max time a reviewer search may run before it stops gracefully. Platform hard cap 800s."). Reuse the existing settings write path (`dataverse-settings-service` upsert).

### 6. Tests
- `reviewer-time-budget.js`: default-when-absent, clamp low (<120→120) / high (>800→800), malformed→600, fetch-fail→600 — assert it **never throws** and always returns a finite clamped number.
- `llm-client.js` abort paths (Codex blocking items): (a) abort fired after headers but before `response.json()` still rejects with an abort/timeout error; (b) abort mid-`parseClaudeStream` read loop breaks cleanly; (c) `sleep(ms, signal)` rejects immediately on abort instead of waiting the full delay; (d) regression: no signal passed → identical behavior to today.
- Deadline: fake-timer test that the pipeline aborts and emits the timeout SSE frame when the budget elapses; that `clearTimeout` runs on the happy path (no leaked timer); that the per-attempt `timeoutMs` is `min(remainingMs, 180_000)`.
- Signal threading: `complete()` receives the shared signal in the discover/analyze/enrich/generate-emails paths.
- Gates: full `check:*` set (no Atlas change expected — see Q6) + full jest.

## Files touched
| File | Change |
|---|---|
| `pages/api/reviewer-finder/{analyze,discover,generate-emails}.js` | `maxDuration` 300→800; deadline create + `clearTimeout` in `finally` + signal threading + SSE timeout frame |
| `pages/api/workbench/enrich-recommended.js` | `maxDuration` 300→800; deadline + signal + `clearTimeout` in `finally` |
| `lib/services/reviewer-time-budget.js` | NEW — settings leaf (honorarium-config shape, but never-throws / clamps to default) |
| `lib/services/llm-client.js` | **REQUIRED (Codex):** keep abort active through `response.json()` (`complete`) + `parseClaudeStream` `reader.read()` loop (`stream`); make `sleep(ms, signal)` abort-aware + pass signal at the backoff call site. Guard: no behavior change when no signal passed. |
| `lib/services/discovery-service.js` | accept + forward `options.signal`/`deadlineAt` to its Claude/enrichment calls (its own rate-limit sleeps stay non-abort-aware this pass — see "Scope of enforcement") |
| `lib/services/claude-reviewer-service.js` | `analyzeProposal`/`_callLLM`/`generateDiscoveredReasoning` accept + forward `signal`/`deadlineAt`; construct `LLMClient` per-call with `timeoutMs = min(remainingMs, 180_000)` |
| `lib/services/contact-enrichment-service.js` | accept + forward `signal`/`deadlineAt` |
| `shared/components/admin/*` (honorarium-amount section) | add budget input (number, min 120 / max 800) |
| `tests/**` | new + updated suites (incl. llm-client abort-path tests) |

Atlas: **no change** — `check:atlas` gates table/entity-set coverage, not individual `wmkf_appsystemsettings` keys, and that entity set is already covered (Codex Q6).

## Resolutions (Codex design review, S223)
All six open questions are resolved; resolutions are folded into the design above.
1. **Settings-fetch failure** → fall back to the 600 default, do not throw (diverge from honorarium-config; honorarium throws because it gates a money write). Clamp in the leaf. → §2.
2. **Per-call timeout** → do NOT use `timeoutMs = budgetMs`; keep a per-attempt ceiling `timeoutMs = min(remainingMs, 180_000)` as a hung-socket guard, with the deadline signal bounding the total. → §3.
3. **Retry backoff** → real gap: `sleep()` is a plain `setTimeout` and does NOT honor abort. Must make `sleep(ms, signal)` abort-aware and pass the signal at the backoff call site. → §3a.
4. **`maxDuration:800` scope** → all four routes (`analyze`, `discover`, `generate-emails`, `enrich-recommended`). → §1.
5. **`generate-emails.js`** → needs the full deadline plumbing, not just the bump: `personalizeWithClaude()` is per-candidate sequential Claude with no signal/timeout today. → §3.
6. **Atlas/registry** → no entry needed; `check:atlas` gates entity-set coverage (already covered), not individual setting keys. → Files-touched note.

### Codex blocking items (must land in the build)
- **`llm-client.js` IS changed** (my pre-review "no change needed" was wrong): keep abort active through body consumption (`response.json()` + `parseClaudeStream` read loop), not just `safeFetch`. → §3a.
- Abort-aware retry `sleep`. → §3a.
- Per-attempt ceiling below remaining budget. → §3.
- Non-LLM discovery/external-API waits are **best-effort only** this pass, explicitly acknowledged. → "Scope of enforcement".

## Post-impl (Codex review of the built diff, S223)
Codex re-reviewed the implementation and found the abort propagated correctly through the analyze/discover LLM path but was **swallowed** on the enrichment + generate-emails paths (the budget was a near no-op there). All HIGH/MEDIUM findings fixed:
1. **#1 (HIGH)** `contact-enrichment-service.enrichCandidate` Tier-3 catch downgraded the rethrown abort to a per-tier "search error" → now rethrows when `signal.aborted` (a non-abort tier error is still swallowed, as intended).
2. **#2 (HIGH)** `enrichCandidates` never checked the signal between candidates → now throws `reviewer_time_budget_exceeded` at the loop top once aborted.
3. **#3/#4 (HIGH)** `generate-emails`: the loop-top guard `break` fell through to mark-as-sent + success frames, and the outer per-candidate catch re-swallowed the inner rethrow → loop-top now **throws** (not break) and the outer catch **rethrows on abort**, so any abort lands in the top-level catch (one timeout frame, no success/DB writes).
4. **#4 (MEDIUM)** `analyze`/`discover` now check `signal.aborted` after the LLM call resolves, before emitting `result`/`complete` (closes the boundary race).
5. **#5 (MEDIUM)** `llm-client`: the per-attempt timeout now stays live through `complete()`'s `response.json()` (hung-socket guard for a stalled unary body); `stream()` still clears it before the read loop so a long generation isn't killed. `_fetchOnce` returns `{response, clearTimer, detach}` so the caller controls teardown relative to body consumption.
- **#6 (LOW)** deliberately NOT changed: an external abort mid-`json()` surfaces as a wrapped "failed to parse response JSON" for non-reviewer callers; reviewer routes detect `signal.aborted` directly, so messaging is correct there. Cosmetic only.

New tests: `tests/unit/contact-enrichment-abort.test.js` (loop-break, mid-batch stop, Tier-3 rethrow, non-abort still swallowed). The `generate-emails`/`analyze`/`discover` route control-flow guards are structurally simple (throw → top-level catch) and covered by code review, not a dedicated SSE integration harness.
