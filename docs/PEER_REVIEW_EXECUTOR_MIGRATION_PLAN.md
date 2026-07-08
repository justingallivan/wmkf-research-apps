---
title: "Peer-Review Summarizer → Executor Migration Plan"
domain: prompt-executor
kind: plan
status: active
summary: "Wire process-peer-reviews.js to executePrompt() so the peer-review-summarizer admin rows drive the live app, preserving per-review A7 wrapping."
canonical: false
cataloged: 2026-07-08
owner: product-engineering
related:
  - pages/api/process-peer-reviews.js
  - shared/config/prompts/peer-reviewer.js
  - shared/config/prompts/peer-reviewer-dynamics.js
  - scripts/seed-peer-review-summarizer-prompts.js
  - lib/services/execute-prompt.js
  - lib/services/field-primer-service.js
  - docs/EXECUTOR_CONTRACT.md
  - docs/PROMPT_LEGACY_AUDIT.md
---

# Peer-Review Summarizer → Executor Migration Plan

## Status: IMPLEMENTED + VERIFIED (S344, 2026-07-08)

Shipped. `process-peer-reviews.js` now calls `executePrompt()` for both the
analyze and questions passes; the `peer-review-summarizer.*` rows were re-seeded
with the `a7_preamble` variable (required, no default) + `{{a7_preamble}}` system
prompt and published (`--execute`, verified). Verification:
- **Content parity: byte-identical.** A scratchpad harness proved the row
  templates interpolated with route variables equal the legacy generator bodies
  exactly (caught + fixed a 1-char trailing-space drift in the generator).
- **E2E smoke: real Claude call passed.** `executePrompt` returned
  `parsed.response_text` (string), preamble landed in `system` (systemChars=720),
  model `claude-sonnet-5`, `runId` written; output preserved OUTPUT 1/2 + review
  count + `<u>Name</u>` reviewer details.
- **Model/params parity:** row `sonnet`/2500/16384/0.3 == `baseConfig`.
- Full `npm test` (5176), `npm run build`, and surface gates green.

## Review outcome (Codex adversarial design review, S344 — SOUND-WITH-CHANGES)

Two HIGH findings, both **verified against code** and folded in below:
- **`parseMode: raw` returns an OBJECT, not a string.** `parseClaudeOutput`
  (`execute-prompt.js:503-508`) returns `{ [outputs[0].name]: text.trim() }`, i.e.
  `{ response_text: "..." }`. The route must read `result.parsed?.response_text`,
  NOT `result.parsed`. (Raw mode also throws when the text is <20 chars — :505.)
- **Optional `a7_preamble` fails A7 open.** `resolveOne` (:248-253) returns `''`
  for an optional missing override; since `reviews_block` is deliberately not
  `untrusted`, a missing/misspelled preamble → no nonce preamble reaches the model,
  silently. Fix: `a7_preamble` is `required: true` with **no default**, PLUS a
  route-side assertion that the preamble is non-empty and contains every review
  nonce before each `executePrompt` call.

Open questions resolved: (1) preamble in **system** via `{{a7_preamble}}` (supported
by `composeMessages` interpolation); (2) do **not** add a second Executor boundary
on `reviews_block` (route already caps per review); (3) questions <50-char fallback
threshold **stays route control flow**.

## Goal (owner ask, S344)

The `peer-review-summarizer.analyze` / `.questions` `wmkf_ai_prompt` rows are
editable in `/admin` but **drive nothing** — the live route
`pages/api/process-peer-reviews.js` runs the hardcoded code generators
(`createPeerReviewAnalysisPrompt` / `createPeerReviewQuestionsPrompt` in
`shared/config/prompts/peer-reviewer.js`). Owner decision: **wire the route to
the Executor** so the admin rows are the execution source and staff prompt-edits
take effect. A7 decision (owner): **preserve per-review nonce wrapping** (do not
accept the coarser single-blob wrap).

## Current state [VERIFIED via file, 2026-07-08]

`process-peer-reviews.js`:
- SSE route (`text/event-stream`); streams *progress* only — the two LLM calls
  are non-streaming `LLMClient.complete()` (so nothing token-streams today).
- Auth: `requireAppAccess(req,res,'peer-review-summarizer')`; rate-limited (5).
- Extracts text from N uploaded files (PDF/DOCX/DOC), filters error/empty.
- **A7 (Part 4):** each of the N valid reviews is wrapped by
  `wrapUntrustedContent({dataClass: REVIEW_TEXT, maxChars: PEER_REVIEW_TEXT_MAX_CHARS})`
  → N per-review nonces; `buildUntrustedContentPreamble(reviewNonces)` prepended
  once at the top of the user message. [VERIFIED via process-peer-reviews.js:214-232]
