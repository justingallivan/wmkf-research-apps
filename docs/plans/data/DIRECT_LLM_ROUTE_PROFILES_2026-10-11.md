# Route profiles — direct-LLMClient routes vs. `executePrompt`

Source tree: `/Users/gallivan/Code/WMKF_Apps-refactor-plan` @ `b3135037c` (origin/main). All paths relative to that root. All claims `[VERIFIED via file:line]` unless marked otherwise. No `.codegraph/` in this worktree; everything read directly.

Shared facts used below:
- `LLMClient` ctor options: `{ apiKey=process.env.CLAUDE_API_KEY, model, fallbackModel=null, appName=null, userProfileId=null, requestId=null, requestRound=null, timeoutMs=DEFAULT_TIMEOUT_MS(120_000), maxRetries=DEFAULT_MAX_RETRIES(3), initialRetryDelayMs=2_000 }` [lib/services/llm-client.js:93-121, :43-46]. `complete(opts)` accepts `system (string|Array), messages, maxTokens, temperature, tools, signal` [llm-client.js:124-134]; defaults `max_tokens=4_096`, `temperature=0.3` [llm-client.js:46-47, :226, :233]. Retries 429/529 with backoff; single fallback-model swap on 529 only if `fallbackModel` set [llm-client.js:14-15, :42, :319-328]. Logs `api_usage_log` via `logUsage` ONLY when `appName` is set (`_logSuccess` / `_logFailure`) [llm-client.js:402-431].
- `requireAcceptedLlmResponse(response)` throws `{code:'model_refusal', status:422}` when `response.refused===true || stopReason==='refusal'` [lib/utils/llm-response.js:8-17].
- `getModelForApp(appKey, type='model')` resolves a tier key via `_resolveModel` after `loadModelOverrides()`; `getFallbackModelForApp(appKey)` = `getModelForApp(appKey,'fallback')` [shared/config/baseConfig.js:306-313, :350-352]. Tier table: `multi-perspective-evaluator {model:'sonnet', visionModel:'sonnet', fallback:'haiku'}` [:27]; `literature-analyzer` same [:28]; `funding-analysis {model:'sonnet', fallback:'haiku'}` [:48]; `expense-reporter {model:'haiku', fallback:'haiku'}` [:51]; `expertise-finder {model:'sonnet', fallback:'haiku'}` [:59].
- `nextRateLimiter(options)` defaults `windowMs=60_000`, `max=BASE_CONFIG.RATE_LIMITS.REQUESTS_PER_MINUTE` [shared/api/middleware/rateLimiter.js:37-39].
- `logUsage({ userProfileId, appName, model, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cacheCreationTokens1h, latencyMs, status, errorMessage, stopReason, requestId, requestRound })` [lib/utils/usage-logger.js:35-50].
- `ai-payload-boundary` caps: `FUNDING_GAP_PROPOSAL_MAX_CHARS=100_000` [lib/utils/ai-payload-boundary.js:48], `EXPERTISE_FINDER_PROPOSAL_MAX_CHARS=100_000` [:37], `PEER_REVIEW_TEXT_MAX_CHARS=60_000` [:64]; `DATA_CLASSES` = `{PROPOSAL_TEXT, REVIEW_TEXT, STAFF_PROVIDED_CONTEXT, EXTERNAL_API_TEXT, LLM_OUTPUT, …}` [:21-29]; `wrapUntrustedContent` [:163], `buildUntrustedContentPreamble(nonces=[])` [:260], `deriveStableNonce` [:242], `buildBoundedTextPayload` [:66]. (File is detected as `data` by `file(1)`; grep needs `-a`.)
- Uploads: `FileUploaderSimple` uses `@vercel/blob/client` `upload()` with `handleUploadUrl:'/api/upload-handler'`; returns descriptor with `url`, `pathname`, (optional) `access` [shared/components/FileUploaderSimple.js:2, :56-63, :76]. `fetchPublicBlob(url)` restricts to the public Blob host [lib/utils/public-blob-fetch.js:12, :31]. `readUploadedBlobBuffer(file)` reads `access:'private'` by `pathname` via `UPLOADS_BLOB_RW_TOKEN`, else `fetchPublicBlob(url)` [lib/utils/uploaded-blob.js:6-13, :27].
- `createFileProcessor().processFile(buffer, filename)` → `{text, metadata}`; supports `pdf` (pdf-parse) and `txt`; `docx` throws "not yet implemented" [shared/api/handlers/fileProcessor.js:6, :24-40, :191].
- Prompt-injection gate registry entries (all `status:'migrated'`): `evaluate-multi-perspective` inv 8 multimodal, builders listed [scripts/check-prompt-injection-tagging.js:177-195]; `analyze-literature` inv 9 [:198-207]; `analyze-funding-gap` inv 10 [:209-220]; `process-expenses` inv 11 route-local [:225-229]; `expertise-finder` inv 13 (match.js + batch-match-service.js) [:231-238]; `cron-log-analysis` inv 24 route-local [:325-329]; `process-peer-reviews` inv 7 with peer-reviewer-dynamics.js noted as Executor-handled [:164-175].
- Security matrix rows: `/api/analyze-funding-gap` [docs/API_ROUTE_SECURITY_MATRIX.md:180], `/api/analyze-literature` [:181], `/api/cron/log-analysis` [:193], `/api/evaluate-multi-perspective` [:223], `/api/expertise-finder/match` [:227], `/api/process-expenses` [:311].

---

## 1. `pages/api/evaluate-multi-perspective.js` ← `pages/multi-perspective-evaluator.js`

### Guard / limits / config
- Method: POST only, else 405 [pages/api/evaluate-multi-perspective.js:78-80].
- Auth: `requireAppAccess(req,res,'multi-perspective-evaluator')`; `access.profileId` used as `userProfileId` [:83-84, :110].
- Rate limiter: `nextRateLimiter({ max: 5 })` (default 60s window), applied after auth [:64, :86-87].
- `loadModelOverrides()` before any model lookup [:89].
- Body: `bodyParser.sizeLimit:'1mb'`, `responseLimit:false`, `externalResolver:true`, `maxDuration: 600` [:861-870].
- Requires `process.env.CLAUDE_API_KEY`; if missing, emits SSE `error` event and `res.end()` (after headers already set) [:104-108].
- Input validation: `files` required (400) [:112-114]; `framework` must be in `EVALUATION_FRAMEWORKS` (400) [:117-119]; exactly one file (400) [:122-124]. NOTE these 400s are `res.status().json()` AFTER streaming headers were set at :92-95.

