---
title: Memory Deep Audit — Retirement Slice — 2026-11-20
summary: "Sweep Mode B over active memory leaves and wiki/queue pages that name surfaces retired on 2026-11-19."
canonical: false
owner: product-engineering
last_verified: 2026-11-20
---
Status: point-in-time evidence report. Re-run the named checks before relying
on these counts.
Repo baseline: main @ 9518775a2

## Scope

```text
Mode: B (domain truth audit), runbook §7 deep audit, retirement slice.
Domain/change surface: the 2026-11-19 retirements — ten standalone apps
  (APP_SUITE_RETIREMENT entry-point manifest), the standalone Expertise Finder,
  and the transcription pilot.
Claims to verify or falsify: for each in-scope leaf, every claim that touches a
  retired or preserved surface (exists / live / retired / preserved; writer;
  persistence; consumer; dependencies; next steps; Do / Do-not rules), plus a
  leaf-level status verdict (active / closed / stale / superseded).
Authoritative sources expected: runtime source (CodeGraph first), the three
  retirement records' committed receipts (cited as dated evidence for Production
  state), explicit owner decisions in those records.
Durable surfaces in scope: 22 active .claude-memory leaves (list below) and
  5 docs: agent-wiki topics prompt-executor, security-auth, strategy-roadmap,
  submitted-reviews-and-documents; docs/CURRENT_WORK_QUEUE.md.
Excluded surfaces and reason: live Dataverse/Postgres/Vercel/GitHub probes
  (not authorized for a documentation audit; recorded as UNKNOWN + probe);
  non-active leaves (closed/stale/superseded are already history); dated plan
  and audit documents (historical snapshots); claims in in-scope leaves that
  do not touch a retired or preserved surface.
```

Enumeration: active leaves (frontmatter `status: active`) whose body matches,
case-insensitive, the pattern below. The pattern covers every page, route and
prompt module in the retirement manifests, including the shared routes
`/api/process`, `/api/qa`, `/api/refine` and `summarize-v2`.

```text
expertise[ -]finder|expertise-finder|expertise_matches|transcription[ -]pilot|
transcription-pilot|batch[ -]phase[ -]i|batch-phase-i|batch[ -]proposal[ -]summar|
batch-proposal-summaries|phase-i-writeup|phase-ii-writeup|phase ii writeup draft|
phase i writeup draft|phase-i-dynamics|phase i dynamics|multi-perspective|
funding[ -]gap|funding-gap-analyzer|funding analysis|peer-review-summarizer|
summarize peer reviews|process-peer-reviews|grant[ -]reporting|literature[ -]analyzer|
analyze-literature|evaluate-multi-perspective|process-phase-i|/api/process\b|
/api/qa\b|/api/refine\b|summarize-v2|phase-i[.-]summar|proposal-summarizer|
peer-reviewer(-dynamics)?\.js|analyze-funding-gap
```

Denominator: 22 leaves. The routine audit said "eight". That came from a
narrower ad-hoc grep (Finder, pilot, Literature Analyzer and a few routes). The
manifest-derived pattern found 22.

| Group | Leaves |
|---|---|
| A — reporting / AI apps | project-interim-report-automation, project-grant-reporting-rework (routed), project-phase-i-summary-app-winddown, project-new-ai-capabilities, project-literature-analyzer-rework (routed), project-pdf-processing-tiers, project-cache-hit-rate-review, project-vercel-workflow-runs-pinned-to-deployment (routed) |
| B — prompts / Executor | project-peer-review-executor-migration, project-a7-prompt-injection-hardening, project-dynamics-as-prompt-ground-truth, project-prompt-storage-strategy, project-prompt-governance, project-dynamics-ai-writeback, project-system-model |
| C — Dynamics / reviewer / intake | project-reviewer-apps-redesign-direction, project-dynamics-identity-reconciliation, project-institution-foundation-liaison, akoya-temporal-axis-encodings, project-reviewer-finder-proposal-doc-context, project-virus-scanning-it-context, project-intake-portal-institution-match |