- Call 1 (analyze): `preamble\n\n${createPeerReviewAnalysisPrompt(wrappedTexts)}`,
  `maxTokens = REFINEMENT_MAX_TOKENS`, `temperature = SUMMARIZATION`,
  `model = getModelForApp('peer-review-summarizer')`. Single user message, no system.
  [VERIFIED via process-peer-reviews.js:232-244]
- Output parsing: split on `**OUTPUT 2 - QUESTIONS:**` (+ fallbacks); heavy
  header-fragment cleanup; returns `{ formatted, structured:{questions}, metadata }`.
- Call 2 (questions, conditional): only when the analyze pass yielded no/short
  (<50 char) questions. `createPeerReviewQuestionsPrompt(wrappedTexts)`,
  `maxTokens = DEFAULT_MAX_TOKENS`, same temp/model. [VERIFIED via :311-320]
- Usage: logged via `LLMClient({ appName:'peer-review-summarizer' })`.
  No separate `logUsage()` call in the route. [VERIFIED via :234-239]

## Assets already in place [VERIFIED via file]

- `shared/config/prompts/peer-reviewer-dynamics.js` — `ANALYZE_*` / `QUESTIONS_*`
  templates with `{{review_count}}`, `{{review_count_suffix}}`, `{{reviews_block}}`
  (caller-built joined string); empty system prompt. [VERIFIED via :45-103]
- `scripts/seed-peer-review-summarizer-prompts.js` — seeds/publishes both rows:
  model `sonnet`, temp `0.3`, analyze `maxTokens 2500`, questions `maxTokens 16384`,
  variables as above (all `override`), `parseMode: raw`, single `response_text`
  output `target.kind: none`. Idempotent update-by-name; verifies after write.
  [VERIFIED via seed script :67-157]
- `lib/services/field-primer-service.js` — precedent for an all-override
  (no-`requestId`) Executor caller returning `parsed` to the route. [VERIFIED via :50-81]

## The A7 gap that MUST be closed [VERIFIED via file]

The seeded rows declare `reviews_block` as a **plain** `override` (no `untrusted`,
no `dataClass`/`maxChars`). `execute-prompt.js` `applyVariableBoundaries` only
wraps + emits a nonce when a variable is `untrusted: true` **and** capped
(:744-775); and `composeMessages` only injects `buildUntrustedContentPreamble`
when `untrustedNonces.length > 0` (:436-438). So wiring to these rows as-is would
send the review text **unwrapped and with no preamble** — an A7 regression.

Because the owner chose **per-review** wrapping (N nonces), we cannot use the
Executor's native single-variable wrap (one nonce). Resolution: the **route owns
A7** (as it does today) and passes already-wrapped content through the Executor
verbatim.

## Target design

### Route (`process-peer-reviews.js`)
1. Keep file extraction, filtering, SSE progress framing, and all output parsing
   **unchanged**.
2. Keep the existing A7 block **unchanged**: per-review `wrapUntrustedContent`
   (N nonces) + `buildUntrustedContentPreamble(reviewNonces)`.
3. Build `reviews_block` exactly as the generator did:
   `` wrappedTexts.map((t,i) => `**Review ${i+1}:**\n${t}\n\n---\n`).join('') ``.
4. **Assert A7 fail-closed** before each call: throw if `preamble` is empty or
   does not contain every `reviewNonce`. Then replace `claude.complete()` call 1
   with `executePrompt({ promptName: 'peer-review-summarizer.analyze',
   overrideVariables: { review_count, review_count_suffix, reviews_block,
   a7_preamble: preamble }, runSource: 'Vercel Interactive', forceOverwrite: true })`.
   Extract the text with `const analysisText = result.parsed?.response_text || ''`
   (raw mode returns `{ response_text }`, NOT a bare string). Then run the
   **existing** marker-split parsing on `analysisText`. Note: raw mode throws on
   <20-char output — the route's existing try/catch fallback covers it.
5. Replace call 2 (questions fallback) the same way against
   `peer-review-summarizer.questions` (no `review_count_suffix`);
   `const rawQuestions = result.parsed?.response_text || ''`.