### LLM calls
- All calls funnel through `callClaudeWithRetry(requestBody, apiKey, modelType, userProfileId)` [:558-638], which constructs `new LLMClient({ apiKey, model: primaryModel, maxRetries: 0 })` per attempt [:578] and a second `new LLMClient({ apiKey, model: fallbackModel, maxRetries: 0 })` for the single fallback try [:615]. `primaryModel = getModelForApp('multi-perspective-evaluator', modelType)` (`'visionModel'` for Stage 1, `'model'` otherwise) [:560, :677, :436]; `fallbackModel = getFallbackModelForApp('multi-perspective-evaluator')` [:561]. No `appName`/`userProfileId`/`timeoutMs` passed → client default 120s timeout, no client-side usage logging.
- Route-owned retry: `RETRY_CONFIG {MAX_RETRIES:3, INITIAL_DELAY_MS:2000, MAX_DELAY_MS:30000, BACKOFF_MULTIPLIER:2}` [:70-75]; loop :567-610; `isRetryableError(status, text)` = 429/529/503 or message contains overloaded/rate limit/too many requests [:547-553]. Inner catch: retryable → `continue`; non-retryable → `throw` [:582-589]. Outer catch rethrows any error whose message lacks `'Claude API error'` [:604-609] (so `model_refusal` and most errors exit immediately). After exhausting retries → fallback model once; fallback failure rethrows `lastError` unless refusal [:612-623].
- Legacy-shape translation `toCompleteOpts(body)` maps `max_tokens→maxTokens`, `temperature`, `system`, `tools` [:640-648]. No call sets `system` or `tools`.
- Return shape mimics raw API: `{ data:{content, model, usage:{input_tokens, output_tokens}}, usedFallback, model }` [:598-603, :633-637]; callers read `data.content[0].text` [:437, :481, :520, :683].
- Stage 1 `performInitialAnalysis(base64Pdf, apiKey, userProfileId)` [:653-703]: prompt `createInitialAnalysisPrompt()` [shared/config/prompts/multi-perspective-evaluator.js:209; route :654]; user content = `[ {type:'document', source:{type:'base64', media_type:'application/pdf', data}} , {type:'text', text:prompt} ]` [:656-675]; `max_tokens: 2000`, no temperature → client default 0.3 [:657]; modelType `'visionModel'` [:677]. Parse: unanchored fenced-JSON regex, `JSON.parse`, then `validateStage(parsed, INITIAL_ANALYSIS_SCHEMA, 'initial analysis')` [:686-692]; on failure returns fallback object `{title:'Unknown Concept', summary, researchArea:'general', keywords:[], error}` [:695-701].
- Stage 2 `searchLiterature(initialAnalysis)` — non-LLM: PubMed/ArXiv/BioRxiv/ChemRxiv via `selectDatabasesForResearchArea` [:708-801, :59-62].
- Stage 2.5 `generateProposalSummary(initialAnalysis, literatureResults, apiKey, userProfileId)` [:506-542]: prompt `createProposalSummaryPrompt(initialAnalysis, literatureResults)` [prompts/multi-perspective-evaluator.js:285; route :507]; `max_tokens:1500, temperature:0.3` [:510-511]; validated against `PROPOSAL_SUMMARY_SCHEMA` [:528]; refusal rethrown, other errors → fallback object [:529-541].
- Stage 3 fan-out `runPerspectivesInParallel` [:403-419]: `Promise.allSettled` over 3 `callPerspective(...)` with `createOptimistPrompt` / `createSkepticPrompt` / `createNeutralPrompt` (all `(initialAnalysis, literatureResults, framework)`) [prompts/multi-perspective-evaluator.js:371, :440, :522; route :405-407]; `max_tokens:2500, temperature:0.3` [:428-429]; rejected `model_refusal` rethrown [:411-412]; others become `{error}` [:415-417]; validated by `PERSPECTIVE_SCHEMAS[name]` [:446-448]. Needs ≥2 successes else throws [:326-329].
- Stage 4 fan-in `performIntegration` [:462-501]: `createIntegratorPrompt(initialAnalysis, optimist, skeptic, neutral, framework)` [prompts/multi-perspective-evaluator.js:592; route :463-469]; `max_tokens:3500, temperature:0.3` [:472-473]; `INTEGRATOR_SCHEMA` [:490]; parse failure → `{synthesis:{weightedRecommendation:'Unknown', …, rawResponse}}` [:493-499].
- `validateStage` THROWS on schema failure (not fall-through) — A7 follow-up [:44-56].
- Eligibility short-circuit: if Stage 1 says ineligible, returns flagged object with no further LLM calls [:259-304].

### Topology
- Per uploaded file (max 1): `splitPdfToPages` → one concept per page [:145]; pages processed via `processWithConcurrency(items, fn, CONCURRENCY_LIMIT=2)` (exported; chunked `Promise.all`) [:67, :151-167, :231-240].
- Per concept: Stage 1 (1 call) → lit search (0 calls) → Stage 2.5 (1) → fan-out (3 parallel) → fan-in (1) = 6 LLM calls on the happy path, 1 if flagged ineligible; each call may add up to 3 retries + 1 fallback.

### Streaming
- Headers: `Content-Type: text/plain`, `Transfer-Encoding: chunked`, `Cache-Control: no-cache`, `Connection: keep-alive` [:92-95] — SSE-formatted frames over text/plain.
- Frames all `data: <json>\n\n`. Progress frames `{progress, message, stage?}` via `sendProgress(res, progress, message, stage)` [:222-226]; stage strings: `initial-analysis`, `eligibility-flag`, `literature-search`, `proposal-summary`, `perspectives`, `integration` [:251, :260, :307, :311, :315, :332]. Named-event frame `{event:'error', message}` via `sendEvent` (only use) [:97-99, :106]. Terminal frame `{progress:100, message:'Multi-perspective evaluation complete!', results:{concepts, framework, frameworkName, summary:{totalConcepts, successfulEvaluations, flaggedAsIneligible, errors, timestamp}}}` then `res.end()` [:189-207]. No `[DONE]` sentinel.
- Top-level catch calls `res.status(500).json(...)` even after frames were written [:209-216].
- Client: raw `fetch('/api/evaluate-multi-perspective', {POST, body:{files:selectedFiles, framework:selectedFramework}})` [pages/multi-perspective-evaluator.js:661-671]; non-OK → `response.json().error` [:673-676]; `response.body.getReader()` + `TextDecoder`, buffer split on `\n\n`, lines starting `data: ` JSON-parsed; reads `data.progress` → `setProgress`, `data.message` → `setProgressText`, `data.stage` → `setProgressStage`, `data.results` → `setResults`; parse errors `continue` [:679-721]. Does NOT read `event` — the `error` event is emitted but unconsumed. No `sse-stream.js` helper.

### Inputs
- Body `{files:[{url, filename}], framework='keck'}` [:102]; file fetched with `fetchPublicBlob(file.url)` (public blob only) [:136]; `splitPdfToPages(arrayBuffer)` (pdf-lib → per-page base64 PDFs) [:145; lib/utils/pdf-page-splitter.js:8, :13-15]. No `FileProcessor`. Upload via `FileUploaderSimple` [pages/multi-perspective-evaluator.js:3, :1055].
- `ai-payload-boundary` usage is inside the prompt module only: `wrapConceptAnalysis` caps Stage-1 JSON at `MP_CONCEPT_MAX_CHARS=20_000` / `PROPOSAL_TEXT` [prompts/multi-perspective-evaluator.js:30, :39-54]; literature at `MP_LITERATURE_MAX_CHARS=60_000` / `EXTERNAL_API_TEXT` [:31, :287-291, :344-348]; perspectives at `MP_PERSPECTIVE_MAX_CHARS=40_000` / `LLM_OUTPUT` [:32, :597-601]. The route itself does not import `ai-payload-boundary`.

### Usage logging
- Manual `logUsage({userProfileId, appName:'multi-perspective-evaluator', model:r.model, inputTokens, outputTokens, latencyMs})` after primary success [:590-597] and after fallback success [:624-631]. No failure-path logging. (Client has no `appName`, so no double-count.)

### Outputs / persistence
- Returned only via final SSE frame (above). No Postgres/Dataverse/Blob writes.

### Tests
- `tests/unit/multi-perspective-refusal.test.js` — imports route handler [:11]; mocks `lib/services/llm-client` at module level [:9], auth, limiter, overrides, blob fetch, splitter, usage-logger, `validateAiJson`; asserts refusal at stage call 1/2/3 yields `summary.errors===1`, concept `error`, and exact `complete` call counts (`refusedAt===3 ? 5 : refusedAt`) [:14-31].
- `tests/unit/evaluate-multi-perspective-concurrency.test.js` — requires named export `processWithConcurrency` [:9]; asserts chunk-boundary scheduling and order preservation [:12, :44].
- `tests/unit/multi-perspective-a7.test.js` — prompt module only: preamble presence in all 6 builders, wrapping of concept/literature/perspectives, `INTEGRATOR_SCHEMA` record type [:24-74].
- `tests/unit/utils/public-blob-fetch.test.js` — source-regex check that this route (and analyze-literature, analyze-funding-gap, expertise-finder/match) use `fetchPublicBlob` [:75-76].
- No test imports `pages/multi-perspective-evaluator.js` (grep `pages/multi-perspective-evaluator` over `tests/` → 0 hits).

