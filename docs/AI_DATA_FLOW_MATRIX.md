# AI Data Flow Matrix

Last updated: 2026-06-11

## Purpose

This document maps where the application sends data to external AI providers. It assumes Foundation staff are authorized to use these applications in accordance with Foundation data-protection and data-sharing policies. The purpose here is not to second-guess staff intent, but to identify code-level threats: places where bugs, missing guardrails, weak defaults, logging, retention, provider drift, or overly broad serialization could send or persist more data than the staff user intended.

It complements `docs/API_ROUTE_SECURITY_MATRIX.md`: that document answers "who can call this route," while this one answers "what the code sends or stores once an authorized caller does."

## Review Legend

| Risk | Meaning |
|---|---|
| Low | Narrow, predictable payloads with little chance of accidental over-sharing or sensitive persistence. |
| Medium | Payloads include staff-provided proposal/report/reviewer/CRM context, but the code path is bounded and understandable. |
| High | Code path can send broad raw documents, high-fidelity CRM records, multi-provider payloads, or raw outputs to durable storage; risk is about implementation blast radius, not staff intent. |

## Cross-Cutting Observations

- `LLMClient` is the preferred Anthropic wrapper. It uses `safeFetch`, timeout/retry handling, redacted errors, and token/cost usage logging.
- `api_usage_log` stores usage metadata: user, app, model, token counts, cost estimate, latency, status, and error message. It does not intentionally store prompts or raw proposal text.
- Some Dynamics AI-run paths intentionally store raw model output in Dataverse, especially `executePrompt()` and grant-reporting helpers. Output can contain proposal/report-derived content and should be treated as sensitive.
- Several older service paths still call Anthropic with raw `fetch` instead of `LLMClient` / `safeFetch`.
- Many proposal workflows send up to 80,000-100,000 characters of extracted text. That may be appropriate for staff workflows, but the code should make the size and source of transmitted text explicit, bounded, and testable.
- The Virtual Review Panel may send the same proposal to multiple providers: Anthropic, OpenAI, Google, and Perplexity depending on configuration. The code threat is provider-boundary drift: a config/UI change could broaden provider exposure without being obvious to operators.

## Current Findings And Disposition

### P1 - Large document payloads lack a shared, explicit send boundary

Several routes send large extracted proposal/report payloads to external models. This includes reviewer finding, proposal summaries, Phase I/II summaries, grant reporting goals assessment, virtual review panel, and Q&A. This is an authorized staff workflow, but before this hardening pass the implementation expressed limits inconsistently across routes and prompt helpers.

Code threat: future changes can accidentally raise limits, send the wrong file text, duplicate payloads across multiple calls, or include fields the route did not actually need.

Recommended next step: keep this convention as the standard for new high-volume routes and move the same source/data-class/retention thinking into the Prompt Executor.

**Status (2026-05-04): addressed for the identified route/service call sites.** `lib/utils/ai-payload-boundary.js` now defines a reusable bounded-text helper. The pattern is in place across the high-volume route/service paths reviewed in this pass:

- `ClaudeReviewerService.analyzeProposal` (`reviewer-finder.analyze.proposalText`, 100k cap)
- `/api/process` (`batch-phase-ii.summary.proposalText` + `batch-phase-ii.extraction.proposalText`, both 100k)
- `/api/process-legacy` (`legacy.summary.proposalText` 15k + `legacy.extraction.proposalText` 10k — asymmetric caps preserved exactly)
- `/api/process-phase-i` (`batch-phase-i.summary.proposalText` + `batch-phase-i.extraction.proposalText`, both 100k)
- `/api/process-phase-i-writeup` (`phase-i-writeup.writeup.proposalText` + `phase-i-writeup.extraction.proposalText`, both 100k)
- `/api/qa` (`qa.system.proposalText`, 80k cap)
- `/api/grant-reporting/extract` — three call sites, each bounded with its own source:
  - `extractReport()` (exported helper): `grant-reporting.extract.reportText`, 100k cap
  - `compareProposalToReport()` (exported helper, future PA seam): `grant-reporting.goals.proposalText` 100k + `grant-reporting.goals.reportText` 100k
  - `handleRegenerate` (single-field regeneration): `grant-reporting.regenerate.reportText`, 100k cap
  - The grant-reporting prompt builders previously had no internal truncation — proposal and report text went straight to Claude. The boundary helper is the first explicit cap on this path.
