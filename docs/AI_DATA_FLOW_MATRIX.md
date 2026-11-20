---
title: AI Data Flow Matrix
domain: prompt-executor
kind: audit
status: active
summary: "It complements docs/API_ROUTE_SECURITY_MATRIX.md: that document answers \"who can call this route,\" while this one answers \"what the code sends or..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - lib/utils/ai-payload-boundary.js
  - lib/services/execute-prompt.js
  - docs/EXECUTOR_CONTRACT.md
---

# AI Data Flow Matrix

Last updated: 2026-11-19 (source retirement boundary; deployment not asserted)

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
- `api_usage_log` stores usage metadata: user, app, model, token counts, cost
  estimate, latency, status/error metadata, and the provider stop reason
  (Production migration 032 applied 2026-08-21). It does not intentionally
  store prompts or raw proposal text.
- Some Dynamics AI-run paths intentionally store raw model output in Dataverse, especially `executePrompt()` and grant-reporting helpers. Output can contain proposal/report-derived content and should be treated as sensitive.
- Several older service paths still call Anthropic with raw `fetch` instead of `LLMClient` / `safeFetch`.
- Many proposal workflows send up to 80,000-100,000 characters of extracted text. That may be appropriate for staff workflows, but the code should make the size and source of transmitted text explicit, bounded, and testable.
- (Historical — legacy Virtual Review Panel retired 2026-10-04, route archived.) The Virtual Review Panel may send the same proposal to multiple providers: Anthropic, OpenAI, Google, and Perplexity depending on configuration. The code threat is provider-boundary drift: a config/UI change could broaden provider exposure without being obvious to operators.

## Current Findings And Disposition

### Payload boundaries for active and preserved implementations

`lib/utils/ai-payload-boundary.js` remains the shared bounded-text contract.
Active reviewer analysis bounds proposal text before prompt construction; the
Executor supports per-variable `dataClass`/`maxChars` metadata and raw-output
retention. Preserve those controls and pin boundary metadata in focused tests.

The November 19 app-suite retirement disables the standalone Phase I/II upload,
Phase I Dynamics, peer-review upload, funding-analysis, literature-analysis,
multi-perspective, and Grant Reporting entry points in source. Their old API
implementations are preserved under `_archived/pages/api/`, while the routable
paths return authenticated HTTP 410 without AI calls or application writes.
Their earlier A7 caps/SSE events are historical implementation contracts for
future reuse, not current endpoint behavior. The retained Grant Reporting and
Phase I Dynamics service functions still contain their original write/audit
behavior, but the retirement stubs do not import or execute them. See
[the retirement manifest](plans/APP_SUITE_RETIREMENT_2026-11-19.md).

The 2026-05-04 hardening covered both summary/writeup and structured extraction,
the Q&A proposal context, Grant Reporting extraction/goals/regeneration, Funding
Analysis extraction, and the Phase I Dynamics writeback flows. Those protections
remain valuable reference code. Reusing a preserved implementation requires a
new reviewed entry point and must preserve its bounded payload and retention
contract. No retirement here deletes prior output or changes stored prompt rows.

### P1 - Dynamics Explorer can send verbose CRM records into an agentic loop

`/api/dynamics-explorer/chat` sends role-gated CRM query/search results to Claude, and export processing can batch CRM records through Claude. Restrictions shape the accessible table/field set, but the serialization layer can still pass high-fidelity records wholesale.

Code threat: a tool, query expansion, or future schema change could include more CRM fields than the user intended to ask about.

**Status (2026-05-04): addressed at the model-context boundary.** `lib/utils/dynamics-explorer-serializer.js` now runs before tool results are appended back into the agentic Claude loop. It recursively strips OData metadata, redacts high-risk field names (`description`, `notetext`, `documentbody`, token/key/secret/password-like fields, raw-output/promptoverride fields), caps long scalar values, and adds content-free `_aiContextBoundary` metadata when redaction/truncation occurs. The same record serializer is used for export AI-processing sample/batch inputs. This is not a Dataverse permission control; it is a model-context minimization layer after app access, Dynamics restrictions, and query execution have already allowed the data.

Watch items that remain:
- If answer quality regresses because Claude needs a redacted narrative field, add a deliberate per-tool/per-table allow path rather than removing the serializer globally.
- If token costs keep rising, add per-table default `select` behavior for `query_records` / `get_entity` / `get_related` when Claude omits one.
- Continue monitoring for AI-summary loopback, especially if `wmkf_ai_summary` or similar fields become common in generic query results.