### A7
- Prompt module header: Stage 1 multimodal → preamble-only control [prompts/multi-perspective-evaluator.js:11-14]; every downstream stage wraps re-fed content with nonces and prepends `buildUntrustedContentPreamble([...nonces])` [:25-27, :224, :295, :374, :443, :525, :608]. Route: `validateStage` A7 comment [:44-51]; no `wrapUntrustedContent` in route.

---

## 2. `pages/api/analyze-literature.js` ← `pages/literature-analyzer.js`

### Guard / limits / config
- POST only [pages/api/analyze-literature.js:29-31]; `requireAppAccess(req,res,'literature-analyzer')` [:34-35]; `nextRateLimiter({max:5})` [:23, :37-38]; `loadModelOverrides()` [:40].
- `CLAUDE_API_KEY` required → 500 JSON before headers [:46-49]; `files` required → 400 [:53-55].
- Config `bodyParser.sizeLimit:'1mb'`, `responseLimit:false`, `externalResolver:true`, `maxDuration:600` [:325-334].

### LLM calls
- Three functions each build a fresh `new LLMClient({ apiKey, model, appName:'literature-analyzer', userProfileId })` (default `maxRetries=3`, 120s timeout, no `fallbackModel`) [:219-224, :261-266, :296-301].
- Stage 1 `extractPaperInfo(base64Pdf, apiKey, userProfileId)` [:216-253]: model `getModelForApp('literature-analyzer','visionModel')` [:221]; prompt `createPaperExtractionPrompt()` [shared/config/prompts/literature-analyzer.js:30; route :217]; content = `[document base64 application/pdf, text]` [:226-232]; `maxTokens:4000`, no temperature (client default 0.3) [:233]; `requireAcceptedLlmResponse` [:225]. Parse unanchored fenced regex → `JSON.parse`; failure → `{title:'Unknown Paper', abstract, error}` [:237-252]. No schema validation.
- Stage 2 `generateSynthesis(papers, focusTopic, apiKey, userProfileId)` [:258-288]: model `getModelForApp('literature-analyzer')` [:263]; `createSynthesisPrompt(papers, focusTopic=null)` [prompts/literature-analyzer.js:96; route :259]; `maxTokens:6000, temperature:0.3` [:269-270]; parse failure → `{synthesis: text.slice(0,2000), parseError:true}` [:283-286].
- Optional `generateComparisonData(papers, comparisonType, apiKey, userProfileId)` [:293-323]: `createComparisonPrompt(papers, comparisonType='findings')` [prompts/literature-analyzer.js:232; route :294]; `maxTokens:4000, temperature:0.3` [:304-305]; failure → `{summary, parseError:true}` [:318-321].
- No route-owned retry, no fallback model, no tools, no system prompt.

### Topology
- Stage 1 is a SEQUENTIAL `for (const file of files)` loop [:70-127]; `CONCURRENCY_LIMIT=2` is declared but unused [:26]. Then synthesis if ≥2 successes [:138-142]; comparison only if `options.generateComparison` [:150-153]. Calls per request = N + (N≥2 ? 1 : 0) + (generateComparison && N≥2 ? 1 : 0).

### Streaming
- Headers `text/plain` + chunked + no-cache + keep-alive, set AFTER the 400/500 validations [:58-61].
- Frames: `{progress, message}` via `sendProgress` [:202-204]; named events via `sendEvent(res, event, data)` → `{event, ...data}` [:209-211]: `paper_extracted {index, filename, title, authors, year}` [:97-103], `paper_error {index, filename, error}` [:112-116], `synthesis_complete {success:true}` [:143]. Terminal `{progress:100, message:'Analysis complete!', results:{papers, synthesis, comparison, summary:{totalPapers, successfulExtractions, errors, timestamp}}}` then `res.end()` [:170-187]. No `[DONE]`.
- Top-level catch → `res.status(500).json(...)` even post-stream [:189-196].
- Client: raw `fetch('/api/analyze-literature', {POST, body:{files, options:{focusTopic}}})` — page never sends `generateComparison`/`comparisonType` [pages/literature-analyzer.js:383-394]; same reader loop as MPE (split `\n\n`, `data: ` prefix, reads `progress`, `message`, `results`; ignores `event`) [:403-445]. Named events emitted but unconsumed.

### Inputs
- `{files:[{url, filename}], options:{focusTopic, generateComparison, comparisonType}}` [:43-44]; `fetchPublicBlob(file.url)` → base64 of whole PDF [:78-84]. No `FileProcessor`, no `splitPdfToPages`. Upload via `FileUploaderSimple` [pages/literature-analyzer.js:3, :622].
- `ai-payload-boundary` only inside prompt module: synthesis/comparison wrap formatted paper summaries at `LITERATURE_SUMMARIES_MAX_CHARS=120_000` / `STAFF_PROVIDED_CONTEXT` [prompts/literature-analyzer.js:23, :97-101, :233-237]. Route does not import it.

### Usage logging
- Via `LLMClient appName:'literature-analyzer'` (automatic success + failure logging) [:222, :264, :299; llm-client.js:402-431]. No manual `logUsage`.

### Outputs / persistence
- Final SSE frame only; no persistence.

### Tests
- `tests/unit/part6-prompts-a7.test.js` — prompt module only: Stage-1 preamble, synthesis+comparison wrapping [:10-14, :31-43].
- `tests/unit/utils/public-blob-fetch.test.js:75` — source regex for `fetchPublicBlob` use.
- No test imports `pages/api/analyze-literature.js` or `pages/literature-analyzer.js` (grep `analyze-literature|pages/literature-analyzer` over `tests/` → only the two files above).

### A7
- Prompt module header [prompts/literature-analyzer.js:8-13]; `buildUntrustedContentPreamble()` in Stage 1 [:31], `([nonce])` in synthesis/comparison [:109, :245]. Route itself carries no A7 code.

---

## 3. `pages/api/analyze-funding-gap.js` ← `pages/funding-gap-analyzer.js`

### Guard / limits / config
- POST only [pages/api/analyze-funding-gap.js:36-38]; `requireAppAccess(req,res,'funding-gap-analyzer')` [:41-42]; `loadModelOverrides()` [:43]; rate limiter `nextRateLimiter({windowMs:60_000, max:3})` applied after auth [:28-31, :46-50].
- `files` required → 400 [:55-57]; `CLAUDE_API_KEY` → 500 [:60-64]. Both before headers.
- Config `bodyParser.sizeLimit:'1mb'` only — no `maxDuration`, no `responseLimit` [:19-25].