- `/api/analyze-funding-gap` (`funding-gap.extraction.proposalText`, 100k cap) before PI/institution/keyword extraction
- `/api/virtual-review-panel` (`virtual-review-panel.run.proposalText`, 100k cap) — bounded once at the route boundary; the bounded text propagates to every prompt builder that embeds raw proposal text (Stage 0a claim extraction, claim verification, structured review, devil's advocate) across every configured provider. Two stages do **not** receive raw proposal text by design — Stage 0c (search collation) operates on extracted `claimData` plus raw search results, and synthesis operates on parsed reviewer outputs. Tests pin both invariants (six proposal-bearing calls when intelligence + DA are enabled; non-proposal calls verified to not contain the over-cap tail) so a future refactor that pipes raw proposal into either path would fail loudly.
- `/api/phase-i-dynamics/summarize` (`phase-i-dynamics.summarize.proposalText`, 100k cap) — single-request Phase I path with Dynamics writeback. Previously relied on an internal substring inside the prompt builder; now bounded at the route before `createPhaseISummarizationPrompt` is called.
- `/api/phase-i-dynamics/summarize-v2` — bounded **inside the Prompt Executor** via the `phase-i.summary` prompt row's variable declaration (`dataClass: 'proposal_text'`, `maxChars: 100000` on `proposal_text`). Source string `executor.phase-i.summary.proposal_text`. The route hands raw `fileLoad.text` to `executePrompt`; the Executor enforces the cap uniformly — closes the symmetry between user-driven HTTP routes and unattended PowerAutomate triggers (both go through the same Executor and get the same boundary). See `lib/services/execute-prompt.js` and `docs/EXECUTOR_CONTRACT.md` § "Data classification + payload boundary".

For the batch summarization routes, **both LLM calls per file (summary/writeup and structured extraction) are bounded in code via `buildBoundedTextPayload`**. For Q&A, grant reporting, and funding-gap analysis, each raw proposal/report-text model entry point now carries an explicit `source` string and route-appropriate `maxChars`, and bounded text arrives at the cap with a truncation marker before any prompt builder is called. Tests pin the bounded `source` strings so future drift is caught.

For operator visibility, the batch summarization routes emit one non-content `payload_boundary` SSE event per file before the summary/writeup call, and `/api/qa` emits one before the streamed Q&A call. The event includes `{source, dataClass, maxChars, originalChars, transmittedChars, truncated, truncationMarker}`. For the batch routes, we deliberately do not emit a second event for the extraction call — the in-code boundary is the load-bearing control; doubling SSE events would just add noise on batch runs of 50+ PDFs without strengthening the protection. Operators who need extraction-call boundaries audited can read the source strings or the test assertions, which cover both call sites.

Hidden truncation in the prompt builders (`text.substring(0, textLimit)`) has been removed across the high-volume builders (`proposal-summarizer.js`, `proposal-summarizer-legacy.js`, `phase-i-summaries.js`, `phase-i-writeup.js`, `funding-gap-analyzer.js`, `reviewer-finder.js`). The route boundary is now the single source of truth for the cap; each cleaned function carries a header comment stating that callers MUST bound `text` via the helper before calling. This eliminates the dead "fallback cap" that could mask a future regression where a route forgets to bound.

The identified high-volume route/service payload-boundary targets are now covered by the shared helper. Future high-volume AI call sites should follow the same pattern: bound at the route or service boundary with a named cap and an explicit `source` string, pin the bounded `source` in tests, and emit one non-content `payload_boundary` event when a streaming surface is available. The Prompt Executor remains the next place to formalize this as declarative prompt metadata (`dataClass`, `maxChars`, and raw-output retention policy) rather than ad hoc route code.

### P1 - Dynamics Explorer can send verbose CRM records into an agentic loop

`/api/dynamics-explorer/chat` sends role-gated CRM query/search results to Claude, and export processing can batch CRM records through Claude. Restrictions shape the accessible table/field set, but the serialization layer can still pass high-fidelity records wholesale.

Code threat: a tool, query expansion, or future schema change could include more CRM fields than the user intended to ask about.

**Status (2026-05-04): addressed at the model-context boundary.** `lib/utils/dynamics-explorer-serializer.js` now runs before tool results are appended back into the agentic Claude loop. It recursively strips OData metadata, redacts high-risk field names (`description`, `notetext`, `documentbody`, token/key/secret/password-like fields, raw-output/promptoverride fields), caps long scalar values, and adds content-free `_aiContextBoundary` metadata when redaction/truncation occurs. The same record serializer is used for export AI-processing sample/batch inputs. This is not a Dataverse permission control; it is a model-context minimization layer after app access, Dynamics restrictions, and query execution have already allowed the data.

Watch items that remain:
- If answer quality regresses because Claude needs a redacted narrative field, add a deliberate per-tool/per-table allow path rather than removing the serializer globally.
- If token costs keep rising, add per-table default `select` behavior for `query_records` / `get_entity` / `get_related` when Claude omits one.
- Continue monitoring for AI-summary loopback, especially if `wmkf_ai_summary` or similar fields become common in generic query results.

### P1 - Virtual Review Panel provider boundaries are configuration-sensitive

`/api/virtual-review-panel` can send full proposal text to multiple providers through `MultiLLMService`, including Claude, OpenAI, Gemini, and Perplexity. This materially expands vendor exposure compared with Claude-only routes.

Code threat: a default provider list or environment variable change can broaden where payloads go without a code reviewer seeing the impact.

Recommended next step: keep provider policy changes explicit in config and tests as VRP stages evolve.

**Status (2026-05-04): addressed.** `VRP_ALLOWED_PROVIDERS` now gates the Virtual Review Panel provider set. Production fails closed when the variable is unset, dev/test retain the previous "any configured provider" behavior, and the API rejects runs unless `claude` is allowed because synthesis and intelligence-pass extraction/collation currently call Claude unconditionally. The resolved provider set is stored in `panel_reviews.config`.

### P2 - Legacy/direct Anthropic fetch paths bypass the canonical wrapper

`health-checker` and the old module demo still use direct `fetch` calls. `ClaudeReviewerService` and `ContactEnrichmentService.claudeWebSearch` previously did as well, but have since been migrated to `LLMClient` (contact enrichment as of the A7 follow-up — `lib/services/contact-enrichment-service.js:1082` routes through `LLMClient`, preserving the `web_search` tool via `complete()`'s `tools` passthrough). Some remaining paths are low sensitivity, but the direct-fetch pattern bypasses `LLMClient`'s timeout, safeFetch, retry, and redaction behavior.

Recommended next step: migrate remaining production Claude callers to `LLMClient` or `safeFetch` as appropriate. Prioritize paths where the wrapper adds meaningful timeout, redaction, retry, or allowlist behavior.

**Status (2026-06-11): mostly addressed.** `ClaudeReviewerService` uses `LLMClient` for reviewer-finder analysis and discovered-candidate reasoning (content-bearing debug logs gated behind `DEBUG_REVIEWER_FINDER`), and `ContactEnrichmentService.claudeWebSearch` now routes through `LLMClient` as well (A7 follow-up, `contact-enrichment-service.js:1082`), wrapping the candidate identity string as untrusted external content (`dataClass: EXTERNAL_API_TEXT`, 2k cap) before the call. The remaining direct-fetch paths are `health-checker` (low — static "Hello", acceptable) and the `modules/expertise_matching` demo (confirm production-reachability or archive). The residual data risk for contact enrichment is unchanged: candidate name + institution still leave the app via Claude web search.

### P2 - AI-run logs persist generated outputs with large limits

`executePrompt()` and `DynamicsService.logAiRun()` can store model output in `wmkf_ai_rawoutput`. These are useful audit records, but may contain sensitive derived proposal/report content.

Code threat: a prompt output can unexpectedly include copied input text or sensitive fields and then persist far longer or wider than the original route response.

**Status (2026-05-04): partially addressed.** Executor output schemas now support `rawOutputRetention: "full" | "hash" | "none"`; `phase-i.summary` is the first adopter and stores hash metadata in `wmkf_ai_rawoutput` because the generated summary is already persisted to `akoya_request.wmkf_ai_summary`. `DynamicsService.logAiRun()` also accepts `rawOutputRetention` for non-Executor callers, but existing grant-reporting/manual callers still need per-call adoption.

Recommended next step: confirm Dataverse permissions and retention for `wmkf_ai_run`, then adopt `rawOutputRetention` on the remaining high-volume `logAiRun()` call sites where full raw output is not needed.

### P3 - Error/log analysis flow is relatively well minimized

`/api/cron/log-analysis` redacts log entries before sending them to Claude and redacts again before storing alert output. This is a good pattern to reuse for other flows.

Recommended next step: use this as the model for "redact before external AI, redact again before persistence."

## Data Flow Matrix

| Area / Route | Provider(s) | Data Sent | Volume / Limits | Persistence After Call | Current Controls | Risk | Notes / Hardening Ideas |
|---|---|---|---|---|---|---|---|
| `/api/reviewer-finder/analyze` via `ClaudeReviewerService.analyzeProposal` | Anthropic Claude | Proposal text from upload/blob, additional notes, excluded names, reviewer count/settings | Body limit 10 MB; proposal text capped at 100,000 chars by `ai-payload-boundary` before prompt construction | Usage metadata; generated proposal info/reviewer suggestions returned to client and later saved by user flows | App access, rate limit, `safeFetch` for blob input, `LLMClient` for Anthropic transport, explicit AI payload boundary metadata | High | Direct Anthropic `fetch` has been removed from `ClaudeReviewerService`; proposal text now has an explicit cap/source/data-class boundary. |
| `/api/reviewer-finder/generate-emails` | Anthropic Claude | Candidate/reviewer details, proposal info, base email body | Per-email prompt; `maxTokens: 512` | Generated email returned/saved; usage metadata | App access; uses `LLMClient` | Medium | Sends reviewer + proposal context. Reasonable, but keep prompt fields tight. |
| `/api/reviewer-finder/enrich-contacts` / `ContactEnrichmentService.claudeWebSearch` | Anthropic Claude with web search | Candidate name and institution | Minimal prompt; `max_tokens: 256`; one web search | Enriched contact info returned/saved | App access, rate limit, `LLMClient` transport (timeout/safeFetch/retry/redaction), untrusted-content wrapping of candidate identity | Medium | Now uses `LLMClient` (`web_search` tool preserved via `complete()` passthrough). Residual risk: candidate name/institution still sent to Claude/web search. |
| `/api/process`, `/api/process-legacy` | Anthropic Claude | Extracted Phase II proposal text; filename; generated summary reused for structured extraction | Proposal text bounded by `ai-payload-boundary` before both summary and structured-extraction prompts; legacy preserves 15k/10k asymmetric caps | Summary and structured data returned; extracted text included in response object | App access, rate limit, `LLMClient`, `safeFetch` for blob input, explicit AI payload boundary metadata | High | Main remaining code risk is returning full extracted text in API response and duplicating bounded text across summary + extraction calls. Confirm UI need or remove from response. |
| `/api/process-phase-i` | Anthropic Claude | Extracted Phase I proposal text | Proposal text bounded at 100,000 chars before both summary and structured-extraction prompts | Summary/structured data returned | App access, `LLMClient`, explicit AI payload boundary metadata | High | Same response-minimization issue as `/api/process`. |
| `/api/process-phase-i-writeup` | Anthropic Claude | Extracted Phase I writeup/proposal text | Proposal text bounded at 100,000 chars before both writeup and structured-extraction prompts | Writeup/structured data returned | App access, `LLMClient`, explicit AI payload boundary metadata | High | Same response-minimization issue as `/api/process`. |
| `/api/process-peer-reviews` | Anthropic Claude | Peer review text and possibly proposal/review context | Review-analysis prompt plus question extraction | Analysis/questions returned | App access, `LLMClient` | Medium | Review text can contain sensitive reviewer opinions. Confirm retention and output handling. |
| `/api/qa` | Anthropic Claude with web search tool | Proposal text bounded at 80k chars in system prompt, summary text, filename, recent conversation, user question | System prompt caches proposal context; last 6 messages retained | Usage metadata; streamed answer/sources returned | App access, rate limit, `LLMClient`, prompt cache, conversation trimming, explicit AI payload boundary metadata | High | Good conversation trimming. Code risk is combining internal proposal context with web search tool in the same call. Consider a mode flag for tool-enabled vs. internal-only Q&A. |
| `/api/refine` | Anthropic Claude | Existing generated summary and user feedback | `maxTokens: 3000` | Refined summary returned; usage metadata | App access, `LLMClient` | Medium | Does not send raw proposal unless summary contains it. Lower risk than original summarization. |
| `/api/analyze-funding-gap` | Anthropic Claude | Proposal text for PI/institution/keyword extraction; extracted metadata and federal API summaries for final analysis | Proposal text capped at 100,000 chars by `ai-payload-boundary` before extraction prompt construction | Funding extraction/analysis returned; usage metadata plus non-content boundary metadata in result metadata | App access, `LLMClient`, explicit AI payload boundary metadata | High | Final analysis prompt does not include raw proposal text. Remaining code risk is whether future extraction fields broaden what leaves the app. |
| `/api/analyze-literature` | Anthropic Claude | Literature search results, user topic/proposal context, synthesis prompts | Multiple calls, 4k-6k max output | Analysis returned; usage metadata | App access, `LLMClient` | Medium | Depends on user-supplied context. Search results mostly public; proposal context may raise risk. |
| `/api/evaluate-multi-perspective` | Anthropic Claude | User concept/proposal text and perspective prompts; optional image/vision payloads | Multiple model calls; 1.5k-3.5k max output | Evaluation returned; manual usage logging | App access, `LLMClient` | Medium | Clarify whether users paste non-public proposal material. |
| `/api/phase-i-dynamics/summarize` | Anthropic Claude | Proposal file text loaded from SharePoint/upload plus request GUID context | Proposal text bounded at 100,000 chars before prompt construction | Writes summary to `akoya_request.wmkf_ai_summary`; logs AI run/usage | App access, rate limit, overwrite guard, optimistic concurrency, explicit AI payload boundary | High | Code risk is wrong-record writeback or accidental overwrite; concurrency guard is good. Route-level boundary is pinned by a handler test. |
| `/api/phase-i-dynamics/summarize-v2` via `executePrompt()` | Anthropic Claude | Raw `fileLoad.text` passed via `overrideVariables.proposal_text`; Executor enforces the cap | Executor caps `proposal_text` at 100,000 chars via prompt-row metadata (`dataClass: 'proposal_text'`, `maxChars: 100000`); source string `executor.phase-i.summary.proposal_text` | Writes summary to `akoya_request.wmkf_ai_summary`; stores only hash metadata in `wmkf_ai_rawoutput` via `rawOutputRetention: "hash"` | App access, executor guard, overwrite controls, Dataverse audit, declarative payload boundary and raw-output retention | High | Route-level substring removed in favor of Executor-enforced cap. Boundary metadata surfaces on `result.meta.aiPayloadBoundaries` and in the `wmkf_ai_run` notes. |
| `lib/services/execute-prompt.js` | Anthropic Claude | Prompt variables from Dynamics, SharePoint text extraction, caller overrides | Per-variable payload boundary when a declaration includes both `dataClass` and `maxChars` (opt-in, backwards compatible); applied uniformly across `kind: override / dynamics / sharepoint` | Writes outputs to Dynamics; creates AI-run audit row with configurable raw-output retention (`full`, `hash`, `none`) and boundary summary | `LLMClient` transport (`safeFetch`/timeout/retry/redaction; 2026-06-11), centralized prompt executor, output guards, Dataverse audit, declarative payload boundary and raw-output retention | High | Mechanism shipped 2026-05-04; first adopter is `phase-i.summary`. `callClaude()` migrated from raw `fetch` to `LLMClient.complete()` 2026-06-11 (cache_control system array preserved; response re-shaped to raw Anthropic shape). Future prompts adopt metadata fields when touched. |
| `/api/grant-reporting/extract` | Anthropic Claude | Grant report text, proposal text for goals assessment, authoritative Dynamics header fields, current narratives | Report/proposal text bounded at 100,000 chars at each model entry point | Returns structured extraction/goals; logs usage and AI-run outputs | App access, rate limit, `LLMClient`, file loader, explicit AI payload boundary metadata | High | Code risk is multi-document prompt growth and raw-output persistence. Add output retention policy for AI-run records. |
| `/api/dynamics-explorer/chat` | Anthropic Claude with tool loop | User question, recent conversation, tool definitions, serialized CRM query/search/list document results, possible serialized export AI-processing batches | Streaming `maxTokens: 2048`; batch processing `maxTokens: 4096`; result char caps per tool plus recursive field redaction/long-string caps | Dynamics query log stores query params/counts; usage metadata | App access, Dynamics roles/restrictions, result char caps, conversation trimming, AI-context serializer | High | Model-context minimization shipped 2026-05-04. Serializer is pinned by unit tests and a route-level tool-loop test. |
| `/api/virtual-review-panel` and `PanelReviewService` | Anthropic, OpenAI, Gemini, Perplexity | Bounded proposal text for proposal-bearing stages; extracted claims/search results; parsed reviewer outputs for synthesis | Proposal text bounded at 100,000 chars once at the route boundary; multi-provider fan-out; panel DB stores text hash not raw proposal | Panel results/items/costs stored; provider outputs persisted | App access, rate limit, provider availability checks, `VRP_ALLOWED_PROVIDERS` allowlist, provider set persisted per run, explicit AI payload boundary metadata | High | Provider-set drift mitigated by production fail-closed allowlist. Remaining risk is that Claude is currently mandatory for synthesis and intelligence extraction/collation; future provider changes should make those stages policy-aware. |
| `MultiLLMService` | Anthropic, OpenAI, Gemini, Perplexity | Arbitrary prompt/system prompt from caller | Defaults `maxTokens: 16384`; timeout via `Promise.race` | Usage metadata if logging context supplied | `safeFetch` for provider calls | High | Shared transport for full proposal review. Consider request aborts instead of Promise.race and provider-level data classification. |
| `/api/integrity-screener/screen` / `IntegrityService.analyzeWithHaiku` | Anthropic Claude | Search result titles, URLs, snippets for applicant/research integrity analysis | Top search results; `maxTokens: 1000` | Screening results/history through service | App access; `LLMClient` | Medium | Mostly public search snippets, but query subject is person/institution-sensitive. |
| `/api/cron/log-analysis` | Anthropic Claude | Redacted Vercel error summaries: timestamp, path, message | Up to 50 entries; `maxTokens: 1024` | Alert message/metadata stored; output redacted again | Cron secret, input redaction, output redaction, `LLMClient` | Low | Good reference pattern. |
| `lib/utils/health-checker.js` | Anthropic Claude | Static "Hello" health-check prompt | `max_tokens: 10` | Health status only | Cron/admin health surface | Low | Direct `fetch` acceptable risk, but can migrate to `safeFetch` for consistency. |
| `lib/services/claude-reviewer-service.js` | Anthropic Claude | Reviewer-finder prompts containing bounded proposal text, reviewer criteria, notes/exclusions | Proposal text capped at 100,000 chars by `ai-payload-boundary`; `LLMClient` retry/fallback behavior | Usage metadata through `LLMClient` | Called behind reviewer-finder app access; `LLMClient` transport with `safeFetch`, timeout, retry, redacted errors; explicit AI payload boundary metadata | High | Direct `fetch` migration and proposal-text boundary are complete for the reviewer-finder analysis path. |
| `lib/services/contact-enrichment-service.js` | Anthropic Claude web search | Candidate name and institution | Minimal prompt, one web search | Contact enrichment result | `LLMClient` transport (timeout/safeFetch/retry/redaction); untrusted-content wrapping of candidate identity; server-side credentials | Medium | Migrated to `LLMClient` (`:1082`; `web_search` tool preserved via `complete()` passthrough). Residual risk: candidate name/institution still sent to Claude/web search. |
| `lib/services/multi-llm-service.js` | Anthropic/OpenAI/Gemini/Perplexity | Arbitrary caller prompt, often proposal review prompts | Large max-token default | Usage metadata | `safeFetch`; provider env keys | High | Exposure depends entirely on caller. Needs caller-level matrix references. |
| `modules/expertise_matching/src/reviewer_matcher.jsx` | Anthropic Claude | Browser-side prompt for local/module reviewer matching | Demo/module code path, not main API | Unknown | Direct browser/component fetch | Medium | Confirm whether this module is production-reachable. If not, archive or document as non-production. |

## Recommended Hardening Sequence

1. **Prompt Executor data classification — payload boundary and first retention policy shipped**
   - ✅ Per-variable `dataClass` + `maxChars` declarations are honored by the Executor (added 2026-05-04). First adopter: `phase-i.summary` row, used by `/api/phase-i-dynamics/summarize-v2`.
   - ✅ Route-level substring removed from `summarize-v2`; `executor.phase-i.summary.proposal_text` is the load-bearing cap.
   - ✅ `rawOutputRetention` supports `full`, `hash`, and `none`; `phase-i.summary` stores hash metadata rather than duplicating the generated summary in `wmkf_ai_rawoutput`.
   - 🟡 Apply the same metadata to other Dynamics-backed prompts as they're touched (incremental adoption — opt-in per variable).
   - 🟡 Remaining `DynamicsService.logAiRun()` callers still need per-call retention decisions.

2. **AI-run retention and raw-output review**
   - Confirm who can read `wmkf_ai_run`.
   - Decide which remaining high-volume run logs should store full raw output, structured output only, hash metadata, or no output content.
   - Add cleanup/retention policy if needed.

3. **Dynamics Explorer model-context serializer**
   - ✅ Tool results are serialized before re-entering the Claude loop.
   - ✅ Export AI-processing sample/batch records use the same serializer.
   - 🟡 Monitor for answer-quality regressions that require deliberate field-specific allow paths.
   - 🟡 If token costs keep rising, add per-table default `select` behavior plus system-prompt guidance.

4. **Remaining direct Anthropic fetch paths**
   - ✅ `ContactEnrichmentService.claudeWebSearch` migrated to `LLMClient` (A7 follow-up).
   - 🟡 Review `health-checker` (low — static health ping) and the `modules/expertise_matching` demo (confirm production-reachability or archive).
   - Migrate remaining production paths to `LLMClient` or `safeFetch` where the wrapper adds meaningful protection.

5. **Payload-boundary governance**
   - Keep `lib/utils/ai-payload-boundary.js` as the route/service convention for non-Executor paths.
   - Add new high-volume route tests that assert the `AI payload boundary: <source>` marker reaches proposal-bearing model calls.
   - Consider a lightweight lint/check for new prompt builders that embed raw `text` without a documented caller boundary.

## Open Questions

- For Executor-backed prompts, should payload limits live only in prompt definitions, or should route-level overrides remain allowed?
- Should web search/tool-enabled calls be explicitly separated from internal-only model calls in code?
- What provider set should Virtual Review Panel use in production via `VRP_ALLOWED_PROVIDERS`?
- Who can read `wmkf_ai_run` raw outputs in Dataverse, and how long should those outputs live?
- Are summary-page extraction and Dynamics-stored abstracts sufficient for reviewer-finder analysis in some cycles?