Method: three read-only reviewers, one per group, briefed neutrally (classify
every in-scope claim with evidence; falsification query for every negative
claim; exact proposed text). The orchestrating session applied every edit
itself. It re-ran the cited query for most changes to a status or Do/Do-not
(Production receipts, the D60 loader order, the virus-scan and impersonation
runbook rows, tool-prompt-resolver importers, the override store, the A7 count, the
Factory helper importers). Three protective additions were applied on the
reviewers' cited evidence without an independent re-run: the prompt-governance
seed rule (seed `updateRecord` lines were spot-checked), the writeback retention
note, and the cache-leaf R3/R5 notes.

## Retirement shapes (established first; every classification uses these)

| Surface | What retired | What was preserved | Evidence |
|---|---|---|---|
| Ten suite apps (PR #651) | Pages show notices; the thirteen retired API URLs return authenticated 410 stubs | Original pages/routes under `_archived/`; prompt modules and stored rows; `phase-i-dynamics/summarize-service.js`; `grant-reporting/*` services; data | [VERIFIED] `APP_SUITE_RETIREMENT_2026-11-19.md` §Entry-point manifest, §Capability and dependency preservation, §Durable data boundary; each of those thirteen files contains the 410 stub; Production receipt §Production release receipt (merge `ce4bc2618`, READY 2026-11-20 UTC; anonymous probe saw 307) |
| Expertise Finder (PR #650) | Page is a notice; the six APIs were removed (404), not stubbed; 344 history rows deliberately deleted | Shared roster in superuser-only Admin; stored prompt row as reference | [VERIFIED] `EXPERTISE_FINDER_RETIREMENT_2026-11-19.md`; `pages/api/expertise-finder/` absent; `pages/api/admin/expertise-roster.js:15` `requireSuperuser` |
| Transcription pilot | Standalone page only | Engine, Workflow, protected pilot APIs, drain/recovery crons; Meeting Tracker uses the engine | [VERIFIED] `TRANSCRIPTION_PILOT_RETIREMENT_2026-11-19.md` §Interface change and invariants |

Consumer-side check: live code (pages, lib, shared, scripts; `_archived` excluded)
has no caller of the retired API URLs other than the stubs themselves and comments.
Repo search cannot rule out external callers (bookmarks, Power Automate).

## Findings

Leaf verdicts: 22 / 22 classified. 0 demoted. 20 fixed, 2 kept unchanged
except for a pointer (see table). No protective "do not drop/delete" rule was
weakened; three protective omissions were added.

| Leaf | Verdict | STALE claims fixed (summary) |
|---|---|---|
| project-interim-report-automation | fix, keep active | Discovery plumbing pointed at `extract-service.js`; it is in `lookup-grant-service.js` [VERIFIED: extract-service imports neither `sharepoint-buckets` nor `GraphService`]. "Same path Grant Reporting already uses" (route is now 410). Direction anchored on 10-21 instead of the 11-19 retirement. |
| project-grant-reporting-rework (routed) | fix, keep active | "Deployment is a separate step" → Production receipt. Added that extraction/Word export are reference only per the retirement plan. Protective rules unchanged. |
| project-phase-i-summary-app-winddown | fix, keep active | Pointed to the Production receipt. |
| project-new-ai-capabilities | fix, keep active | Compliance Screening: "last checked July 27" → unbuilt [VERIFIED: 0 source hits for compliance.screen/complianceScreen/compliance-screen]; owner priority unconfirmed. |
| project-literature-analyzer-rework (routed) | fix, keep active | "Deployment is a separate step" → Production receipt. |
| project-pdf-processing-tiers | fix, keep active | Core claim: "selected evaluators send full PDFs" via `analyze-literature.js` / `evaluate-multi-perspective.js` — both are 410 stubs. Rewritten: no live full-PDF content-block path found [VERIFIED bounded grep; only Expense Reporter image block]; Executor supports `preprocess: pdf_to_text` only. |
| project-cache-hit-rate-review | fix, keep active | R3 target `/api/qa` and one R5 item target retired routes (moot); `phase-i.summary` has no live caller. Live R5 item `composeScorePrompt` kept. |
| project-vercel-workflow-runs-pinned-to-deployment (routed) | keep active + boundary line | Added that only the pilot page retired; the engine it governs is live. |
| project-peer-review-executor-migration | keep active + pointer | Added the live `assertSystemIncludes` consumer (`pre-site-visit/proposal-core-service.js`) [VERIFIED grep]. |
| project-a7-prompt-injection-hardening | fix | Coverage "27 surfaces" → 32 [VERIFIED gate run]; surface list named retired/removed surfaces as live. Rewritten to point at the gate registry. |
| project-dynamics-as-prompt-ground-truth | fix | Named Expertise Finder as the tool-prompt-resolver consumer; only Expense Reporter remains [VERIFIED: sole route importer `pages/api/process-expenses.js`]. |
| project-prompt-storage-strategy | fix | Called the preserved v1 `summarize-service.js` "summarize-v2"; v2 was the archived route that called `executePrompt`. |
| project-prompt-governance | fix | Seed-importer list incomplete (13 files reference `prompt-seed`). Protective omission added: legacy upsert seeds must not be re-run against rows the retirement preserved. |
| project-dynamics-ai-writeback | fix | Implied existing `updateIfEmpty` route adoption (none); present-tense Grant Reporting payloads. Protective omission added: `wmkf_ai_run` raw output may be the only copy of a Grant Reporting assessment. |
| project-system-model | fix | `execute-prompt.js:215` line ref wrong; "bundled fallback only in legacy resolver" and "per-user tier unbuilt" contradicted by `tool-prompt-resolver.js` and `reviewer-prompt-resolver.js` (override → Dataverse → code fallback [VERIFIED header lines 9-13]). A7 count pointer moved to the gate. |
| project-reviewer-apps-redesign-direction | fix | Current-voice "Grant Reporting / Literature Analyzer remain owner decisions"; "Status-tab removal deployment not verified" → commit `dc3eb5233` is an ancestor of `ce4bc2618` [VERIFIED]. Launcher list left HISTORICAL inside its marked section. |
| project-dynamics-identity-reconciliation | fix | `CREDENTIALS_RUNBOOK.md:202` citation drift. The `/phase-i-dynamics` smoke step is no longer runnable. Protective omission added: Admin Expertise Roster saves require impersonation and never fall back. |
| project-institution-foundation-liaison | fix | "Grant Reporting auto-fill" listed as a live surface. |
| akoya-temporal-axis-encodings | fix | "Test Request Factory" listed as a `meetingDateToCycleCode` caller; the Factory uses `linkedCycleCode` [VERIFIED: no `lib/services/test-requests` importer]. "Preserved verbatim" header no longer true after today's edits. |
| project-reviewer-finder-proposal-doc-context | fix (rewrite in place) | Two-file forward contract and "cutover remains planned" superseded by D60 and built: loader takes `AI Materials/Narrative-Bibliography_` first, then the earlier rules [VERIFIED `load-proposal-service.js`; `f43f2db77` ancestor of `ce4bc2618`]. IA/Field Primer read one of three names (D59). Old intent kept as a labeled "Superseded intent" paragraph. |
| project-virus-scanning-it-context | fix | Pre-flip "before flipping `VIRUS_SCAN_ENABLED=true`" guidance; Production is `true` (runbook). |
| project-intake-portal-institution-match | keep active, wording | Grant Reporting named as an `account` consumer. Build-parked status kept (owner decision). |

Docs reconciled in the same pass (four of the five in-scope docs edited; `security-auth.md` unchanged): `docs/CURRENT_WORK_QUEUE.md` (said both apps
"remain implemented … neither is an authorized retirement"; plus one dated
Finder reference), `docs/agent-wiki/topics/strategy-roadmap.md`,
`prompt-executor.md` (four tool apps → Expense Reporter only; peer-review
route tense), `submitted-reviews-and-documents.md` (Finder deep link),
`docs/SYSTEM_MODEL.md` (the same per-user-tier restatement as the system-model
leaf), and `docs/J27_TRANSITION_REGISTER.md` row J27-065 (excerpt moved with the
rewritten memory text). `security-auth.md`: no contradiction (its pilot
reference is on the preserved engine).

### Tallies (sweep Step 8)

```text
Claims (in-scope, from the three evidence tables): ~95 → VERIFIED-and-AGREE 52 /
  STALE-CONFLICT 31 (all fixed) / HISTORICAL 9 / UNKNOWN 8 (probes below) /
  ASSUMED 1 (the `processingMode` absence in the PDF leaf, not re-grepped)
Restatement hits re-searched after fixes: 12 phrases → 0 live STALE in scope,
  1 UNRELATED collision
Leaves: 22 classified; 20 fixed; 2 unchanged apart from an added pointer; 0 demoted
```

Counts are approximate: they are tallied from the reviewers' per-claim tables
(appendix), where some rows combine claims.

Zero demotions (§9 justification): every leaf still governs action. Eight carry
protective preservation rules for capabilities the retirement kept (Grant
Reporting, Literature Analyzer, Phase I summary, peer-review prompts, the
transcription engine). The rest describe live seams (Executor, prompt
resolvers, cycle encodings, Reviewer Finder loading, impersonation, virus scan)
where only individual claims were stale. Demoting the retirement-boundary leaves
waits on the open owner decision about where the preserved capabilities live next.

## Falsification

| Conclusion | Disconfirming query | Result |
|---|---|---|
| No live in-repo caller of retired APIs | grep the retired URL strings over pages/lib/shared/scripts, `_archived` excluded | stubs + comments only |
| Expense Reporter is the only tool-prompt-resolver route consumer | grep `resolveToolPrompt\|tool-prompt-resolver` in pages/lib/shared | `process-expenses.js`; `prompt-model-resolution.js` mentions it in a comment only |
| Per-user override tier exists for Reviewer Finder | read `reviewer-prompt-resolver.js` header | "per-user override → Dataverse `iscurrent` row → code template" |
| No full-PDF content-block path is live | grep `type:'document'`, `application/pdf` media blocks outside `_archived` | none |
| Compliance Screening unbuilt | grep three spellings in lib/pages/shared | 0 |
| Factory no longer uses meeting-date helpers | grep importers of `meetingDateToCycleCode\|cycleCodeToOdataFilter` | `cycle-code.js` and scripts only |
| A7 surface count | `npm run check:prompt-injection-tagging` | 32, 0 pending |
| Stale phrases gone | re-grep of each fixed phrase over memory, wiki, queue | 0 live hits (one UNRELATED collision on "remain implemented") |

## Fixes applied

One commit on top of `9518775a2`: 22 leaves, the five in-scope docs,
`docs/SYSTEM_MODEL.md` and one J27 register row. No file deleted; no status
demoted. `check:memory-health` 18 → 17 flagged (the peer-review leaf's
shadow-atlas flag cleared by a real source pointer).

## Unknowns & owner decisions

Claim not reconciled outside the slice (queued, named):

- **D60 single-file Reviewer Finder input.** These still describe the superseded
  two-file plan: `.claude-memory/project-j27-doc-capture-evolution.md:52`,
  `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md:197` and
  `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:373-376`, all excerpted by
  register row J27-065. The J27 log's D59/D60 "built on the J27 line (not
  promoted)" is also out of date (`f43f2db77` is in Production).
- Other out-of-slice stale restatements found by reviewers:
  - `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md:97,108` (use `/phase-i-dynamics`)
  - `docs/PROMPT_CACHING_AUDIT.md:37,88-90,197-199` (retired targets)
  - `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md:237,265` (wire retired `extract.js`)
  - `docs/CLOSEABLE_CLASS_INVARIANT_MAP.md` (A7 count 27; gate says 32)

In-scope residue found on review and fixed in a follow-up commit: the
`strategy-roadmap.md` labels for the Phase I and new-AI-capabilities leaves;
`prompt-executor.md` "the 14 rows" (13 live-manifest rows plus the archived
Expertise Finder row, verified from `TOOL_PROMPT_ROWS`) and plural tool-app
wording; the reviewer-apps leaf's dangling "S206 decisions block above" pointer;
"per-user Postgres override" corrected to Dataverse user preferences
(`lib/services/dataverse-prefs-service.js`: Postgres `user_preferences` dropped
2026-05-12) in the system-model leaf and `docs/SYSTEM_MODEL.md`; virus-scan leaf
now states the three-workstream shipment is UNKNOWN.

Probes — run 2026-11-20 with the owner's approval (signed-in browser on
`applications.wmkeck.org`, read-only GETs; two owner-approved read-only
production scripts; local `gh`/Colima):