### LLM calls
- ONE shared `new LLMClient({ apiKey, model:getModelForApp('funding-analysis'), appName:'funding-analysis', userProfileId })` for the whole request [:82-87]. NOTE app key mismatch: access key `'funding-gap-analyzer'`, model/usage key `'funding-analysis'` [:41 vs :84-85; baseConfig.js:48].
- Call A (extraction) per file: `createFundingExtractionPrompt(wrappedProposal, nonces=[])` [shared/config/prompts/funding-gap-analyzer.js:28; route :127-130]; `maxTokens:1000, temperature:0.3` [:134-138]; `requireAcceptedLlmResponse` [:134]; refusal rethrown, other errors wrapped as `Claude API error: …` [:139-143]. Parse: strip ```json fences, `JSON.parse`, `validateAiJson(parsed, FUNDING_EXTRACTION_SCHEMA)` — failure THROWS [:149-164]; requires `pi`, `institution`, `keywords[]` [:166-168].
- Call B (analysis) per file: `createFundingAnalysisPrompt(data)` where `data={pi, institution, keywords, nsfData, nihData, usaSpendingData, searchYears}` [prompts/funding-gap-analyzer.js:80; route :378-388]; `maxTokens:4000, temperature:0.4` [:392-396]; output is markdown text used verbatim (no JSON parse) [:417].
- No fallback model, no route retry (client default 3), no tools, no system prompt. `createBatchFundingSummaryPrompt` [prompts/funding-gap-analyzer.js:277] is exported but has NO consumer in `pages/` or `lib/` (grep → 0 files).

### Topology
- Sequential `for (i…files)` [:93]; per file: fileProcessor → Call A → NSF PI (+last-name retry) → NSF keywords → NIH PI → NIH keywords → optional USAspending → Call B [:100-402]. 2 LLM calls per file, all sequential.

### Streaming
- Headers `Content-Type: text/event-stream`, no-cache, keep-alive [:69-71] (true SSE content type).
- Frames `{message, progress?}` via `sendProgress(message, progress)` [:73-80]. Terminal `{complete:true, results:{[filename]:{formatted, structured:{pi, institution, state, keywords, nsfTotalFunding, nsfAwardCount, nihTotalFunding, nihProjectCount, usaSpendingTotalFunding, usaSpendingAwardCount}, metadata}}, metadata:{proposalCount, searchYears, generatedAt}}` then `res.end()` [:476-486]. Top-level error → frame `{error, details?, complete:true}` then `res.end()` (no 500) [:488-495]. No `[DONE]`.
- Client: raw `fetch('/api/analyze-funding-gap', {POST, body:{files, searchYears, includeCoPIs, includeUSASpending}})` [pages/funding-gap-analyzer.js:36-46]; reader loop splitting `\n\n`; reads `progress`, `message`, `complete && results` → `setResults`, and `if (data.error) throw` [:56-96] — but that throw is inside the per-line `try{…}catch{continue}` [:75-101], so server `error` frames are logged and swallowed, not surfaced.

### Inputs
- `{files:[{url, filename}], searchYears=5, includeCoPIs=false, includeUSASpending=false}` [:53]; `fetchPublicBlob(file.url)` [:102]; `createFileProcessor().processFile(buffer, filename)` → `{text, metadata}` (pdf-parse) [:88, :108-111]; `<100` chars → throw [:113-115]. Upload via `FileUploaderSimple` [pages/funding-gap-analyzer.js:3, :308].
- `ai-payload-boundary` in route: `wrapUntrustedContent({text:proposalText, source:'funding-gap.extraction.proposalText', dataClass:PROPOSAL_TEXT, maxChars:FUNDING_GAP_PROPOSAL_MAX_CHARS(100_000), label:'research proposal'})`; nonce passed to prompt builder; `payload.metadata` stored as `metadata.aiPayloadBoundary` [:120-130, :423]. Prompt module wraps NSF/NIH/USA JSON at `FUNDING_API_DATA_MAX_CHARS=120_000` / `EXTERNAL_API_TEXT` [prompts/funding-gap-analyzer.js:19, :85-107].

### Usage logging
- Via `LLMClient appName:'funding-analysis'` [:85]. No manual `logUsage`.

### Outputs / persistence
- Final SSE frame; no persistence.

### Tests
- `tests/integration/funding-gap-payload-boundary.test.js` — dynamic-imports route [:87]; module-mocks `llm-client` (captures `messages[0].content` into `sentPrompts`, branches on `'Return only valid JSON'`) [:57-80], `baseConfig` (`getModelForApp→'claude-test'`) [:25-30], `fileProcessor` [:33], `public-blob-fetch`, `fundingApis`, limiter, overrides; asserts 2 prompts sent, first contains `'AI payload boundary: funding-gap.extraction.proposalText'`, neither contains the over-cap tail, and `metadata.aiPayloadBoundary` shape [:122-150].
- `tests/unit/part6-prompts-a7.test.js` — prompt module: extraction preamble + wrapped block, analysis wraps 3 API blocks, batch summary wraps proposals [:15-19, :45-72].
- `tests/unit/utils/public-blob-fetch.test.js:75` source regex.
- No test imports `pages/funding-gap-analyzer.js`.

### A7
- Route: `wrapUntrustedContent` + nonce → `createFundingExtractionPrompt(text,[nonce])` [:120-130]; `validateAiJson` "A7 Part 6" comment [:156-163]. Prompt module header [prompts/funding-gap-analyzer.js:5-9]; preamble at [:29, :107, :287].

---

## 4. `pages/api/process-expenses.js` ← `pages/expense-reporter.js`

### Guard / limits / config
- POST only [pages/api/process-expenses.js:126-128]; `requireAppAccess(req,res,'expense-reporter')` with long comment on staff-shared private-blob scope [:130-143]; `loadModelOverrides()` [:144]; limiter `nextRateLimiter({windowMs:60_000, max:10})` [:28-31, :147-151].
- `files` → 400 [:156-158]; `CLAUDE_API_KEY` → 500 [:163-166]. Config `bodyParser.sizeLimit:'1mb'` only; no `maxDuration` [:19-25].

### LLM calls
- ONE shared `new LLMClient({ apiKey, model:getModelForApp('expense-reporter'), appName:'expense-reporter', userProfileId })` [:198-203] (haiku tier [baseConfig.js:51]).
- Prompt is ROUTE-LOCAL: `createExpenseExtractionPrompt(wrappedContent, fileName, fileType)` [:41-121]; opens with `buildUntrustedContentPreamble()` (no nonces) [:44]; image branch text says "ATTACHED IMAGE" [:48]; PDF branch appends `## Document content (UNTRUSTED…)\n${wrappedContent}` [:117-120]. No `shared/config/prompts/*` module.
- Image path (png/jpg/jpeg) [:217-252]: `readUploadedBlobBuffer(file)` → base64 → content `[ {type:'image', source:{type:'base64', media_type:'image/<ext>', data}}, {type:'text', text:prompt('', filename, ext)} ]` [:225-245]; `maxTokens:1000, temperature:0.2` [:248-252]. NO `requireAcceptedLlmResponse`.
- PDF path [:299-333]: `readUploadedBlobBuffer` → `fileProcessor.processFile` → `wrapUntrustedContent({text, source:'process-expenses.documentText', dataClass:STAFF_PROVIDED_CONTEXT, maxChars:EXPENSE_DOC_MAX_CHARS(60_000), label:'receipt or invoice'})` [:17, :321-327] → `complete({messages:[{role:'user', content:prompt}], maxTokens:1000, temperature:0.2})` [:329-333]. NO `requireAcceptedLlmResponse`.
- Parse both paths: strip fences, first `{…}` (non-greedy) regex, `JSON.parse`, `validateAiJson(parsed, EXPENSE_EXTRACTION_SCHEMA)`; on validation failure WARN and fall back to raw parse (best-effort) [:255-283, :336-364]; parse exception → placeholder expense row [:284-297, :365-378].
- No fallback model, no route retry, no tools, no system prompt.

### Topology
- Sequential `for (const file of files)`; 1 call per file [:210-394].

### Streaming
- `res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive'})` [:171-175].
- Frames: `{type:'progress', message, timestamp}` [:178-184]; `{type:'error', error, timestamp}` [:190-196]; terminal `{type:'result', expenses, summary, processedFiles, timestamp}` [:408-414] followed by `data: [DONE]\n\n` then `res.end()` [:416-417]. Error handling checks `res.headersSent`: pre-headers → 500 JSON, post → `sendError` frame + end [:422-431].
- Client: raw `fetch('/api/process-expenses', {POST, body:{files:uploadedFiles}})` [pages/expense-reporter.js:63-69]; reader splits each chunk on `\n` (NOT `\n\n`, no cross-chunk buffer) [:84-86]; `data: ` lines JSON-parsed, `[DONE]` tolerated [:89-98]; dispatch on `data.type`: `progress`→`setStreamingMessage`, `result`→`setResults(data)`, `error`→throw (outside inner try → propagates to `setError`) [:100-107].

