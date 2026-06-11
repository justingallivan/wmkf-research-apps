# Phase 2 design — Executor Claude transport convergence (raw `fetch` → `LLMClient`)

**Status:** Design / pre-implementation. For Codex review before coding.
**Source finding:** `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` P2 — "Shared Executor still calls Claude with raw `fetch` instead of the canonical `LLMClient`."
**Remediation tracker:** `docs/security-audit/SECURITY_AUDIT_REMEDIATION_PLAN_2026-06-11.md` Phase 2.

## Problem (verified against source)

`lib/services/execute-prompt.js` `callClaude()` (`:402`-`441`) POSTs to
`BASE_CONFIG.CLAUDE.API_URL` with a hand-rolled `fetch`:
- no abortable timeout (the raw fetch can hang indefinitely),
- no 429/529 retry or fallback,
- no SSRF allowlist (`safeFetch`),
- no API-key redaction on thrown errors,
- no `api_usage_log` usage row.

`lib/services/llm-client.js` is the documented canonical wrapper that adds all of
the above. The Executor is the shared Vercel↔PowerAutomate prompt surface
(`docs/EXECUTOR_CONTRACT.md`), so transport inconsistency here is higher-leverage
than a one-off route.

## Key constraint — the cache_control system array

`callClaude()` sends a single `cache_control` marker at the system/user boundary
(`execute-prompt.js:432`):

```js
system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
```

This produces a stable cache-key prefix across reruns; **cache-hit behavior must
be preserved exactly.**

**Good news (verified):** `LLMClient.complete()` already accepts `opts.system` as
`string | Array` and passes it through verbatim — `_buildBody()` (`llm-client.js:193`)
does `if (opts.system != null) body.system = opts.system`. **No LLMClient change is
required** to preserve the cache_control system array. This retires the remediation
plan's open question ("extend LLMClient vs. intermediate safeFetch") — neither is
needed; pass the array straight through.

## Downstream contract the Executor depends on (verified)

The rest of `execute-prompt.js` reads the **raw Anthropic snake_case** response:
- `claudeResp.usage?.cache_read_input_tokens` → cache-hit detection (`:133`)
- `claudeResp.content?.[0]?.text` → output parsing (`:139`, `:449`)
- `claudeResp.usage` → returned to caller (`:174`) and rendered in `buildSuccessNotes`
  (`:642`, `:652`: reads `input_tokens` / `output_tokens` / `cache_creation_input_tokens`
  / `cache_read_input_tokens`)
- model used → `modelUsed` in `writeRunRow` (`:602`)

`LLMClient.complete()` returns a **normalized** shape instead:
`{ text, content, model, usage: { inputTokens, outputTokens, cacheCreationTokens,
cacheReadTokens }, stopReason }` (`normalizeUnaryResponse`, `llm-client.js:353`).
`content` is still the raw block array (so `content[0].text` is unaffected), but
`usage` is camelCase and `text` is pre-joined.

## Chosen approach — thin adapter, zero downstream churn

Keep `callClaude()` as the Executor's internal seam. Inside it, call
`LLMClient.complete()` and **re-shape the normalized response back to the raw
Anthropic shape** the rest of `execute-prompt.js` already consumes. Blast radius =
`callClaude()` only; cache-hit detection, `buildSuccessNotes`, the parse step, and
the audit row are all untouched.

Rejected alternative: migrate every downstream consumer to the normalized shape.
More churn across cache-hit + notes + parse + return usage, higher regression risk,
no benefit — rejected.

### Sketch (illustrative, not final)

```js
async function callClaude(promptRow, { system, body }) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('CLAUDE_API_KEY not set');

  await loadAvailableModels();                       // unchanged — warm resolver
  const rawModel = promptRow.wmkf_ai_model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL;
  const model = resolveModel(rawModel) || rawModel;  // unchanged — Executor resolves
  const maxTokens = promptRow.wmkf_ai_maxtokens || BASE_CONFIG.MODEL_PARAMS.DEFAULT_MAX_TOKENS;
  const temperature = promptRow.wmkf_ai_temperature != null
    ? Number(promptRow.wmkf_ai_temperature)
    : BASE_CONFIG.MODEL_PARAMS.SUMMARIZATION_TEMPERATURE;

  const client = new LLMClient({ apiKey, model }); // no appName — see decision 1 (avoid double api_usage_log)
  const r = await client.complete({
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: body }],
    maxTokens,
    temperature,
  });

  // Re-shape to the raw Anthropic shape the rest of execute-prompt.js expects.
  return {
    content: r.content,                              // raw blocks — content[0].text intact
    model: r.model,
    usage: {
      input_tokens: r.usage.inputTokens,
      output_tokens: r.usage.outputTokens,
      cache_creation_input_tokens: r.usage.cacheCreationTokens,
      cache_read_input_tokens: r.usage.cacheReadTokens,
    },
  };
}
```