- Thirteen retired API URLs: GET 405, empty POST 410 `APP_RETIRED`, all thirteen.
- Retired-interface prompt rows: Admin prompts API (50 rows, 49 current). All 19
  rows for the retired interfaces (`peer-review-summarizer.*`, `phase-ii.*`,
  `phase-i.summary`, `multi-perspective.*`, `funding-gap.*`,
  `literature-analyzer.*`, `expertise-finder.match`) are current, Published
  (682090001), version 1. No `writeup.*` rows.
- Combined `Narrative-Bibliography_` file: absent on all four J27 test requests
  (Workbench documents listing). Real J27 proposals have not arrived; still open.
- Workbench Status tab: absent on a D26 request page (10 tabs as in source). The
  J27 request page uses the phase layout.
- Virus-scan workstreams: PARTIAL by source trace. The alert and the 422 with
  file names ship; no in-repo client calls the reviewer-portal upload API; the staff
  upload client was not traced.
- Cache cross-document read: confirmed once for `review-synthesis.generate`
  (2026-09-22). No `cycle-dossier.entry` runs since the fix, so that check is still open.
- `wmkf__ai_summary` field: gone (metadata read, no `wmkf__` attributes).
- Admin prompt edit validation: hazard still open by source. Sentinel markers are
  rejected; dropping `untrusted: true` declarations is not checked.
