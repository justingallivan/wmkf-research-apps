---
title: "AI Prompt Legacy Audit — Redundant Extraction & Promise-Gaps"
domain: prompts
kind: audit
status: draft
summary: "Per-prompt eval of the wmkf_ai_prompt corpus: which asks are now Dataverse-authoritative (redundant/crash-risk) and which prompts have promise-gaps."
canonical: false
cataloged: 2026-07-07
owner: product-engineering
related:
  - docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md
  - docs/atlas/dataverse-akoya-request.md
  - shared/config/prompts/reviewer-finder.js
  - lib/services/reviewer-prompt-composer.js
  - lib/services/execute-prompt.js
  - lib/services/prompt-store.js
---

# AI Prompt Legacy Audit — Redundant Extraction & Promise-Gaps

**Task:** S343 owner ask. Evaluate every AI prompt on two axes — (1) *doing too much*
(extracting/inferring admin facts Dataverse now owns authoritatively) and (2) *delivering
on its promise* (right questions, output consumed, no gaps). Read-only; no prompt/code/data
was changed. The canonical precedent is `reviewer-finder.analyze`
(`docs/REVIEWER_ANALYZE_PROMPT_METADATA_ISSUE.md`), which already went through this exact
slimming.

## Method & sources

- **Live bodies [VERIFIED via probe]:** listed and dumped all 14 current `wmkf_ai_prompts`
  rows (`wmkf_ai_iscurrent eq true`) via OAuth + GET, 2026-07-07 — scratchpad
  `probe-list-prompts.js` → `scratchpad/live-prompts/*.txt`. These are authoritative for
  what is *published*.
- **Code baselines [VERIFIED via file]:** the `shared/config/prompts/*.js` corpus (23 `.js`
  files) read.
- **Ground truth [VERIFIED via file]:** `docs/atlas/dataverse-akoya-request.md` field
  inventory + `docs/APPLICATION_STATE_ATLAS.md`.
- **Resolution model [VERIFIED via file]:** per-user override → Dataverse `iscurrent` row
  → in-repo fallback (`lib/services/reviewer-prompt-resolver.js` for reviewer-finder;
  `lib/services/prompt-store.js` + `lib/services/execute-prompt.js` for Executor prompts).

**The central finding is narrower than the ask implies.** The "prompt re-derives Dataverse
metadata" problem is a *Dataverse-native-entry-path* problem: it only bites when the app has
a `requestId`/`requestGuid` bound to the run (so ground truth is fetchable) yet the prompt
still infers admin fields from the PDF. Almost every Dataverse-native prompt in the live
corpus has **already** been slimmed or was authored correctly. The remaining bloat lives in
the **PDF-upload apps**, which today have *no* request binding, so their extraction is
currently *necessary*, not redundant — the redundancy is latent and only realizes if/when
those apps get a Dataverse-native entry path (the re-scope opportunity).

---

## Live corpus (14 current `wmkf_ai_prompt` rows) [VERIFIED via probe]

| # | name | v | modified | body/sys chars |
|---|---|---|---|---|
| 1 | executor.echo-parity | 1 | 2026-05-22 | 57 / 6850 |
| 2 | field-primer.generate | 1 | 2026-06-13 | 214 / 3342 |
| 3 | grantee-abstract.generate | 2 | 2026-06-22 | 247 / 2327 |
| 4 | grantee-title.generate | 1 | 2026-06-20 | 99 / 2305 |
| 5 | peer-review-summarizer.analyze | 1 | 2026-05-22 | 1827 / 0 |
| 6 | peer-review-summarizer.questions | 1 | 2026-05-22 | 669 / 0 |
| 7 | phase-i.summary | 1 | 2026-05-22 | 258 / 6634 |
| 8 | phase-ii.extract-structured | 1 | 2026-05-22 | 1160 / 0 |
| 9 | phase-ii.qa | 1 | 2026-05-22 | 809 / 0 |
| 10 | phase-ii.refine | 1 | 2026-05-22 | 854 / 0 |
| 11 | phase-ii.summarize | 1 | 2026-05-22 | 4430 / 0 |
| 12 | review-synthesis.generate | 1 | 2026-07-04 | 172 / 1931 |
| 13 | reviewer-finder.analyze | **2** | **2026-07-08** | 3598 / 0 |
| 14 | reviewer-finder.score-candidates | 1 | 2026-06-06 | 1252 / 0 |