### Inputs
- `{files:[{filename, url?, pathname?, access?}]}` [:154]; `readUploadedBlobBuffer(file)` (private-by-pathname or public URL) [:225, :303]; `createFileProcessor().processFile` for PDFs [:204, :304]. Page uploads via `FileUploaderSimple` with `access = NEXT_PUBLIC_EXPENSE_REPORTER_PRIVATE_BLOB==='true' ? 'private' : 'public'` [pages/expense-reporter.js:326-337].
- `ai-payload-boundary`: route-level `EXPENSE_DOC_MAX_CHARS=60_000` on PDF text only [:17, :321-327]; image path unwrapped (multimodal preamble only).

### Usage logging
- Via `LLMClient appName:'expense-reporter'` [:201]. No manual `logUsage`.

### Outputs / persistence
- SSE `result` frame; no persistence.

### Tests
- `tests/integration/process-expenses-a7.test.js` — dynamic-imports route [:65]; module-mocks `llm-client` (returns JSON with an injected key) [:41-54], `fileProcessor`, `public-blob-fetch`, limiter, overrides; asserts PDF path prompt is a string containing `UNTRUSTED CONTENT RULES:` and matching open/close sentinels with same nonce [:78-88]; image path content is an array with `content[0].type==='image'` and text block containing `UNTRUSTED CONTENT RULES:` and `ATTACHED IMAGE` [:90-99].
- `tests/unit/utils/public-blob-fetch.test.js:91-92` — source regex that route uses `readUploadedBlobBuffer(`.
- No test imports `pages/expense-reporter.js`.

### A7
- Route header comment "A7 prompt-injection hardening (Part 5)" [:33-40]; preamble [:44]; wrapping [:321-327]; schema validation "A7 Part 5" comments [:272-279, :353-360].

---

## 5. `pages/api/expertise-finder/match.js` ← `pages/expertise-finder.js`

### Guard / limits / config
- POST only [pages/api/expertise-finder/match.js:38-40]; `requireAppAccess(req,res,'expertise-finder')` (`APP_KEY`) [:35, :42-43]; `loadModelOverrides()` [:45]. NO rate limiter. Config `bodyParser.sizeLimit:'10mb'`; no `maxDuration` [:231-237].
- `file.url` required → 400 [:54-56]; blob fetch failure → 400 [:59-62]; `<100` chars text → 400 [:69-71]; `CLAUDE_API_KEY` → 500 [:73-76]; empty roster → 400 [:83-85].

### LLM calls
- `callClaude(apiKey, model, systemPrompt, userPrompt)` builds `new LLMClient({ apiKey, model })` — no `appName` on purpose (route logs `modelUsed`) [:213-217]; `complete({ system:[{type:'text', text:systemPrompt, cache_control:{type:'ephemeral'}}], messages:[{role:'user', content:userPrompt}], maxTokens:4096, temperature:0.2 })` with `requireAcceptedLlmResponse` [:218-223]; returns `{content, usage:{input_tokens, output_tokens}, model}` [:224-228].
- `primaryModel = getModelForApp('expertise-finder')`, `fallbackModel = getFallbackModelForApp('expertise-finder')` [:48-49]. Fallback: on ANY non-refusal error from the primary (not only retryable), call again with fallback model; `modelUsed` tracks which [:105-112]. Client default retries (3) apply inside each.
- Prompts: `buildCacheableSystemPrompt(rosterMembers)` [shared/config/prompts/expertise-finder.js:77; route :92] — contains `buildUntrustedContentPreamble()` (no nonce, cacheable) [:82]; `buildUserPrompt(wrappedProposal, additionalNotes='')` [:183; route :100]. `SYSTEM_PROMPT` const also exported [:64].
- Parse: unanchored fenced regex → `JSON.parse`; failure → 500 `{error:'Failed to parse matching results', rawResponse}` [:117-130]. Then `validateAiJson(matchResults, EXPERTISE_MATCH_SCHEMA)`; failure → 502 [:132-140].
- No tools, no images, single call (plus optional fallback call).

### Topology
- Single request → 1 LLM call (2 on fallback). No loops.

### Streaming
- None. Single JSON response `{success:true, matchId, results, metadata:{model, inputTokens, outputTokens, estimatedCostCents, latencyMs, rosterSize}}` [:178-190].
- Client: `requestEnvelope('/api/expertise-finder/match', {method:'POST', body:{file:{url, filename}, additionalNotes}})` → `{ok, status, data}`; `setResults(data.results)`, `setMetadata(data.metadata)` [pages/expertise-finder.js:9, :197-210]. Batch tab uses a different route `/api/expertise-finder/batch-match` [:728]; the gate registry attributes that call site to `lib/services/expertise-finder/batch-match-service.js` [check-prompt-injection-tagging.js:234-237], which uses direct `LLMClient` with the same prompt builders [batch-match-service.js:29-31, :151-159, :288]. (`pages/api/expertise-finder/batch-match.js` itself not read.)

### Inputs
- `{file:{url, filename}, additionalNotes}` [:52]; `fetchPublicBlob(file.url)` [:59]; `pdf-parse` directly (`pdf(Buffer)` → `.text`) — not `FileProcessor` [:17, :65-66]. Roster from Postgres `SELECT * FROM expertise_roster WHERE is_active = true` [:79-81]. Upload via `FileUploaderSimple` [pages/expertise-finder.js:3, :225].
- `ai-payload-boundary` in route: `wrapUntrustedContent({text:proposalText, source:'expertise-finder.match.proposalText', dataClass:PROPOSAL_TEXT, maxChars:EXPERTISE_FINDER_PROPOSAL_MAX_CHARS(100_000), label:'research proposal'})` [:93-99]; nonce NOT passed to preamble (preamble is general-form for cacheability) [prompts/expertise-finder.js:10-13].

### Usage logging
- Manual `logUsage({userProfileId, appName:'expertise-finder', model:modelUsed, inputTokens, outputTokens, latencyMs, status:'success'})` [:168-176]; on error `logUsage({… model:primaryModel, inputTokens:0, outputTokens:0, status:'error', errorMessage})` [:195-204]. `estimateCostCents(modelUsed, in, out)` [:146].

### Outputs / persistence
- Postgres INSERT `expertise_matches (user_profile_id, proposal_title, proposal_filename, proposal_text_hash, match_results, model_used, input_tokens, output_tokens, estimated_cost_cents) RETURNING id` [:148-165]; `textHash` = sha256 of proposal text [:143].

### Tests
- `tests/unit/expertise-finder-a7.test.js` — prompt module + schema: preamble in cacheable system prompt, `buildUserPrompt` embeds wrapped block with notes outside sentinels, `EXPERTISE_MATCH_SCHEMA` drops injected keys [:10-15, :17-45].
- `tests/unit/expertise-finder-batch-cycle.test.js` — imports page [:11]; `MatchTab handleMatch` posts exact body and reads `results`/`metadata`; error-string fallbacks [:96-160]; roster/batch tabs [:55, :165-221].
- `tests/unit/expertise-finder-error-alert.test.js` — imports page [:43]; ErrorAlert rendering for match/roster/batch failures [:51-70].
- `tests/unit/expertise-roster-form-contact.test.js` — imports `RosterForm` from page [:10]; contact selection behavior [:14].
- `tests/unit/test-request-visibility-census.test.js` — lists `pages/expertise-finder.js` among `BADGE_COMPONENTS` [:67]; not about the match route.
- `tests/unit/utils/public-blob-fetch.test.js:76` source regex.
- No test imports `pages/api/expertise-finder/match.js` directly (grep `expertise-finder/match` over `tests/` → 0 hits).