### P1 - Virtual Review Panel provider boundaries are configuration-sensitive (historical — legacy panel retired 2026-10-04)

`/api/virtual-review-panel` can send full proposal text to multiple providers through `MultiLLMService`, including Claude, OpenAI, Gemini, and Perplexity. This materially expands vendor exposure compared with Claude-only routes.

Code threat: a default provider list or environment variable change can broaden where payloads go without a code reviewer seeing the impact.

Recommended next step: keep provider policy changes explicit in config and tests as VRP stages evolve.

**Status (2026-05-04): addressed.** `VRP_ALLOWED_PROVIDERS` now gates the Virtual Review Panel provider set. Production fails closed when the variable is unset, dev/test retain the previous "any configured provider" behavior, and the API rejects runs unless `claude` is allowed because synthesis and intelligence-pass extraction/collation currently call Claude unconditionally. The resolved provider set is stored in `panel_reviews.config`.

### P2 - Legacy/direct Anthropic fetch paths bypass the canonical wrapper

`health-checker` and the old module demo still use direct `fetch` calls.
`ClaudeReviewerService` and `ContactEnrichmentService.claudeWebSearch`
previously did as well, but have since been migrated to `LLMClient`. Contact
enrichment now delegates through
`lib/services/contact-enrichment/search-tiers.js`, preserving the `web_search`
tool through `LLMClient.complete()`. Some remaining paths are low sensitivity,
but the direct-fetch pattern bypasses `LLMClient`'s timeout, safeFetch, retry,
and redaction behavior.

Recommended next step: migrate remaining production Claude callers to `LLMClient` or `safeFetch` as appropriate. Prioritize paths where the wrapper adds meaningful timeout, redaction, retry, or allowlist behavior.

**Status (reconciled 2026-07-27): mostly addressed.**
`ClaudeReviewerService` uses `LLMClient` for reviewer-finder analysis and
discovered-candidate reasoning (content-bearing debug logs are gated behind
`DEBUG_REVIEWER_FINDER`), and
`ContactEnrichmentService.claudeWebSearch` routes through `LLMClient`, wrapping
the candidate identity string as untrusted external content
(`dataClass: EXTERNAL_API_TEXT`, 2k cap) before the call. The remaining
production direct-fetch path in this finding is `health-checker` (low — static
“Hello,” acceptable). `modules/expertise_matching` also uses a direct browser
fetch, but source/caller inspection found no production caller; it is an
isolated reference/demo rather than part of the production Expertise Finder.
The residual data risk for contact enrichment is unchanged: candidate name +
institution still leave the app via Claude web search.

### P2 - AI-run logs persist generated outputs with large limits

`executePrompt()` and `DynamicsService.logAiRun()` can store model output in `wmkf_ai_rawoutput`. These are useful audit records, but may contain sensitive derived proposal/report content.

Code threat: a prompt output can unexpectedly include copied input text or sensitive fields and then persist far longer or wider than the original route response.

**Status (2026-05-04): partially addressed.** Executor output schemas now support `rawOutputRetention: "full" | "hash" | "none"`; `phase-i.summary` is the first adopter and stores hash metadata in `wmkf_ai_rawoutput` because the generated summary is already persisted to `akoya_request.wmkf_ai_summary`. `DynamicsService.logAiRun()` also accepts `rawOutputRetention` for non-Executor callers, but retained Grant Reporting helpers deliberately keep full output because it may be the only durable copy; other active callers need per-call retention decisions.

Recommended next step: confirm Dataverse permissions and retention for `wmkf_ai_run`, then adopt `rawOutputRetention` on the remaining high-volume `logAiRun()` call sites where full raw output is not needed.

### P3 - Error/log analysis flow is relatively well minimized

`/api/cron/log-analysis` redacts log entries before sending them to Claude and redacts again before storing alert output. This is a good pattern to reuse for other flows.

Recommended next step: use this as the model for "redact before external AI, redact again before persistence."

## Data Flow Matrix