- Routine-audit items: Colima running, ledger container exited; repository PUBLIC
  with CodeQL default setup configured.

Owner questions:

- Compliance Screening priority.
- The reuse destinations for the preserved Grant Reporting and Literature Analyzer capabilities. Existing open decision; no demotion proposed until it is made.

## Metrics row

Appended to `docs/MEMORY_HYGIENE_RUNBOOK.md` §18.

## Verdict

RECONCILED WITH EXPLICIT UNKNOWNS for the 22-leaf slice and its five in-scope docs.
CLAIM NOT RECONCILED for the D60 single-file input outside the slice (queued above).

## Appendix — per-leaf evidence (AGREE / HISTORICAL / negative claims)

Condensed from the three reviewers' tables. STALE rows are in Findings above.

**Group A**
- interim-report-automation: `compareProposalToReport` exported (`extract-service.js`) AGREE; "interim evaluation not built" — grep `interim_eval|interimeval` → 0, AGREE; Field Set B deployed 2026-05-07 per `DYNAMICS_AI_FIELDS_SPEC_v3_cn.md:237,265` AGREE (doc-cited); old Grant Reporting UI idea HISTORICAL (marked "dated design idea").
- grant-reporting-rework: notice page + 410 routes + `_archived` copies AGREE; extraction does not save to `akoya_request` (`extract-service.js:24-30,513-515`) AGREE; "`classify-file` still imported by Workbench" — importer `load-proposal-service.js:36` AGREE; preserve-everything rule AGREE (retirement §Durable data boundary).
- phase-i-summary-app-winddown: four upload apps + Phase I Dynamics `deprecated` in `appRegistry.js` AGREE; "no live invoker of `phase-i.summary`" — grep outside `_archived` finds config, seeds and the gate list only, AGREE.
- new-ai-capabilities: Finder retirement live, Admin roster live AGREE; "`modules/expertise_matching` not production" — only `scripts/seed-expertise-roster.js` imports it, AGREE; "Connor's replacement flow not live" AGREE.
- literature-analyzer-rework: page/route retired, archived copies exist, rows retained AGREE; "scholarly search still live" — `reviewer-finder/discover.js`, `enrich-contacts.js`, `cycle-dossier-generation.js` import PubMed/OpenAlex services, AGREE.
- pdf-processing-tiers: Reviewer Finder text path and IA `proposal_text` override AGREE; historical rationale HISTORICAL; `processingMode` absence ASSUMED.
- cache-hit-rate-review: R4 preamble without nonces (`execute-prompt.js`) AGREE; Executor does not write `api_usage_log` AGREE; Review Panel successor live AGREE.
- vercel-workflow-runs: `recoverTerminalTranscriptionWorkflowDispatch` in `store.js`, called from `workflow-dispatch.js`; `/api/cron/drain-transcriptions?recovery=1` in `vercel.json` AGREE; S586 narrative HISTORICAL.