6. **Usage accounting:** the Executor's internal `LLMClient` passes no `appName`,
   so `api_usage_log` loses this app unless the route logs it. Mirror summarize-v2:
   ```js
   logUsage({ userProfileId, appName: 'peer-review-summarizer',
     model: result.meta?.modelUsed,
     inputTokens: result.usage?.input_tokens || 0,
     outputTokens: result.usage?.output_tokens || 0,
     cacheCreationTokens: result.usage?.cache_creation_input_tokens || 0,
     cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
     latencyMs: 0, status: 'success' });
   ```
   Confirm the exact `logUsage` field names against `lib/utils/usage-logger.js`
   during build. (Executor also writes a `wmkf_ai_run` row per call — net audit gain.)

### Prompt rows (Dataverse writes via the seed script)
Add A7 preamble handling — the ONE change to the seeded assets:
- `peer-reviewer-dynamics.js`: set `ANALYZE_SYSTEM_PROMPT` / `QUESTIONS_SYSTEM_PROMPT`
  to `'{{a7_preamble}}'` (was `''`). `composeMessages` interpolates `{{var}}` in
  the system block (:429), so the route-built preamble lands in `system` — the
  Executor's normal A7 placement.
- Seed script: add an `a7_preamble` variable (`override`, **`required:true`, NO
  default**, `placement:user`, `cacheable:false`) to both rows — fail-closed so a
  missing preamble throws rather than silently dropping A7. Keep everything else identical.
- Run `node scripts/seed-peer-review-summarizer-prompts.js --dry-run` then
  `--execute`; the script re-publishes the current rows (update-by-name, verifies).
  [RECHECKED after scripts/seed-peer-review-summarizer-prompts.js change: the
  a7_preamble variable (required, no default) was added to both rows in the seed
  script and re-published via --execute; verified both rows current with 4/3
  variables + parseMode:raw (S344).]

## Explicitly NOT byte-identical (framing change — accept)

The Executor sends `system:[{text, cache_control}]` + `user:[body]`; today the
route sends a single `user` message with the preamble at the very top. After
migration the **preamble sits in `system`** and the instructions/reviews in
`user`. The instruction text (incl. `OUTPUT 1/OUTPUT 2` markers the parser keys
on) is preserved verbatim, so parsing is unaffected. Parity is verified at the
**content** level (same instructions + same wrapped reviews + same preamble
reach the model), not byte level. This is inherent to the Executor contract and
is the accepted cost of moving prompt text into the editable row.

## Cutover & rollback
- **Do not delete** the code generators (`createPeerReviewAnalysisPrompt` /
  `createPeerReviewQuestionsPrompt`) — keep them importable for instant rollback
  (revert the route diff). They stop being the live path but remain the fallback.
- Cutover is the single route diff + the row re-publish. Rollback = `git revert`
  the route commit (rows can stay published; they just go dormant again).

## Verification plan
1. **Content-parity harness** (scratchpad, no network): for a fixture of 2–3
   fake reviews, assert the composed prompt content from the row templates +
   route-built variables equals the current generator output (modulo the
   system/user split). Confirms no instruction drift.
2. **Model/param parity:** confirm `baseConfig['peer-review-summarizer']` resolves
   to the same Sonnet the row's `model:'sonnet'` tier maps to; maxTokens 2500 /
   16384 and temp 0.3 match the current constants.
3. **E2E:** run the app against the fixture; confirm SUMMARY + QUESTIONS render,
   the <50-char questions fallback still triggers, and a `wmkf_ai_run` row is
   written per call.
4. **Gates:** `check:prompt-injection-tagging` (+self-test),
   `check:model-override-warming`, `check:api-routes`, `check:types`,
   `check:agent-wiki`; full `npm test`; `npm run build`.

## Risks
- **A7 regression** if the preamble/wrapping wiring is wrong — the single biggest
  risk; content-parity harness + a manual injection-string spot check mitigate.
- **Row drift**: the published row body must equal the template; the seed script
  re-publishes from the template source of truth, closing this.
- **Usage double-count or loss**: get the `logUsage` wiring right (route logs
  once from `r.usage`; Executor passes no `appName`).
- **Prompt-injection gate**: `process-peer-reviews.js` is a registered surface;
  confirm the gate still recognizes the (now Executor-mediated) untrusted handling.

## Open questions — RESOLVED (Codex review, S344)
1. Preamble placement → **`system`** via `{{a7_preamble}}`; `composeMessages`
   interpolates `{{var}}` in the system block.
2. Second Executor boundary on `reviews_block` → **no**; the route already caps
   per review, a second bound would double-truncate.
3. Questions <50-char fallback threshold → **stays route control flow** (it's
   control flow, not prompt text).