### A7
- Route: `wrapUntrustedContent` [:93-99]; `validateAiJson` "A7 Part 5" before persistence [:132-140]. Prompt module header "A7 … (Part 5)" [prompts/expertise-finder.js:10-13]; preamble in system block [:82]; user prompt header `## PROPOSAL TEXT (UNTRUSTED…)` [:184].

---

## 6. `pages/api/cron/log-analysis.js` (cron, no page)

### Guard / limits / config
- GET or POST [pages/api/cron/log-analysis.js:34-36]; `verifyCronSecret(req,res)` — dev bypass when `NODE_ENV==='development'`; else constant-time compare of `Authorization` to `Bearer ${CRON_SECRET}`; 500 if secret unset, 401 on mismatch [lib/utils/cron-auth.js:41-61; route :38]. No rate limiter, no `config` export, no `maxDuration`.
- Schedule `0 */6 * * *` [vercel.json:73-74]. Skips (200 `{ok:true, skipped:true}`) if `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` missing, recording a `MaintenanceService` run [:40-50].
- Does NOT call `loadModelOverrides`.

### LLM call
- `new LLMClient({ apiKey:process.env.CLAUDE_API_KEY, model:'claude-haiku-4-5-20251001' (hard-coded concrete id), appName:'cron-log-analysis' })` [:112-116].
- `wrapUntrustedContent({text:errorSummary, source:'cron-log-analysis.errorSummary', dataClass:EXTERNAL_API_TEXT, maxChars:60_000, label:'error log entries'})` [:119-125].
- `complete({ system: buildUntrustedContentPreamble([wrappedErrors.nonce]) (plain string), messages:[{role:'user', content:'You are a server ops assistant. Analyze these N error log entries … Be concise.\n\n' + wrapped}], maxTokens:1024 })` — prompt is route-inline, no `shared/config/prompts` module; no temperature (client default 0.3) [:126-133]. NO `requireAcceptedLlmResponse`. Failure → warn, `analysis='AI analysis unavailable'` [:110, :138-140].
- Only triggered when `errors.length >= ERROR_THRESHOLD(10)` [:30, :84-101]; input limited to first 50 errors [:104-107]; `redactErrorList` before and `redactLogText` after [:74, :137].

### Topology
- Exactly 0 or 1 LLM call per run.

### Streaming
- None. JSON `{ok, errorCount, analysis}` [:166-170]; below threshold `{ok, errorCount, threshold, analysis:null, message}` [:94-100]; Vercel API failure → 502 [:63-67]; catch → 500 [:171-178].

### Inputs
- Vercel REST `GET https://api.vercel.com/v2/projects/{id}/events?limit=100&types=error&since=…` [:56-61]. No file parser, no page.

### Usage logging
- Via `LLMClient appName:'cron-log-analysis'` [:115].

### Outputs / persistence
- `NotificationService.notify({type:'log_analysis', severity, title, message:analysis, metadata:{errorCount, topPaths, sampleErrors}, source:'cron/log-analysis', category:'ops'})` inside `withDalContext('notification-email', …)` [:143-155]; `MaintenanceService.startRun/completeRun('log-analysis')` [:52, :157-164, :173-176].

### Tests
- `tests/unit/notification-trust-model-pushup.test.js` — requires handler [:273]; "site 18" test feeds 50 fake Vercel error events, asserts `res.body.errorCount===50` and that `notify` was entered under trusted `notification-email` context with `{type:'log_analysis', source:'cron/log-analysis'}` [:828-848].

### A7
- Comment "A7 Part 6" + nonce-bearing preamble in `system` [:117-127]; gate registry `cron-log-analysis` inv 24 route-local [check-prompt-injection-tagging.js:325-329].

---

## Executor facts (`lib/services/execute-prompt.js`, `lib/services/prompt-store.js`, migrated route, seed, plan)

### `executePrompt` signature
- Exported params with defaults: `{ promptName, requestId=null, overrideVariables={}, runSource, forceOverwrite=false, actingUserSystemId=null, maxTokensOverride=null, timeoutMsOverride=null, deadlineMs=null, minimumEffectiveMaxTokensExclusive=null, semanticAttempt=1, retryOfRunId=null, assertSystemIncludes=null, promptSnapshot=null, requireNoPersistence=false, allowedProviders=['anthropic'], signal=null, auditRetention=undefined }` [lib/services/execute-prompt.js:93-112]; JSDoc type block [:69-92].
- Required: `promptName`, `runSource` ∈ `RUN_SOURCE` keys `'PowerAutomate Auto' | 'Vercel User' | 'Vercel Test' | 'Vercel Interactive' | 'PowerAutomate Test' | 'PowerAutomate Manual'` [:113-117, :55-62]. `requestId` must be a GUID when non-null [:151-153].
- Entire body runs inside `withDalContext('execute-prompt', …)` [:155].
- Returns `{ parsed, runId, cacheHit, blocked:false, conflicts:[], writeResults, usage (snake_case), usageComplete, meta:{promptName, promptVersion, promptId, modelUsed, provider, systemChars, bodyChars, aiPayloadBoundaries, droppedOutputPaths, rawOutputRetention, semanticAttempt, retryOfRunId} }` [:285-299, :312-320]; preflight-blocked returns `{parsed:null, runId, blocked:true, conflicts, writeResults:null}` [:221-233]. Errors are rethrown with `err.usage`, `err.modelUsed`, `err.provider`, `err.usageComplete`, `err.paidCall`, `err.runId` attached [:350-373].

