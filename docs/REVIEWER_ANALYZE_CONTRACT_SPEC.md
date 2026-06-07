# Implementation Spec — Reviewer Analyze Reliability Contract (slice)

Status: **SPEC, IN IMPLEMENTATION.** Per-slice implementation spec derived from
`REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` §4.4/§5/§7. Labels: `[VERIFIED]`
(read from source this session), `[PROPOSED]`, `[OPEN]` (decide with reviewer).

## Goal
Stop the analyze stage from **silently succeeding on a bad response**. Live smoke
hit this twice: request 1002899 returned an empty model response (0
suggestions/title/queries) and 1003032 returned 1 suggestion for 12 requested —
both flowed downstream as `success:true`. Add a **validation + retry/repair +
typed-failure contract** so an invalid analyze is retried once and, if still bad,
returns a typed retryable failure instead of a success.

## Scope decision (read first)
This slice is the **reliability contract only**. It deliberately does **NOT**:
- rewrite Stage 0 to schema-JSON output (the plan §4.4 end-state),
- remove parametric candidate generation,
- add `grantScreening`/`proposalPeople`/`referenceIds`/`sourcePlan`,
- touch the provenance DTO.

Rationale (sequencing): the plan's §7 phase-3 bundles "JSON output + no parametric
names" with the contract, but **removing candidate generation cannot land before
field-routed retrieval sources exist (phase 4)** or PubMed-blind fields (astro)
lose all candidates. `[OPEN, flag in plan]` This is a real tension in the plan's
phase ordering. So this slice keeps the current delimiter output + parser +
candidate generation, and only hardens reliability around them. The full
JSON/no-generation rewrite is deferred to the retrieval-first phase.

## Current behavior (pre-refinement; historical) `[HISTORICAL]`
- `ClaudeReviewerService.analyzeProposal` (`lib/services/claude-reviewer-service.js`)
  makes ONE LLM call, parses delimiter/markdown text via `parseAnalysisResponse`,
  calls `validateAnalysisResult`, and **returns `success:true` with the validation
  object attached even when `valid:false`** (`:203-233`). No retry.
- `validateAnalysisResult` (`shared/config/prompts/reviewer-finder.js:478`) only
  warns on: missing title, zero suggestions, zero queries.
- `_callLLM` returns `{text, model, usedFallback}` and **discards `stopReason`**,
  though `LLMClient` exposes it (`llm-client.js:366,385,504`,
  `stop_reason`/stream `delta.stop_reason`). `MAX_TOKENS=4096`.
- The route `pages/api/reviewer-finder/analyze.js` already maps `!result.success`
  → `sendEvent('error', {message:'Analysis failed', details:result})` and ends
  (`:203-206`). It honors an admin deadline `AbortSignal`
  (`reviewer.time_budget_seconds`) bounding the whole search.
- The two analyze consumers are the Workbench shared panel and the standalone
  reviewer finder page. The Workbench path reads SSE frames with event names and
  treats `event:error` payloads shaped as `{message}` as failures. The standalone
  path is hand-rolled, reads one `data:` line at a time, ignores `event:`
  semantics, and can miss route error frames.
- `pages/api/workbench/enrich-recommended.js` calls `analyzeProposal` with
  `reviewerCount:1` only to obtain `proposalInfo`; reviewer suggestions are not
  consumed on that path.

## The contract `[PROPOSED]`

### 1. Surface the stop reason
`_callLLM` returns `stopReason` (from `client.complete()`); `analyzeProposal`
threads it so validation can detect truncation (`stopReason === 'max_tokens'`).

### 2. Strengthen `validateAnalysisResult` with a mode-aware validator
Keep `validateAnalysisResult(result)` exported for back-compat. Add a richer
mode-aware validator with inputs:
`{ reviewerCount, stopReason, excludedNames, analysisPurpose }`. It produces
`{ valid, issues:[{code,message,severity}], sanitizedResult, severity }`.
Checks:
- **empty/parse-failure:** no title AND zero suggestions (the 1002899 case).
- **suggestion floor (the core blocker):** fewer than `minSuggestions` *usable*
  suggestions → invalid in `analysisPurpose:'search'` only. "Usable" = non-
  placeholder, complete, after dedup + excluded removal. Floor is
  `min(reviewerCount, max(3, ceil(reviewerCount / 2)))`.
- **placeholder detection:** count entries whose name/institution/reasoning are
  self-retracted (bracketed name, "Insufficient certainty", "Replaced",
  "substituting", "N/A"). Strip them from the success payload; mark invalid only
  if placeholders were >20% of suggestions. (Otherwise a stripped warning.)
- **Sanitize-don't-block quality issues (warnings, not hard failures):** these
  were over-strict in the first build (a single one wrongly failed an otherwise-
  usable analysis + wasted a repair attempt). They are now sanitized and reported
  as warnings; only their effect on the *floor* can block:
  - **per-reviewer completeness:** incomplete entries (bare `NAME`, no detail) are
    DROPPED from the surfaced payload and do NOT count toward the floor, while
    still producing a non-blocking warning.
  - **exact-duplicate names:** later duplicates are DROPPED (kept one), via the
    existing normalizer in `lib/utils/reviewer-name-match.js` (the 19-for-12 case);
    if an incomplete entry appears before a complete same-name entry, keep the
    complete entry.
  - **excluded names:** matches to `excludedNames` are DROPPED (they are already
    hard-filtered downstream regardless), via the same shared normalizer.
