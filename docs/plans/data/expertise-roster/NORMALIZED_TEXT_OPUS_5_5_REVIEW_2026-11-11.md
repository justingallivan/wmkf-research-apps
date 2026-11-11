# Roster normalized model text — Opus 5.5 review

## Current evidence boundary

[VERIFIED via the exact transcript below] Opus returned READY for passing the
existing normalized `LLMClient.text` through both matching wrappers, with refusal
checks retained before parsing/persistence and bounded diagnostics. The reviewer
read source only and compared against the older main-checkout copy, not git HEAD.

[VERIFIED via the coordinating session's results] Commit `102f19332` passed 40
focused tests, the build (`outputs/roster-normalized-text-build.log`) and the
model-warming and prompt-injection gates/self-tests. These checks do not establish
a successful live match. The first authorized live single submission received a
provider response but failed parsing before any result insert; its two original
synthetic history rows remained unchanged. The remaining approved batch submission subsequently passed with persistence and
History rendering; final cleanup passed. The single path was not live rerun. See
[final results](LIVE_ATTACHMENT_MATCHING_RESULTS_2026-11-11.md); no full matching-pass claim.

Source transcript: `outputs/roster-normalized-text-opus.md`, preserved verbatim below.

## Archived transcript

**READY.** I found nothing that blocks this fix, and a few gaps that aren't blockers. I read the code only. I didn't run the tests, so the 40-pass count is still your report, not something I checked. I compared against the older copy of these files in the main checkout (`/Users/gallivan/Code/WMKF_Apps`), not against git HEAD.

**What you asked me to check:**

1. **The refusal check still comes before parsing and saving.** Both `callClaude` wrappers pass the response through `requireAcceptedLlmResponse(...)` before returning (`match.js:240`, `batch-match-service.js:315`). It throws on `refused === true || stopReason === 'refusal'` (`lib/utils/llm-response.js:9-14`), so neither parsing nor the insert is reached. Tests cover a refusal that carries valid JSON (`expertise-finder-match-route.test.js:120-131`), and both empty and JSON-carrying refusals on the batch route (`expertise-finder-batch-match-route.test.js:151-167`). In each, `sql` is called once (the roster read) and no success usage is logged.
2. **Empty text can't be saved.** With `''`, the regex finds nothing, `''.trim()` gives `''`, and `JSON.parse('')` throws. The catch returns a 500 in the route (`match.js:137-147`) and throws a `ServiceHttpError` 500 in the service (`batch-match-service.js:195-209`). Both happen before validation and the INSERT. Tests: `expertise-finder-match-route.test.js:95-118` and `batch-match-service.test.js:126-139` (`sql` once, no success log).
3. **A thinking block first, with the text split across blocks, works.** The client joins every text block (`llm-client.js:445`), and the wrappers pass `r.text` through (`match.js:247`, `batch-match-service.js:322`). The success fixtures put a `thinking` block at `content[0]`, followed by two text halves:
   - single match route: `expertise-finder-match-route.test.js:65-71`
   - batch route: `expertise-finder-batch-match-route.test.js:90-99`
   - PG test: `roster-matching-persistence.pg.test.js:63-66`

   Old code reading `content[0].text` would fail on these fixtures.
4. **The new diagnostics don't contain response text.** Both catch blocks log only `stopReason`, `blocks`, `thinkingTokens` and `usage` (`match.js:138-143`, `batch-match-service.js:196-201`). `blocks` comes from `summarizeContentBlocks`, which records only type and length (`llm-client.js:477-483`). The match-route test checks the exact logged object and that `'Internal reasoning'` doesn't appear in any log call (`:108-112`).
5. **No other changes.** Model, `maxTokens` and `temperature: 0.2` match the old `callClaude` exactly (old `match.js:223-229`), and the match-route test asserts them (`:84-87`). The fix reads fields the client already returns (`text`, `stopReason`, `blocks`, `thinkingTokens`) and adds no new normalizer.

**Gaps that don't block:**

- **The joining itself isn't tested through these four files.** Their fixtures hand in `text` already joined, because the LLM client is mocked. They prove the code no longer reads `content[0]`. The joining is one line of real client code (`llm-client.js:445`), but I didn't find a client test with several text blocks after a thinking block.
- **The batch empty-text test doesn't watch the error log** (`batch-match-service.test.js:126-139`). Only the match-route test checks that diagnostics carry no text. The batch source logs the same four fields, so this is a missing assertion, not a leak.
- **Existing behaviour outside this fix:**
  - On a parse failure, the model's text is still sent back to the caller as `rawResponse` (`match.js:146`, `batch-match-service.js:207`). It already did that before (old `content[0].text`). With empty text it is now `''`.
  - A refusal in the single-match route ends as a generic 500, not a 422.
  - A parse failure doesn't log an error usage row.