### Steps
- Step 1 prompt: `promptSnapshot` (validated) else `fetchCurrentPrompt(promptName)` [:165-171]; model = `resolvePromptModel(promptRow)` → `promptRow.wmkf_ai_model || BASE_CONFIG.CLAUDE.DEFAULT_MODEL` via `resolveModelWithCapabilities` after `loadAvailableModels()`; unknown model or unsupported provider throws [:553-582]. Provider must be in `allowedProviders` [:172-180]. Model is NOT `getModelForApp`/app-key based.
- Step 2: parse `wmkf_ai_promptvariables` (`.variables[]`) and `wmkf_ai_promptoutputschema` (`.outputs[]`, `.parseMode`, `.jsonSchema`, `.validationSchema`, `.rawOutputRetention`, `.generationMode`) [:183-186]. `parseMode` must be `raw|json` [:197-199]; `raw` requires exactly one output [:200-202].
- Step 3 variables: `resolveOne` kinds `override` (value from `overrideVariables[name]` else `source.default`; throws if `required` and undefined; returns `v ?? ''`), `dynamics` (needs `requestRow`), `sharepoint` (needs `requestId`) [:387-421]. `requestRow` is fetched only when `requestId` given [:205].
- Step 3b `applyVariableBoundaries`: a decl with `dataClass`+`maxChars` is capped; with `untrusted:true` it is `wrapUntrustedContent`-wrapped with `deriveStableNonce` and its nonce collected; `untrusted` without cap throws [:1285-1341].
- Step 4 preflight guards on outputs with targets; `needs_review` run row if blocked and `!forceOverwrite` [:218-233].
- Steps 5-6 compose + call: `composeMessages` interpolates `{{var}}` into BOTH `wmkf_ai_systemprompt` and `wmkf_ai_promptbody`; if any untrusted nonces exist, prepends `buildUntrustedContentPreamble()` (no nonces, for cache stability) to system [:584-615]. `assertSystemIncludes` (string or array): each substring must be present in composed `system` else throws before the provider call [:246-256]. `callProvider` builds `new LLMClient({apiKey, model, timeoutMs?})` (NO `appName`, so the internal client never writes `api_usage_log`) [:687-691]; sends `system:[{type:'text', text, cache_control:{type:'ephemeral'}}]`, `messages:[{role:'user', content: body}]` (body is a STRING), `maxTokens` from `wmkf_ai_maxtokens || DEFAULT_MAX_TOKENS` (clamped by `resolveMaxTokensForCall`), `temperature` from `wmkf_ai_temperature ?? SUMMARIZATION_TEMPERATURE`, optional `outputConfig`, optional `signal` [:641-650, :724-740]. No `tools`, no content-block arrays, no images/documents: grep for `image|tools|web_search|streaming` in the file hits only the header "Out of scope … tool-use loops, streaming, Batch API, multi-turn" [:23-24]; contract non-goals "Does not stream", "Does not orchestrate chains", "Does not semantically retry" [docs/EXECUTOR_CONTRACT.md:523-537].
- Step 7 `parseClaudeOutput`: refusal → `claude_output_refused` [:893-899]; `max_tokens` → `claude_output_truncated` [:900-918]; context window → `claude_context_window_exceeded` [:919-925]; any non-`end_turn` → `claude_output_incomplete` [:929-935]. `parseMode:'raw'` returns `{ value: { [outputs[0].name]: text.trim() } }`, throwing `claude_output_empty` if `<20` chars [:938-947] — so with output name `response_text` the caller reads `parsed.response_text` [process-peer-reviews.js:291]. `json` mode: fence regex anchored `^```(json)?…```$`, `JSON.parse` → `claude_output_invalid_json`; `jsonSchema.required` check; optional `validationSchema` via `validateAiJson(..., {collectDroppedPaths:true})` → `claude_output_schema_invalid` [:949-999].
- Step 8 `persistOutputs` for `target.kind:'akoya_request'` (requires `requestId`) [:1016-1034]; `kind:'none'` writes nothing.
- Step 9 `writeRunRow` ALWAYS: success/needs_review [:300-316] and failure [:334-347]. Payload to `wmkf_ai_runs` via `aiRunAdapter.create` (Dataverse `DynamicsService.createRecord`) [:1120-1152; lib/dataverse/adapters/ai-run.js:23-28]: `wmkf_ai_status`, `wmkf_ai_runsource`, `wmkf_ai_model`, `wmkf_ai_Prompt@odata.bind`, `wmkf_ai_promptversion`, `wmkf_ai_Request@odata.bind` ONLY if `requestId` [:1132-1134], `wmkf_ai_promptoverridden/override` (redacted), `wmkf_ai_rawoutput` (≤1MB), `wmkf_ai_notes`.
- `requireNoPersistence=true` only asserts every output has `target.kind==='none'`; it does NOT suppress the run row [:187-195]. `requestId=null` is allowed (title/abstract/field-primer precedent) [:149-150]; `override`-only variables need no request [:391-396].
- Usage logging comment: "No `appName` is passed on purpose: the Executor writes its own wmkf_ai_run audit row, and the driver route … already calls logUsage() — passing appName here would double-count api_usage_log" [:651-657]. Caller must log from `result.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` and `result.meta.modelUsed` [:741-746, :288].
- `promptSnapshot`: a caller-supplied frozen prompt row used instead of `fetchCurrentPrompt`; validated to have matching `wmkf_ai_promptname`, GUID `wmkf_ai_promptid`, integer `wmkf_promptversion ≥1`, concrete (non-tier) `wmkf_ai_model`, string `wmkf_ai_systemprompt` and `wmkf_ai_promptbody` [:166-169, :1388-1407].
- `prompt-store.js`: `fetchCurrentPrompt(promptName) → Promise<row>` delegating to `getCurrentForExecutor` (typed errors on 0/>1 current rows; caller must hold DAL context) [lib/services/prompt-store.js:36-46]; `fetchPromptVersion(promptName, {promptId, version})` [:52-66]; `interpolate(template, vars)` replaces `{{\s*(\w+)\s*}}` with `String(vars[name])`, leaving unresolved slots visible [:74-78].

### Migrated route `pages/api/process-peer-reviews.js`
- Header rationale [:1-6]; imports `executePrompt` + `logUsage` [:11-12]; keeps `requireAppAccess('peer-review-summarizer')`, `nextRateLimiter({max:5})`, `loadModelOverrides()` [:22, :31-39].
- Route-owned A7: wraps each review (`DATA_CLASSES.REVIEW_TEXT`, `PEER_REVIEW_TEXT_MAX_CHARS`), builds `preamble = buildUntrustedContentPreamble(reviewNonces)`, builds `reviewsBlock`, `assertPreambleCoversNonces(preamble, nonces)` [:254-277, :200-211].
- Call 1: `executePrompt({ promptName:'peer-review-summarizer.analyze', overrideVariables:{ review_count, review_count_suffix, reviews_block, a7_preamble }, runSource:'Vercel Interactive', forceOverwrite:true, assertSystemIncludes: reviewNonces })`; text = `analyzeResult.parsed?.response_text || ''` [:280-291]. Call 2 (fallback when questions `<50` chars): same against `'peer-review-summarizer.questions'` without `review_count_suffix` [:363-376].
- Usage: `logPeerReviewUsage(result, userProfileId)` → `logUsage({ appName:'peer-review-summarizer', model: result.meta.modelUsed, inputTokens/outputTokens/cacheCreationTokens/cacheReadTokens from result.usage snake_case, latencyMs:0, status:'success' })` [:213-230, :290, :377].

### Seed format `scripts/seed-peer-review-summarizer-prompts.js`
- Header/usage (`--dry-run | --execute [--only=analyze|questions]`), source of truth `shared/config/prompts/peer-reviewer-dynamics.js`, Phase-0 choices (`parseMode=raw`, `target.kind=none`, variables `placement=user / source=override`) [:1-23].
- Row object fields: `promptName, systemPrompt, body, model (MODEL), temperature:0.3, maxTokens:2500, variables:{variables:[{name, source:{kind:'override', default?}, required, cacheable, placement:'user'}]}, outputSchema:{outputs:[{name:'response_text', type:'string', target:{kind:'none'}}], parseMode:'raw'}, notes` [:66-128].
- Dataverse record mapping: `wmkf_ai_promptname, wmkf_ai_systemprompt, wmkf_ai_promptbody, wmkf_ai_promptvariables (JSON string), wmkf_ai_promptoutputschema (JSON string), wmkf_ai_model, wmkf_ai_temperature, wmkf_ai_maxtokens, wmkf_ai_promptstatus (PUBLISHED), wmkf_ai_iscurrent:true, wmkf_promptversion:1, wmkf_ai_publisheddatetime, wmkf_ai_notes` into entity set `wmkf_ai_prompts` [:52, :204-217]; update-by-name if one current row exists, abort on >1 [:219-233]; uses `enterDynamicsBypassForScript` [:43].
- Templates: `ANALYZE_SYSTEM_PROMPT = '{{a7_preamble}}'`, `ANALYZE_USER_PROMPT_TEMPLATE`, `QUESTIONS_SYSTEM_PROMPT = '{{a7_preamble}}'`, `QUESTIONS_USER_PROMPT_TEMPLATE` [shared/config/prompts/peer-reviewer-dynamics.js:60-104].

### Plan structure `docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md`
- Sections: `Status: IMPLEMENTED + VERIFIED` [:23]; `Post-ship hardening` [:44]; `Review outcome` [:62]; `Goal` [:81]; `Current state [VERIFIED]` [:92]; `Assets already in place` [:115]; `The A7 gap that MUST be closed` [:128]; `Target design` [:142] → `Route` [:144], `Prompt rows (Dataverse writes via the seed script)` [:177]; `Explicitly NOT byte-identical (framing change — accept)` [:193]; `Cutover & rollback` [:204]; `Verification plan` [:211]; `Risks` [:226]; `Open questions — RESOLVED` [:236].
- Cutover/rollback content: keep legacy generators importable; cutover = single route diff + row re-publish; rollback = `git revert` route commit, rows stay published/dormant [:204-209]. Verification: content-parity harness, model/param parity, E2E incl. `wmkf_ai_run` row per call, gates list [:211-224]. Accepted framing change: preamble moves from top of `user` to `system` [:193-202].