- **truncation:** `stopReason === 'max_tokens'`, OR reviewers present but the
  queries section is empty/absent (the observed truncation signature).
- existing: title present; at least one query. Prefer source-aware coverage, but
  the hard contract for this slice is at least one parsed query.
- `analysisPurpose:'proposal_info'` bypasses the suggestion floor so
  enrich-recommended can keep using the analyze path for COI context if
  `proposalInfo` parsed.

### 3. Retry / repair (max 2 attempts total)
- **Attempt 1:** the normal composed prompt (`composeAnalyzePrompt` over the
  resolved per-user→dataverse→code body — unchanged).
- If invalid AND budget remains (check `!signal.aborted` and
  `(deadlineAt - Date.now()) >= minRepairMs` before re-calling):
  - **empty / transient** → plain retry.
  - **truncation** → retry with `maxTokens:8192` and concise repair
    instructions. Use a larger `minRepairMs` for this path.
  - **below-floor / missing-queries** → repair prompt = original + a short
    instruction block listing the (blocking) validation issues and requiring:
    exactly `reviewerCount` distinct real reviewers, complete fields, no
    placeholders. (Dups/excluded/incomplete are sanitized in place, so they no
    longer drive a retry on their own — only the resulting floor breach does.)
    The repair prompt is a code-owned trusted block added by
    `composeAnalyzePrompt({ repairInstructions })`, outside the wrapped
    untrusted proposal text and outside editable/overridable saved prompt bodies.
    Prompt-injection-tagging must continue to pass.
- **Attempt 2 still invalid** → typed failure (below). Never a 3rd attempt.

### 4. Typed failure (replaces success-on-invalid)
`analyzeProposal` returns `{ success:false, status:'analysis_invalid',
validation:{issues}, attempt, maxTokens, stopReason, usedFallback, model }` and
NO result frame when the final attempt is invalid in search mode. (Today it
returns `success:true`.) In `proposal_info` mode, do not fail on the suggestion
floor; return `proposalInfo` if it parsed.

### 5. Route + UI
- `analyze.js`: on `success:false`, enrich the existing `error` event with
  `status:'analysis_invalid'`, `retryable:true`, and a user-facing message
  (e.g. "Couldn't reliably analyze this proposal. Please retry the analysis.").
  Keep the SSE framing; do not proceed to `result`/`complete`.
- UI: both analyze consumers surface `analysis_invalid` as retryable. The copy
  must not imply the proposal itself is not a research grant; it should say the
  analysis response was incomplete or unreliable and can be retried.

### 6. Budget / cost
A 2nd LLM call adds latency + one more `api_usage_log` row. Retry only if the
admin deadline budget has room; if not, fail typed rather than risk a route
timeout. `[VERIFIED]` the deadline `AbortSignal` already bounds the call.

## Files to change `[PROPOSED]`
- `lib/services/claude-reviewer-service.js` — `analyzeProposal` (retry loop,
  typed failure), `_callLLM` (return `stopReason`).
- `shared/config/prompts/reviewer-finder.js` — richer validator; optional
  repair-instruction helper.
- `lib/services/reviewer-prompt-composer.js` — IF the repair prompt needs an
  extra instruction block; it will be code-owned and A7-safe.
- `pages/api/reviewer-finder/analyze.js` — enrich the error event payload.
- Frontend (TBD exact file) — retryable error state.
- Tests (below).

## Tests `[PROPOSED]`
- Empty response → retry → still empty → `success:false, status:'analysis_invalid'`.
- Below-floor response → retry → success if retry yields a full list, otherwise
  typed failure.
- Truncation (`stopReason:'max_tokens'`) detected → retry with higher tokens →
  success; assert the higher `maxTokens` was used.
- Valid first attempt → `success:true`, exactly one LLM call (no retry).
- Duplicate roster (19-for-12) → flagged + deduped via shared normalizer.
- Sanitize-not-block: a single duplicate/excluded/incomplete entry with enough
  usable suggestions remaining → `valid:true` with warning(s), not a typed failure
  (dups/excluded/incomplete dropped from the payload; incomplete also stays off
  the floor).
- Placeholder suggestions are stripped from successful payloads and count toward
  invalidity when the stripped list falls below the floor or placeholders exceed
  20%.
- `proposal_info` mode bypasses the suggestion floor.
- Budget preflight skips attempt 2 when the deadline is too near.
- Route: `success:false` emits an `error` event with `status:'analysis_invalid'`
  + `retryable:true`.
- A7/back-compat: existing `reviewer-prompt-composer` byte-parity tests still pass.

## Out of scope (later slices)
JSON-schema Stage-0 output; `grantScreening`/`proposalPeople`/`referenceIds`/
`sourcePlan`; removing parametric generation; provenance DTO; field-routed
sources. (See plan §4.1–4.4, §7 phases 4–6.)

## Review decisions folded in
1. Keep delimiter output, parser, and parametric candidate generation for this
   slice. JSON output, provenance DTO changes, source-plan changes, and generation
   removal stay out of scope.
2. Use the search-only floor `min(reviewerCount, max(3, ceil(reviewerCount / 2)))`;
   `proposal_info` mode bypasses that floor.
3. Truncation repair raises `maxTokens` to `8192` and adds concise code-owned
   repair instructions.
4. Placeholder suggestions are stripped from successful payloads and counted
   toward invalidity when they breach the floor or 20% threshold.
5. One repair attempt is allowed only when abort/deadline preflight says enough
   budget remains.