| Area / Route | Provider(s) | Data Sent | Volume / Limits | Persistence After Call | Current Controls | Risk | Notes / Hardening Ideas |
|---|---|---|---|---|---|---|---|
| Retired app-suite endpoints (see manifest for all 13 paths) | None | No AI payload | Authenticated HTTP 410 | No application output/write; existing history retained | Existing method and app-access guards | Low | Source behavior only; deployment requires a separate receipt. |
| `/api/reviewer-finder/analyze` via `ClaudeReviewerService.analyzeProposal` | Anthropic Claude | Proposal text from upload/blob, additional notes, excluded names, reviewer count/settings | Body limit 10 MB; proposal text capped at 100,000 chars by `ai-payload-boundary` before prompt construction | Usage metadata; generated proposal info/reviewer suggestions returned to client and later saved by user flows | App access, rate limit, `safeFetch` for blob input, `LLMClient` for Anthropic transport, explicit AI payload boundary metadata | High | Direct Anthropic `fetch` has been removed from `ClaudeReviewerService`; proposal text now has an explicit cap/source/data-class boundary. |
| `/api/reviewer-finder/generate-emails` | Anthropic Claude | Candidate/reviewer details, proposal info, base email body | Per-email prompt; `maxTokens: 512` | Generated email returned/saved; usage metadata | App access; uses `LLMClient` | Medium | Sends reviewer + proposal context. Reasonable, but keep prompt fields tight. |
| `/api/reviewer-finder/enrich-contacts` / `ContactEnrichmentService.claudeWebSearch` | Anthropic Claude with web search | Candidate name and institution | Minimal prompt; `max_tokens: 256`; one web search | Enriched contact info returned/saved | App access, rate limit, `LLMClient` transport (timeout/safeFetch/retry/redaction), untrusted-content wrapping of candidate identity | Medium | Now uses `LLMClient` (`web_search` tool preserved via `complete()` passthrough). Residual risk: candidate name/institution still sent to Claude/web search. |
| `lib/services/execute-prompt.js` | Anthropic Claude by default; OpenAI only when the caller passes `allowedProviders` including `openai` and the prompt snapshot's reviewed model is an OpenAI id (Executor provider seam, 2026-09-12; publishing stays Claude-only) | Prompt variables from Dynamics, SharePoint text extraction, caller overrides | Per-variable payload boundary when a declaration includes both `dataClass` and `maxChars` (opt-in, backwards compatible); applied uniformly across `kind: override / dynamics / sharepoint` | Writes outputs to Dynamics; creates AI-run audit row with configurable raw-output retention (`full`, `hash`, `none`) and boundary summary | `LLMClient` transport (`safeFetch`/timeout/retry/redaction; 2026-06-11), reviewed model capability registry, centralized prompt executor, output guards, Dataverse audit, declarative payload boundary and raw-output retention | High | Mechanism shipped 2026-05-04; first adopter is `phase-i.summary`. `callClaude()` migrated from raw `fetch` to `LLMClient.complete()` 2026-06-11 (cache_control system array preserved; response re-shaped to raw Anthropic shape). As of 2026-06-25, concrete prompt-row Claude ids must be reviewed in the capability/pricing registry before execution. |
| `/api/dynamics-explorer/chat` | Anthropic Claude with tool loop | User question, recent conversation, tool definitions, serialized CRM query/search/list document results, possible serialized export AI-processing batches | Interactive streaming `maxTokens: 16000` with low effort; batch processing remains `maxTokens: 4096`; result char caps per tool plus recursive field redaction/long-string caps | Dynamics query log stores query params/counts; usage metadata includes per-call stop reason after migration 032 | App access, Dynamics roles/restrictions, reviewed-model effort capability gate, result char caps, conversation trimming, AI-context serializer | High | Model-context minimization shipped 2026-05-04. Phase A model posture and stop-reason capture are Production-live as of 2026-08-21; migration 032 is applied/read back, and signed-in smoke rows 5354/5355 proved `tool_use`/`end_turn` persistence. Longer observation remains open. |
| `/api/virtual-review-panel` and `PanelReviewService` | Anthropic, OpenAI, Gemini, Perplexity | Bounded proposal text for proposal-bearing stages; extracted claims/search results; parsed reviewer outputs for synthesis | Proposal text bounded at 100,000 chars once at the route boundary; multi-provider fan-out; panel DB stores text hash not raw proposal | Panel results/items/costs stored; provider outputs persisted | App access, rate limit, provider availability checks, `VRP_ALLOWED_PROVIDERS` allowlist, provider set persisted per run, explicit AI payload boundary metadata | High | Provider-set drift mitigated by production fail-closed allowlist. Remaining risk is that Claude is currently mandatory for synthesis and intelligence extraction/collation; future provider changes should make those stages policy-aware. |
| `MultiLLMService` | Anthropic, OpenAI, Gemini, Perplexity | Arbitrary prompt/system prompt from caller | Defaults `maxTokens: 16384`; timeout via `Promise.race`; Claude request body shaped by reviewed model capabilities | Usage metadata if logging context supplied; Claude refusal metadata surfaced | `safeFetch` for provider calls; `model-capabilities.js` for Anthropic request compatibility | High | Shared transport for full proposal review. Consider request aborts instead of Promise.race and provider-level data classification. |
| `/api/integrity-screener/screen` / `IntegrityService.analyzeWithHaiku` | Anthropic Claude | Search result titles, URLs, snippets for applicant/research integrity analysis | Top search results; `maxTokens: 1000` | Screening results/history through service | App access; `LLMClient` | Medium | Mostly public search snippets, but query subject is person/institution-sensitive. |
| `/api/cron/log-analysis` | Anthropic Claude | Redacted Vercel error summaries: timestamp, path, message | Up to 50 entries; `maxTokens: 1024` | Alert message/metadata stored; output redacted again | Cron secret, input redaction, output redaction, `LLMClient` | Low | Good reference pattern. |
| `lib/utils/health-checker.js` | Anthropic Claude | Static "Hello" health-check prompt | `max_tokens: 10` | Health status only | Cron/admin health surface | Low | Direct `fetch` acceptable risk, but can migrate to `safeFetch` for consistency. |
| `lib/services/claude-reviewer-service.js` | Anthropic Claude | Reviewer-finder prompts containing bounded proposal text, reviewer criteria, notes/exclusions | Proposal text capped at 100,000 chars by `ai-payload-boundary`; `LLMClient` retry/fallback behavior | Usage metadata through `LLMClient` | Called behind reviewer-finder app access; `LLMClient` transport with `safeFetch`, timeout, retry, redacted errors; explicit AI payload boundary metadata | High | Direct `fetch` migration and proposal-text boundary are complete for the reviewer-finder analysis path. |
| `lib/services/contact-enrichment-service.js` | Anthropic Claude web search | Candidate name and institution | Minimal prompt, one web search | Contact enrichment result | `LLMClient` transport (timeout/safeFetch/retry/redaction); untrusted-content wrapping of candidate identity; server-side credentials | Medium | Migrated to `LLMClient` (`:1082`; `web_search` tool preserved via `complete()` passthrough). Residual risk: candidate name/institution still sent to Claude/web search. |
| `lib/services/multi-llm-service.js` | Anthropic/OpenAI/Gemini/Perplexity | Arbitrary caller prompt, often proposal review prompts | Large max-token default; Claude request body shaped by reviewed model capabilities | Usage metadata; Claude refusal metadata | `safeFetch`; provider env keys; `model-capabilities.js` for Anthropic request compatibility | High | Exposure depends entirely on caller. Needs caller-level matrix references. |
| `modules/expertise_matching/src/reviewer_matcher.jsx` | Anthropic Claude | Browser-side prompt for the isolated module demo | Non-production reference/demo; no app/API caller found | Unknown within the standalone demo | Direct browser/component fetch | Low for the production app; medium if someone runs the demo | Do not cite this module as the production Expertise Finder. The production page/API uses `shared/config/prompts/expertise-finder.js`. Archive separately only with owner approval. |

**Tool-app prompt source after retirement.** Expense Reporter remains active and
uses `expense-reporter.extract-document|extract-image` through the shared
`tool-prompt-resolver` and composer. Preserve this infrastructure. The retired
Funding Analysis, Literature Analyzer, and Multi-Perspective Evaluator prompt
modules and stored rows remain available for future reviewed reuse, but their
HTTP retirement stubs no longer resolve or execute them. Expertise Finder is a
separate retirement workstream. This change does not unpublish any stored row or
prove the absence of external prompt consumers.

## Recommended Hardening Sequence

1. **Prompt Executor data classification — payload boundary and first retention policy shipped**
   - ✅ Per-variable `dataClass` + `maxChars` declarations are honored by the Executor (added 2026-05-04). Historical first adopter: `phase-i.summary` through the now-retired `/api/phase-i-dynamics/summarize-v2`; prompt metadata and Executor behavior are preserved.
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
   - 🟡 Review `health-checker` (low — static health ping).
   - ✅ Source/caller inspection classifies `modules/expertise_matching` as an
     isolated non-production reference/demo; it is not the production Expertise
     Finder.
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