Plus code-only prompt generators not (yet) in the live table — they run inline in their
routes rather than via the Executor: `proposal-summarizer.js` (the *live* Phase II / batch
summarizer path), `phase-i-summaries.js`, `phase-i-writeup.js`, `multi-perspective-evaluator.js`,
`expertise-finder.js`, `virtual-review-panel.js`, `funding-gap-analyzer.js`,
`literature-analyzer.js`, `integrity-screener.js`, `email-reviewer.js`,
`grant-reporting.js`, `dynamics-explorer.js`. These are audited below too.

---

## Per-prompt evaluation

Legend for "entry mode": **DV-native** = run is bound to an `akoya_request` (requestId/Guid),
so ground truth is fetchable → redundant extraction is *fixable now*. **Upload** = PDF-upload
tool with no request binding → extraction currently *necessary*; redundancy is latent.

### Dataverse-native / Executor prompts (ground truth fetchable)

| name | purpose | doing too much? (Dataverse-authoritative asks) | already handled by runtime composer? | asking the right questions? (gaps/misfires) | recommendation |
|---|---|---|---|---|---|
| **reviewer-finder.analyze** (live v2) | Extract scientific search context + suggest reviewers | **No (already fixed).** Body PART 1 explicitly says "Dataverse has already supplied the administrative request metadata. Do not infer TITLE, PRINCIPAL_INVESTIGATOR, CO_INVESTIGATORS, AUTHOR_INSTITUTION, or ABSTRACT." Program area omitted entirely. | **Yes** — `composeAnalyzePrompt()` + `slimAnalyzeBodyForTrustedMetadata()` (`lib/services/reviewer-prompt-composer.js:40,114`) prepend a trusted-metadata block and slim; `reviewer-request-context.js` sources title/PI/co-PIs/institution/abstract from `akoya_request`. | Well-scoped. Suggestion criteria (active-in-area, western name order, no COI mention) are sound. | **Leave.** Canonical precedent, shipped. |
| **reviewer-finder.score-candidates** | Judge relevance of DB-found candidates to proposal | No. Takes `{{proposal_summary}}` + `{{candidates_list}}`; no admin extraction. | N/A (no metadata to slim). | Fine; strict relevance + seniority is exactly its job. | **Leave.** |
| **phase-i.summary** (Executor, `summarize-v2`, `requestGuid`) | 1-para summary + 4 bullets (impact, funding justification, basic/applied, Keck alignment) | **No.** Genuinely analytical bullets. Explicitly instructs "Do not include investigator names or institutional affiliations in the paragraph(s)" — so it deliberately avoids admin metadata. Budget dollar figures it cites are report-derived analysis, not `akoya_request` fields. | N/A — nothing to slim. | Good. The Keck-guidelines block is prepended from `KECK_GUIDELINES`. | **Leave.** |
| **grantee-abstract.generate** (Executor) | Rewrite applicant abstract into house style | No. Input `{{source_abstract}}` is *sourced from* `wmkf_abstract` by `grantee-abstract-service.js` — this is the correct direction (DV → prompt), not extraction. | Correct by construction. | Good; tense/person/structure rules are precise. | **Leave.** |
| **grantee-title.generate** (Executor) | One-line board objective from title+abstract | No. `{{source_title}}`/`{{source_abstract}}` sourced from `akoya_title` + `wmkf_abstract`. | Correct by construction. | Good. | **Leave.** |
| **field-primer.generate** (Executor, requestId mode) | Field orientation primer for staff (not proposal eval) | No. Takes `{{proposal_text}}`; output is field structure + named experts — analysis, not admin metadata. | N/A. | Good; naming-uncertainty caveats are strong. | **Leave.** |
| **review-synthesis.generate** (Executor) | Synthesize submitted peer reviews | No. Reads `{{reviews_digest}}`; no `akoya_request` fields involved. | N/A. | Good; consensus/disagreement/concern shape matches `wmkf_reviewsynthesisjson` consumer. | **Leave.** |
| **grant-reporting** (`createGrantReportExtractionPrompt`, code, `lookup-grant` requestNumber) | Extract grant-report fields → Field Set B | **Partially, but already mitigated.** Header (title, PIs, award_amount, project_period, subject_area) *is* passed as a trusted `headerFromDynamics` block that the prompt is told to copy verbatim and never override from the untrusted report. Counts/narratives/publications are genuinely report-derived (not on `akoya_request`). | **Yes** — trusted header block already implemented (`grant-reporting.js:createGrantReportExtractionPrompt`, `dynamicsBlock`). | Well-scoped; `[DRAFT —]` prefix on staff-judgment field is a nice guard. | **Leave** (already follows the pattern). |
| **executor.echo-parity** (Executor test oracle) | Byte-parity smoke test for the two executors | No — echoes inputs. | N/A. | Fine (it is a test fixture). | **Leave.** |