---

## Cross-route commonality

### Prompt modules
- `shared/config/prompts/multi-perspective-evaluator.js` — sole consumer `evaluate-multi-perspective.js` (6 builders) [route :20-29].
- `shared/config/prompts/literature-analyzer.js` — sole consumer `analyze-literature.js` (3 builders) [route :13-17].
- `shared/config/prompts/funding-gap-analyzer.js` — consumer `analyze-funding-gap.js` (2 of 3 builders); `createBatchFundingSummaryPrompt` has no consumer in `pages/`/`lib/` (tested only in `part6-prompts-a7.test.js:70`).
- `shared/config/prompts/expertise-finder.js` — TWO consumers: `expertise-finder/match.js` [:22] and `lib/services/expertise-finder/batch-match-service.js` [:29, :151-159] (both direct `LLMClient`; gate registry lists both [check-prompt-injection-tagging.js:234-237]).
- `process-expenses.js` and `cron/log-analysis.js` have route-inline prompts; no shared module.
- All six prompt sources build a single USER string (plus multimodal block where applicable); only `expertise-finder` and `cron/log-analysis` set a `system` (EF: cache_control array [match.js:219]; cron: plain string [log-analysis.js:127]). The Executor always places text in `system` + `body` [execute-prompt.js:735-736].

### Multimodal partition (the Executor cannot express these today)
- PDF `document` content block: `evaluate-multi-perspective.js:660-668` (Stage 1, per page), `analyze-literature.js:226-232` (Stage 1, per paper).
- `image` content block: `process-expenses.js:229-245` (image receipts).
- Executor transport sends `messages:[{role:'user', content: <string>}]` only [execute-prompt.js:736]; no `tools`/images anywhere in the file [:23-24]. Remaining text-only calls: MPE Stages 2.5/3/4, literature synthesis/comparison, funding-gap A/B, expenses PDF path, expertise-finder, cron.

### Streaming protocol variants
- Variant A — SSE frames over `text/plain` + chunked, progress `{progress, message[, stage]}`, ad-hoc `{event,…}` frames (unconsumed by page), terminal `{progress:100, message, results}`, top-level error via `res.status(500).json` after stream: `evaluate-multi-perspective.js` [:92-99, :189-216] and `analyze-literature.js` [:58-61, :170-196]. Pages share an identical reader loop keyed on `progress/message/(stage)/results` [pages/multi-perspective-evaluator.js:679-721; pages/literature-analyzer.js:403-445].
- Variant B — true `text/event-stream`, progress `{message, progress?}`, terminal `{complete:true, results, metadata}`, error frame `{error, complete:true}`: `analyze-funding-gap.js` [:69-80, :476-495]; page keys on `progress/message/complete&&results/error` (error throw swallowed by inner catch) [pages/funding-gap-analyzer.js:56-101].
- Variant C — `text/event-stream` via `writeHead`, typed frames `{type:'progress'|'result'|'error'}` + `data: [DONE]`, `headersSent`-aware error path: `process-expenses.js` [:171-196, :408-431]; page dispatches on `type`, splits on `\n` per chunk [pages/expense-reporter.js:77-107].
- Non-streaming JSON: `expertise-finder/match.js` [:178-190] (page via `requestEnvelope` [pages/expertise-finder.js:197]); `cron/log-analysis.js` [:166-170].
- No route or page uses an `sse-stream.js` helper; all four streaming pages use raw `fetch` + `response.body.getReader()` with an eslint allowlist comment [pages/multi-perspective-evaluator.js:661; pages/literature-analyzer.js:383; pages/funding-gap-analyzer.js:36; pages/expense-reporter.js:63].

### Input parsers
- `fetchPublicBlob(url)` + whole-PDF base64 to the model: `analyze-literature.js:78-84`.
- `fetchPublicBlob` + `splitPdfToPages` (pdf-lib) per-page base64: `evaluate-multi-perspective.js:136-145`.
- `fetchPublicBlob` + `createFileProcessor().processFile` (pdf-parse → text): `analyze-funding-gap.js:88, :102-111`.
- `readUploadedBlobBuffer` (private-aware) + `createFileProcessor` (PDF) or raw image bytes: `process-expenses.js:225, :303-304`.
- `fetchPublicBlob` + direct `pdf-parse`: `expertise-finder/match.js:59-66`.
- No file input: `cron/log-analysis.js` (Vercel events API).
- All five page-driven routes receive uploads from `FileUploaderSimple` → `/api/upload-handler`; only expense-reporter can opt into `access:'private'` [pages/expense-reporter.js:337].

### Model / retry / usage patterns
- `getModelForApp` + `loadModelOverrides` in all five app routes [MPE :89, :560; lit :40, :221, :263; funding :43, :84; expenses :144, :200; EF :45, :48]; cron hard-codes a model and skips overrides [log-analysis.js:114].
- Route-owned fallback-model logic: MPE (after 3 retries, `maxRetries:0` on client) [:558-638]; EF (on any non-refusal error) [:105-112]. Others rely on `LLMClient` default retries with no fallback.
- `requireAcceptedLlmResponse` used by MPE, literature, funding-gap, EF [MPE :581, :618; lit :225, :267, :302; funding :134, :392; EF :218]; NOT used by process-expenses or cron.
- Usage logging via `LLMClient appName`: literature (`'literature-analyzer'`), funding-gap (`'funding-analysis'`), expenses (`'expense-reporter'`), cron (`'cron-log-analysis'`). Manual `logUsage`: MPE (`'multi-perspective-evaluator'`, success only) and EF (`'expertise-finder'`, success + error). Executor path requires the caller to log manually from `result.usage`/`result.meta.modelUsed` (as process-peer-reviews does) [process-peer-reviews.js:213-230].
- Output schema validation via `validateAiJson`: MPE (throws → fallback object) [:52-56], funding-gap extraction (throws) [:158-163], expenses (warn + raw fallback) [:275-279, :356-360], EF (502) [:135-140]. Literature and cron: none. Executor equivalent is the row-level `validationSchema` in `wmkf_ai_promptoutputschema` [execute-prompt.js:983-998].

### A7 placement
- Route-level `wrapUntrustedContent` (nonce passed to prompt/system): funding-gap [:120-130], EF [:93-99] (nonce NOT in preamble), expenses PDF [:321-327] (nonce not in preamble), cron [:119-127] (nonce in system preamble).
- Module-level wrapping of re-fed/derived content: MPE [prompts/multi-perspective-evaluator.js:39-54, :287, :344, :597], literature [prompts/literature-analyzer.js:97, :233], funding-gap API blocks [prompts/funding-gap-analyzer.js:85-103].
- Multimodal preamble-only control: MPE Stage 1 [prompts/multi-perspective-evaluator.js:224], literature Stage 1 [prompts/literature-analyzer.js:31], expenses image path [process-expenses.js:44, :48].
- Executor auto-injects `buildUntrustedContentPreamble()` into `system` only when a variable decl has `untrusted:true` [execute-prompt.js:606-610, :1304-1324]; peer-review instead passes a route-built preamble via `{{a7_preamble}}` and enforces it with `assertSystemIncludes` [process-peer-reviews.js:280-289].

### Tests that module-mock `lib/services/llm-client` and assert against `LLMClient.complete` call shapes
- `tests/unit/multi-perspective-refusal.test.js:9`, `tests/integration/funding-gap-payload-boundary.test.js:57`, `tests/integration/process-expenses-a7.test.js:41`.
- Grep denominators: `grep -rln "evaluate-multi-perspective|analyze-literature|analyze-funding-gap|process-expenses|expertise-finder/match|cron/log-analysis|pages/multi-perspective-evaluator|pages/literature-analyzer|pages/funding-gap-analyzer|pages/expense-reporter|pages/expertise-finder\b|prompts/<each>" tests/` → 13 files, all enumerated above.