**Group B**
- peer-review-executor-migration: 410 stub, archived route, live `review-synthesis.generate`, commits `1559e8dc`/`4dd5c84b` exist, A7 contract in archived route + `execute-prompt.js` AGREE.
- a7-prompt-injection-hardening: three `*-a7.test.js` files AGREE; "not in GitHub CI" — no prompt-injection step in `.github/workflows/test.yml`, AGREE.
- dynamics-as-prompt-ground-truth: principle, naming convention, `overridePromptBody` not built AGREE/UNRELATED.
- prompt-storage-strategy: v2 route is a 410 stub; Executor and rows not removed AGREE; historical v2 Executor import AGREE.
- prompt-governance: Tier 2 per-user override via `prompt-override.js` → `setUserPreference` (Dataverse-backed) AGREE; dated metadata (39 rows) UNKNOWN current.
- dynamics-ai-writeback: lookup-grant 410; no Field Set B save path AGREE; "no route calls `updateIfEmpty`" — grep finds definitions and one comment only, AGREE.
- system-model: retired examples + preserved infrastructure AGREE; ~12 live `executePrompt` service consumers AGREE.

**Group C**
- reviewer-apps-redesign-direction: 10 Workbench tabs (`pages/workbench/[requestId].js` `TABS`) AGREE; "`writeup.*` rows absent" — grep outside `_archived` → 0, AGREE (source only; live rows UNKNOWN); "Reviewer Pool not shipped" — only an entity description hit, AGREE; "do not propose Finder/Manager cleanup" AGREE (consolidated, not retired); launcher and Tools-menu lists HISTORICAL.
- dynamics-identity-reconciliation: ground-truth files exist AGREE; impersonation rollout lines HISTORICAL.
- institution-foundation-liaison: `request-liaison.js` exists; PI resolver returns `no_project_leader` (`proposal-pi-identity.js`) AGREE.
- akoya-temporal-axis-encodings: Finder link-filter and `conventionalCycles` caller notes AGREE; Reviewer Finder `linkedCycleFilter` users AGREE.
- reviewer-finder-proposal-doc-context: protective "do not reintroduce `classifyFile` selection" AGREE; 2026-06 diagnosis HISTORICAL.
- virus-scanning-it-context: no DFT-recipient path (owner decision) AGREE; 2026-05-26 quote HISTORICAL.
- intake-portal-institution-match: "typeahead/dedup not built" — grep `typeahead|did you mean|akoya_aka` in intake surfaces → 0; `account.js` exports three readers only, AGREE.