### PDF-upload prompts (no request binding today → redundancy is latent)

| name | purpose | doing too much? (Dataverse-authoritative asks) | already handled? | asking the right questions? (gaps/misfires) | recommendation |
|---|---|---|---|---|---|
| **phase-ii.extract-structured** (live row; parallels live `proposal-summarizer.createStructuredDataExtractionPrompt`) | JSON extract: institution, city_state, project_title, PI, investigators, research_area, methods, funding_amount, invited_amount, total_project_cost, meeting_date, duration, keywords | **Yes — the single biggest latent redundancy.** Fields map directly to `akoya_request`: project_title→`akoya_title`; principal_investigator→`wmkf_projectleader`; investigators→`wmkf_apprequestperson`/`wmkf_copi1..5`; institution→`akoya_applicantid`(→account); funding_amount/invited_amount/total_project_cost→`akoya_request`/`akoya_loirequestedamount`/`akoya_originalgrantamount`; meeting_date→`wmkf_meetingdate`; duration→`akoya_begindate`/`akoya_enddate` [all VERIFIED via atlas]. **Unreliable in practice:** `process.js` runs a post-hoc "fix PI name from `<u>` tags" cross-reference because the extraction gets PI wrong (`pages/api/process.js:237-267`) — direct evidence for the owner's thesis. Also instructs the model to guess institution from the *filename*. | No — upload path, no requestId to look up. | Fine for its display purpose; the accuracy problem is inherent to inferring vs looking up. | **Re-scope:** give Phase II / batch summarizer a Dataverse-native entry path (requestId, as reviewer-finder got), then slim these admin fields to a trusted block. Until then, **leave** (no ground truth available at runtime). |
| **phase-ii.summarize** (live row; live path = `proposal-summarizer.createSummarizationPrompt`) | Two-part writeup (grade-13 summary + technical), incl. Personnel section naming PI/co-Is w/ title+institution | **Latent yes** for the Personnel block (PI/co-I names, titles, institutions = `wmkf_projectleader`/junction/`akoya_applicantid`), but here the names are *content the writeup renders*, not a controlled-field write — low crash risk. | No. | Strong prompt overall (tone rules, jargon control). Personnel-from-PDF is the only weak spot. | **Re-scope w/ Phase II** (feed trusted personnel), else **leave.** |
| **phase-ii.qa** (live) | Streaming Q&A over one proposal + summary, web-search enabled | No admin extraction. | N/A. | Good. | **Leave.** |
| **phase-ii.refine** (live) | Refine a writeup per user feedback | No. | N/A. | Good. | **Leave.** |
| **proposal-summarizer.js** (code; the LIVE Phase II & batch path — `process.js`, `qa.js`, `refine.js`) | Same four generators as `phase-ii.*` above; this is what actually runs today | Same as `phase-ii.extract-structured` — the extraction generator is the live offender. | No. | The live `phase-ii-dynamics.js`/`peer-reviewer-dynamics.js` rows are documented as **dormant Phase-0 storage**; the function generators here are what ship. | **Re-scope** (as above). Note the code/row split (see Drift). |
| **multi-perspective-evaluator.js** (`createInitialAnalysisPrompt`, code, upload) | Eligibility screen + concept analysis for the multi-perspective evaluator | **Latent:** extracts `piName`, `institution`, `title` (→ `akoya_request`). But these are used only to seed downstream search/perspective prompts, not written back. Eligibility flag + searchQueries are the real value. | No. | The eligibility check against Keck exclusions is a genuine, well-designed ask. | **Leave** (upload concept tool; extraction is light and unwritten). Slim only if it gains a requestId path. |
| **expertise-finder.js** (`buildUserPrompt`, code, upload) | Match proposal to internal staff/consultant/board roster | **Latent:** output JSON includes `title`/`institution`/`pi_name` (→ `akoya_request`). Roster-matching is the real job. | No. | Good matching principles (depth-over-breadth, flag gaps). | **Leave**; slim the echoed metadata if a DV-native path is added. |
| **virtual-review-panel.js** (`createClaimExtractionPrompt` + stages, code, upload, Postgres) | Multi-stage panel simulation from PDF | **Latent:** claim-extraction pulls PI/co-PI names + institutions for search disambiguation. That disambiguation need is real, but the names are `akoya_request`-authoritative when bound. | No. | The disambiguation rationale (common names like "Li Wang") is sound. | **Leave** (upload/Postgres tool). Re-scope only alongside a DV entry path. |
| **funding-gap-analyzer.js** (`createFundingExtractionPrompt`, code, upload) | Extract PI/institution/state → query NSF/NIH/USAspending | **Latent:** PI, institution, state (→ `akoya_request` + account). But the app is explicitly a lookup keyed on those, and it *infers state from institution knowledge* (analytical). | No. | Fine for its federal-funding-gap purpose. | **Leave.** |
| **phase-i-writeup.js** (`createPhaseIWriteupPrompt`, code, legacy upload) | Older single-writeup path w/ heavy institution-name-validation rules | **Latent + notable:** an entire block forces the model to extract and *not abbreviate* the institution name (`phase-i-writeup.js:40-62`) — the exact fragile inference `akoya_applicantid` would make trivial. PI extraction too. | No. | The anti-abbreviation gymnastics are a smell: this is a lookup masquerading as extraction. | **Re-scope/retire** — confirm whether `phase-i-writeup` is still a live surface; if so, bind requestId and delete the institution-validation block. Superseded in spirit by `phase-i.summary` (Executor). |
| **phase-i-summaries.js** (`createPhaseISummarizationPrompt`, code) | Batch Phase I summary (same 4-bullet shape as live `phase-i.summary`) | No — like `phase-i.summary`, explicitly excludes names/affiliations from prose. | N/A. | Good. | **Leave** (consider consolidating with the Executor `phase-i.summary` row to avoid two copies). |
| **peer-review-summarizer.analyze** / **.questions** (live rows; live path = `peer-reviewer.js`) | Summarize submitted peer-review docs; extract questions | No `akoya_request` extraction. It *does* ask the model to read reviewer names/affiliations off the review docs — but those are the review documents, not proposal admin metadata. | N/A. | Good. Note: `peer-reviewer.js` also defines `createThemeSynthesisPrompt` + `createActionItemsPrompt` that are **dead code** (never imported — confirmed in `peer-reviewer-dynamics.js` header). | **Leave** the two live prompts; **retire** the two dead generators. |
| **integrity-screener.js** (code, Haiku) | Screen PubPeer/news for a named applicant | No. Takes `name` + `institution` as *structured inputs* (already resolved upstream) — the correct pattern. | N/A. | Well-scoped; name-commonality caution is good. | **Leave.** |
| **email-reviewer.js** (`createPersonalizationPrompt`, code) | Personalize a reviewer invite | No extraction; consumes candidate + proposal title/PI as untrusted context. | N/A. | Fine. | **Leave.** |
| **literature-analyzer.js** (code) | Analyze uploaded papers (not proposals) | No proposal-admin overlap (paper abstracts are the papers'). | N/A. | Fine. | **Leave.** |
| **dynamics-explorer.js** (code) | NL→Dataverse query tool (read-only) | No — it *queries* Dataverse, doesn't infer it. | N/A. | Fine. | **Leave.** |

---

## Prioritized recommendations

### Slim/re-scope first (biggest redundancy; extraction demonstrably unreliable)
1. **Phase II / batch-proposal-summaries extraction** — `phase-ii.extract-structured` (live row)
   and the live `proposal-summarizer.createStructuredDataExtractionPrompt`. Highest-value target:
   it re-derives ~8 `akoya_request`-authoritative fields, the app already runs a corrective
   PI-name cross-reference (proof it's unreliable), and it guesses institution from the filename.
   *Fix shape:* mirror the reviewer-finder refactor — add a requestId entry path, source
   title/PI/co-PIs/institution/amounts/dates/meeting-date from `akoya_request`, and slim the
   prompt to scientific/writeup context. **Precondition:** the entry-path work; without a
   requestId there is no ground truth to substitute.
2. **`phase-i-writeup.js` institution-validation block** — confirm live status; the
   anti-abbreviation instruction block is a lookup pretending to be inference. Bind requestId
   (or route users to the Executor `phase-i.summary` path) and delete the block.

### Crash-risk note (the specific production failure class)
The reviewer-finder crash (`wmkf_programarea` 100-char field overflow from LLM free text) was
the one place extracted free text flowed into a *controlled Dataverse field*. **That is fixed**
(`normalizeSuggestionProgramArea`, see the precedent doc). For the extraction consumers I
traced this session — reviewer-finder (`save-candidates.js`), grant-reporting (trusted
`headerFromDynamics`), and Phase II batch (`pages/api/process.js`, which renders the extraction
to display/JSON rather than writing it to `akoya_request`) — no *other* LLM-extracted admin
free-text reaches a length-capped controlled `akoya_request` field. So the crash class appears
contained and the remaining work is redundancy/reliability/token cost. **[VERIFIED via file for
those three consumers; ASSUMED for write paths I did not exhaustively trace — a full
extraction-consumer write-path audit is the confirming follow-up.]**

### Promise-gaps (axis 2) worth a look
- **Dead prompt generators:** `peer-reviewer.js::createThemeSynthesisPrompt` and
  `createActionItemsPrompt` are defined but never imported — retire or wire up.
- **Two Phase-I copies:** `phase-i.summary` (Executor row) and `phase-i-summaries.js` (code)
  carry the same 4-bullet contract — a consolidation/drift risk, not a bug.
- No prompt was found asking materially *too little* for its stated purpose; the corpus's
  problem is over-asking (inference of owned facts), not under-asking.

### Fine as-is (leave)
All Executor/Dataverse-native rows except the Phase II set: `reviewer-finder.analyze` (done),
`reviewer-finder.score-candidates`, `phase-i.summary`, `grantee-abstract`, `grantee-title`,
`field-primer`, `review-synthesis`, `grant-reporting` (already uses trusted header),
`executor.echo-parity`, `integrity-screener`, `dynamics-explorer`, `email-reviewer`,
`literature-analyzer`, `phase-ii.qa`, `phase-ii.refine`, `peer-review-summarizer.*`.

---

## Caveats & drift

- **[VERIFIED via probe] `reviewer-finder.analyze` live = v2 (2026-07-08), fully slimmed.**
  **Code drift:** the code baseline `shared/config/prompts/reviewer-finder.js`
  `createAnalysisPrompt` still contains the *legacy* full "PART 1: PROPOSAL METADATA"
  extraction (TITLE/PROGRAM_AREA/PRINCIPAL_INVESTIGATOR/CO_INVESTIGATORS/AUTHOR_INSTITUTION).
  That generator is now **test-only** (`tests/unit/reviewer-finder-a7.test.js`); the live
  path uses the slimmed `reviewer-finder-dynamics.js::ANALYZE_USER_PROMPT_TEMPLATE` +
  `composeAnalyzePrompt` slimming. The `reviewer-prompt-resolver.js` comment claims the
  fallback is "byte-in-sync with the code generators in reviewer-finder.js" but it actually
  imports the slimmed `-dynamics` body — the comment is stale. Prefer live/`-dynamics`; treat
  `reviewer-finder.js::createAnalysisPrompt` as legacy.
- **[VERIFIED via file] Phase II / peer-review live path is the code generators, not the rows.**
  `phase-ii-dynamics.js` and `peer-reviewer-dynamics.js` self-document as **dormant Phase-0
  storage**; the live routes (`process.js`, `qa.js`, `refine.js`, `process-peer-reviews.js`)
  import the function generators in `proposal-summarizer.js` / `peer-reviewer.js`. So the live
  `wmkf_ai_prompt` rows for `phase-ii.*` and `peer-review-summarizer.*` are **viewable/editable
  in the admin panel but not yet the execution source** — editing them there won't change
  behavior until the routes migrate to `executePrompt()`. Flag for the owner: the admin panel
  shows prompts that don't (yet) drive those two apps.
- **[ASSUMED] Live status of `phase-i-writeup` and the legacy `phase-i-summaries` batch path.**
  I did not trace their current UI entry points end-to-end; the re-scope/retire recommendation
  for `phase-i-writeup.js` is contingent on confirming it's still user-reachable.
- **[VERIFIED via atlas] Program area must be read from `akoya_programid` (GUID-keyed), never
  `wmkf_grantprogram`** (4,634 nulls) — relevant if any slimming sources program area.
- **[VERIFIED via file] No admin-panel writes were performed.** Probe did OAuth POST + GETs only.
- The 12 code-only prompt files were audited from source, not from a live row (they have no
  `wmkf_ai_prompt` row) — their "live" body *is* the code, so no drift axis applies to them.