## Decisions to confirm (flag for Codex)

1. **`appName` / usage logging — DOUBLE-COUNT HAZARD.** Passing `appName` makes
   `LLMClient` write an `api_usage_log` row on success+failure. **But the
   Executor's own driver route already logs usage:**
   `pages/api/phase-i-dynamics/summarize-v2.js:116` calls `logUsage({...})`
   directly (verified). So passing `appName` inside `callClaude()` would write a
   **second** `api_usage_log` row per run → double-counting.
   **Recommendation (revised):** **omit `appName`** in `callClaude()` to preserve
   current behavior (the route remains the single usage-logger; the Executor still
   writes its Dataverse `wmkf_ai_run` row, and `LLMClient` still gives timeout /
   retry / safeFetch / redaction without logging). Treat "consolidate usage logging
   into the Executor and drop the route-level `logUsage`" as a separate, explicit
   follow-up — do NOT bundle it here. Codex: confirm no *other* Executor driver
   (PowerAutomate trigger path) also logs usage in a way the omit-appName choice
   would now under-count.
2. **Timeout.** Raw fetch had *no* timeout; `LLMClient` default is 120s. This is a
   behavior change (now bounded). Desired per the finding. Confirm 120s is safe for
   the largest Executor prompts, or pass a higher `timeoutMs`.
3. **fallbackModel.** Raw fetch had none. Leave `null` (preserve behavior) unless we
   want 529 resilience now. Recommendation: leave null this pass.
4. **Error message shape.** `LLMClient` throws `Claude API error <status>: <text>`
   (redacted); raw threw `Claude API error (<status>): <body>`. Confirm no caller /
   test matches the exact old string. The failure audit row stores `err.message`;
   redaction is an improvement, not a regression.

## Files touched

- `lib/services/execute-prompt.js` — `callClaude()` body only (+ import `LLMClient`).
- Possibly `docs/EXECUTOR_CONTRACT.md` + `docs/AI_DATA_FLOW_MATRIX.md` row for
  `execute-prompt.js` if we want to note the transport now goes through `LLMClient`.

## Tests / verification

- Existing Executor tests must stay green:
  `npx jest tests/unit/execute-prompt-payload-boundary.test.js tests/unit/execute-prompt-multi-output.test.js tests/unit/execute-prompt-impersonation.test.js --runInBand`
- **New regression test:** mock `LLMClient.complete` (or `safeFetch`) and assert the
  Executor's outbound body still carries
  `system: [{ type:'text', text, cache_control:{ type:'ephemeral' } }]` — pins the
  cache-control payload so a future refactor can't silently drop it.
- Assert cache-hit detection still fires: given a complete() result with
  `cacheReadTokens > 0`, `cacheHit === true` and `buildSuccessNotes` prints the
  token line.
- `rg -n "BASE_CONFIG\.CLAUDE\.API_URL|fetch\('https://api\.anthropic" lib pages shared modules`
  → no Executor hit remains.
- `npm run build && npm run lint`.

## Out of scope

After this lands, the remaining raw `fetch` **completion** paths to
`api.anthropic.com/v1/messages` are `lib/utils/health-checker.js:37` (static health
ping — acceptable) and `modules/expertise_matching/src/reviewer_matcher.jsx:605`
(demo — confirm production-reachability separately).

Separately out of scope (raw fetch to Anthropic, but **not** completion calls, so a
different concern): `lib/services/model-resolver.js:49` (`/v1/models` listing) and
`lib/services/anthropic-admin.js` (`api.anthropic.com` admin/usage API). Note
`lib/services/multi-llm-service.js:253` already uses `safeFetch`, not raw fetch.
