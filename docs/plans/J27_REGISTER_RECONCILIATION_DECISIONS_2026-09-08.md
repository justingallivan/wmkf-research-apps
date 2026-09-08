# J27 Register Reconciliation Decisions (2026-09-08)

Per-file decision matrix for the per-site reconciliation (plan §3). One line
per cited file, in the order the agent reached it.

## Slice A

| register id | file | case | fragment or note | reason |
|---|---|---|---|---|
| J27-007 | `shared/config/appRegistry.js` | A | `// Concept Evaluator deprecated 2026-04-25 (Session 110).` | Deprecation comment still present verbatim at :9; row's fact (Concept Evaluator deprecated, archived) is directly stated here. |
| J27-007 | `shared/config/baseConfig.js` | A | `'concept-evaluator' deprecated 2026-04-25 (archived to /_archived).` | Same deprecation fact restated as a model-config comment at :24. |
| J27-007 | `_archived/pages/concept-evaluator.js` | A | `function ConceptEvaluator()` | Confirms the archived page still exists and is the Concept Evaluator component; the row's excerpt `APP_LIFECYCLE_REGISTRY['concept-evaluator']` was not verbatim (the real syntax is a `'concept-evaluator': {` key, already bound to appRegistry.js), so this file gets its own verbatim fragment instead. |
| J27-008 | `pages/multi-perspective-evaluator.js` | A | `Evaluate research concepts from multiple AI perspectives` | Row's exact description string is verbatim at :1000. |
| J27-008 | `pages/api/evaluate-multi-perspective.js` | A | `Multi-Perspective Concept Evaluator API Endpoint` | The `categories`/description fragments don't appear here; this file's own header docblock carries the same "still-active app" fact. |
| J27-008 | `shared/config/prompts/multi-perspective-evaluator.js` | A | `Prompt templates for Multi-Perspective Concept Evaluator` | Same reasoning — module header restates the app is live and named Multi-Perspective. |
| J27-008 | `shared/config/appRegistry.js` | A | `categories: ['concepts']` | Verbatim at :21; this is the fact the row states (only still-active `concepts`-category app). |
| J27-010 | `scripts/find-2025-phase-i.js` | A | `* Find 2025 Phase I test candidates.` | Original row excerpt, verbatim in this file only. |
| J27-010 | `find-phase-i-test-cases.js` | A | `Find Phase I v2 test-case candidates` | Header docblock confirms it's the same class of Phase I prompt-tuning harness the row describes. |
| J27-010 | `compare-phase-i-v1-v2.js` | A | `Phase I v1 vs v2 Comparison Harness` | Same — header names it a Phase I harness. |
| J27-010 | `ab-phase-i-prompts.js` | A | `A/B multi-trial comparison of v1` | Same — header names it a Phase I prompt A/B harness. |
| J27-010 | `seed-phase-i-prompt.js` | A | `Seed the Phase I v2 prompt into the scratch` | Same — header names it a Phase I prompt seeding harness. |
| J27-011 | `shared/forms/phase-ii-research-2026-06/` (directory) | A, directory→file | replaced with `shared/forms/phase-ii-research-2026-06/schema.js` → `FORM_KEY = 'phase-ii-research-2026-06';` | Gate no longer passes a directory site on existence; `schema.js` is the file inside it that defines the form key, per plan §2. |
| J27-011 | `lib/db/migrations/005_intake_portal.sql` | A | `e.g. 'phase-ii-research-2026-06'` | Original row excerpt, verbatim at :17 (the `form_key` column comment). |
| J27-011 | `scripts/smoke-form-schema.js` | A | `schema.formKey === 'phase-ii-research-2026-06'` | Verbatim at :26; smoke-checks the same form key literal. |
| J27-011 | `tests/unit/intake-submit-freeze-guard.test.js` | A | `'phase-ii-research-2026-06'` | Test fixture hardcodes the real form key literal (:63,70). |
| J27-011 | `tests/unit/intake-attach-endpoint.test.js` | A | `'phase-ii-research-2026-06'` | Test fixture hardcodes the real form key literal (:79). |
| J27-011 | `tests/unit/intake-submit-pending-guard.test.js` | A | `'phase-ii-research-2026-06'` | Test fixture hardcodes the real form key literal (:63,72). |
| J27-011 | `tests/unit/intake-upload-token-endpoint.test.js` | A | `'phase-ii-research-2026-06'` | Test fixture hardcodes the real form key literal (:62). |
| J27-011 | `tests/unit/intake-draft-endpoint.test.js` | A | `missing formKey → 400` | Uses a placeholder key (`'phase-ii-2026-06'`), not the real literal, but pins the same form_key-is-required fact via a dedicated formKey-validation test (:138). |
| J27-011 | `tests/unit/intake-draft-service.test.js` | A | `missing formKey throws` | Same reasoning as intake-draft-endpoint.test.js — formKey-required test with a placeholder key (:51). |
| J27-011 | `tests/unit/intake-attach-utils.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests file-magic/blob-filename/blob-token utilities; no form_key or formKey reference. |
| J27-011 | `tests/unit/intake-attachment-shape.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests attachment-shape validator contract; no form_key or formKey reference. |
| J27-011 | `tests/unit/intake-budget-line-payload.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests budget-line row/payload helpers; no form_key or formKey reference. |
| J27-011 | `tests/unit/intake-draft-service-pending.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests IntakeDraftService pending-attachment helpers; no form_key or formKey reference. |
| J27-011 | `tests/unit/intake-pending-sweep.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests MaintenanceService.sweepIntakePending race-safety; no form_key or formKey reference. |
| J27-011 | `tests/unit/intake-rate-limit.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests intake-portal rate limiting; no form_key or formKey reference. |
| J27-011 | `tests/unit/intake-routes-dynamics-context.test.js` | (excluded, does not carry the fact) | none — left out of `site` | Tests that intake routes wrap trusted Dynamics reads in `bypassDynamicsRestrictions()`; `formKey: 'k'` is incidental request-body filler, not a pinned fact about the form module. |
| J27-012 | `docs/GRANT_CYCLE_LIFECYCLE.md#Phase II: Proposal` | A | `Phase II proposal submitted` | Verbatim table-cell text at L68 (row 11), the second-submission fact the row states. |
| J27-012 | `docs/BACKEND_AUTOMATION_PLAN.md` | A | `Phase II file organization` | Verbatim at :292; the "still Planned, no J27 trigger" flow row. |
| J27-020 | `lib/services/workbench/dashboard-service.js` | A | `akoya_requeststatus eq 'Phase II Pending' or wmkf_triagestatus eq ${TRIAGE_STATUS.ADVANCING}` | Verbatim at :88; the canonical Persist gate the row states. |
| J27-020 | `lib/services/reviewer-finder/my-proposals-service.js` | A | `and wmkf_phaseiistatus eq null` | Verbatim at :124 (`... and wmkf_phaseiistatus eq null`); the second clause of the row's excerpt. |
| J27-021 | `shared/config/triageStatus.js` | A | `Additively extensible for J27` | Verbatim at :26; the row's "Additively extensible for J27" fact. |
| J27-021 | `lib/dataverse/schema/wave2-triagestatus/akoya_request-triagestatus.json` | A | `Additively extensible for J27` | Same phrase verbatim in the Dataverse schema description at :11; the row's original excerpt used `VISIBILITY ONLY` with a space, but this file has `VISIBILITY-ONLY` (hyphen) — not verbatim — so bound to the phrase that IS verbatim here instead. |
| J27-021 | `lib/services/workbench/triage-service.js` | A | `VISIBILITY ONLY (Advancing vs Set aside; reversible)` | Verbatim at :9; the row's original second excerpt span. |
| J27-022 | `lib/services/dataverse-export/constants.js` | A | `'Phase I Ineligible', 'Phase II Ineligible', 'Concept Ineligible', 'Concept Denied', 'Denied', 'Rescinded', 'Concept Done',` | Verbatim across :123-124 (whitespace-collapsed); the row's vocabulary list, with the original "…" ellipsis expanded to the real text so it can bind to one file. |
| J27-022 | `shared/config/prompts/dynamics-explorer.js` | A | `"Concept Done", "Concept Ineligible", "Concept Denied"` | Verbatim at :32; restates the same status vocabulary for the Dynamics Explorer prompt. |
| J27-022 | `dataverse-akoya-request.md#Key fields` | A | `Phase I Declined` | Verbatim at :27; the Atlas page's own quoted sample of the `akoya_requeststatus` vocabulary (the row's original excerpt's exact values live further down the same file, cited by the "Concept Done" 3,047 note in disposition). |
| J27-023 | `lib/utils/cycle-code.js` | A | `null if the month isn't June/December` | Original row excerpt, verbatim at :22. |
| J27-023 | `pages/api/workbench/initial-assessment.js` | A | `/^[A-Za-z]\d{2}$/` | Verbatim at :49 (row cited :50, off by one but same function); original row excerpt. |
| J27-023 | `pages/workbench/awardees.js` | A | `/^[JD]\d{2}$/` | Verbatim at :47 (row cited :38-39; line numbers drifted but the pattern is unchanged); original row excerpt. |
| J27-023 | `scripts/audit-reviewer-reminder-token-liveness.mjs` | A | `/^[DJ]\d{2}$/` | Carries the same "pattern-based cycle validation" fact, but its own regex spells the character class `[DJ]`, not `[JD]` — not verbatim to the row's shared excerpt, so bound to its own exact text at :53. |
| J27-023 | `scripts/audit-grant-cycle-shortcode-domain.js` | A | `wmkf_grantcyclecode distinct values` | No regex/pattern in this file; it audits the live `wmkf_grantcyclecode` domain for shortcode collisions ahead of a schema change, which is the same "cycle codes are opaque strings, don't hardcode them" subject the row groups these scripts under. Bound to its own header text (:7) since it shares no verbatim string with the pattern-based files. |
| J27-024 | `pages/api/intake/submit.js` | A | `requestless branch (single-phase)` | Original row excerpt, verbatim at :19. |
| J27-024 | `lib/services/intake-draft-service.js` | A | `makes the requestless branch dominant` | Verbatim at :23-24 (whitespace-collapsed); same single-phase-pivot fact. |
| J27-024 | `lib/db/migrations/011_submission_jobs_states.sql` | A | `drain CREATES a new akoya_request (not attach)` | Original row excerpt, verbatim at :5. |
| J27-024 | `lib/db/migrations/012_intake_drafts_uniqueness.sql` | A | `the requestless branch the dominant path` | Verbatim at :8 (row cited :7, off by one); same pivot fact for the drafts uniqueness index. Bound path spelled canonically (`lib/db/migrations/...`), not the bare-basename shorthand used in `site` — after the `8a25a90b` gate fix (binding membership resolves through the same candidate list as `site`, not raw string equality) the shorthand form no longer resolved. |
| J27-024 | `scripts/setup-database.js` | A | `single-phase pivot makes this branch dominant` | Verbatim at :1083-1084 (whitespace-collapsed); fresh-install mirror of migration 012's comment. |
| J27-025 | `pages/api/cron/generate-grantee-titles.js` | A | `Fires at the Phase I→II board flip` | Verbatim at :4 (row's own excerpt, minus the parenthetical which used `=` spacing not present verbatim). |
| J27-025 | `dataverse-akoya-request.md#Key fields` | A | `wmkf_phaseistatus=Invited` | Verbatim at :134 (inside backticks, stripped by the matcher); the same board-flip fact restated in the Atlas page. |
| J27-026 | `lib/services/workbench-proposal-documents.js` | A | `const PHASE_II_FOLDER = 'Phase II';` | Original row excerpt, verbatim at :23. |
| J27-026 | `lib/services/expertise-finder/proposals-service.js` | A | `'wmkf_phaseistatus', 'wmkf_phaseiistatus',` | Verbatim at :37; original row excerpt. |
| J27-026 | `pages/api/dynamics-explorer/chat.js` | A | `wmkf_phaseistatus,wmkf_phaseiistatus` | Verbatim (no-space form) inside the $select field list at :1170; same both-phase-status-columns fact. |
| J27-026 | `pages/expertise-finder.js` | A | `Phase I Status` | Verbatim at :743 and :889 (CSV export header + table column); the reader UI that must survive cleanup, per the row. |
| J27-027 | `shared/components/workbench/StatusTab.js` | A | `Reflects the proposal's own Dynamics lifecycle string` | Verbatim at :4 (row cited exactly); original excerpt minus the parenthetical field name. |
| J27-027 | `tests/unit/workbench-overview-status.test.js` | A | `shows an Unclassified badge for a status absent from the map` | Verbatim at :42 (row cited :37, drifted); pins the UNCLASSIFIED-fallback fact the row states. |
| J27-027 | `tests/unit/dynamics-explorer-taxonomy.test.js` | (excluded, does not carry the fact) | none — left out of `site`, note added | Tests the Dynamics Explorer live-taxonomy prompt block; its `statuses: ['Active', 'Phase II Pending']` fixture is unrelated test data, not the StatusTab UNCLASSIFIED-fallback fact. |

## Slice B

| register id | file | case | fragment or note | reason |
|---|---|---|---|---|
| J27-028 | `shared/config/requestDocument.js` | A | `REQUEST_DOCUMENT_ARTIFACT_TYPE = Object.freeze({ INITIAL_ASSESSMENT: 100000000,` | Fact (artifact-type registry constants) still verbatim at line 10-11. |
| J27-028 | `dataverse-wmkf-requestdocument.md` (bare Atlas token, matches `site`) | A | `The entity contains 12 rows: three Initial Assessments, eight Pre Site Visits, and one Final Writeup.` | Atlas restates the 12-Production-rows fact the row's note claims, at the `#Status` VERIFIED-2026-08-31 census line (:27-29). |
| J27-029 | `lib/services/initial-assessment/artifact-service.js` | A | `meetingDateToCycleCode(request.wmkf_meetingdate)` | Still present verbatim at line 971-972; the service derives cycleCode with no D26 gate. |
| J27-029 | `tests/unit/initial-assessment-artifact-service.test.js` | A | `buildInitialAssessmentIdentity({ ...base, cycleCode: 'J27' })` | Fixture at ~L1262 exercises the identity builder with J27; a second J27 fixture also appears at L1687-1705. |
| J27-033 | `docs/W4_RECONCILE_CONTRACT.md` | A | `Currently 10 cycles after W3 collapse: D23, D24, D25, D26, D27, J23, J24, J25, J26, J27.` | J27 still named among the 10 active PG short codes at L65. |
| J27-033 | `postgres-grant-cycles.md` (bare Atlas token, matches `site`) | A | `Live data: J23–J27, D23–D27 cycles` | Atlas still lists J27 among live PG cycle rows. |
| J27-033 | `scripts/collapse-grant-cycle-duplicates.js` | A | `{ id: 12, expectedCode: 'J27', newCode: 'J27x12' },` | Duplicate-collapse rename table still references J27 at row id 12. |
| J27-035 | `shared/config/guideContent.js` | A | `Apps are organized into categories: Concepts, Phase I, Phase II, and Other.` | Home-page help copy still states the dual-phase taxonomy verbatim at L21. |
| J27-035 | `pages/index.js` | A | `Phase I ({apps.filter(a => a.categories.includes('phase-i')).length})` | Home-page category tab still renders a Phase I count (L179); Phase II tab is the sibling (L189). |
| J27-035 | `pages/admin.js` | A | `'batch-phase-i': 'Batch Phase I',` | Admin app-name map still carries Phase I/II app naming at L1111-1114, the same dual-phase taxonomy this row is about. |
| J27-036 | `lib/services/workbench/dashboard-service.js` | A | `Concept-stage row the coarse meeting-date` | Same Concept-exclusion rationale present in both the docblock (L18) and inline comment (L176). |
| J27-036 | `lib/services/reviewer-finder/my-proposals-service.js` | A | `Always exclude concept and Phase I-declined — they never need outside` | Rationale comment at L23/L120 still states the exclusion this row's excerpt names. |
| J27-036 | `tests/integration/workbench-routes.test.js` | A | `default filter cannot surface untriaged Concept rows` | Test name at L193 still pins the Concept-exclusion behavior. |
| J27-037 | `lib/services/workbench/dashboard-service.js` | A | `wmkf_triagestatus eq ${TRIAGE_STATUS.SET_ASIDE})` | Set-aside visibility clause still present at L90. |
| J27-037 | `pages/api/workbench/dashboard.js` | A | `?includeSetAside=1     also show` | Docblock query-param doc for the includeSetAside toggle still present at L16. |
| J27-037 | `pages/workbench.js` | A | `Show set aside` | Toolbar checkbox label present at L219 (cited range 38-51,141,220,273-275). |
| J27-037 | `pages/workbench/reviewer-follow-up.js` | A | `Show set aside` | Same toolbar label present at L356 (cited range 269,298-299,357). |
| J27-037 | `pages/api/workbench/triage.js` | A | `Set aside; reversible)` | Docblock still describes triage as Advancing-vs-Set-aside, reversible, at L5-7. |
| J27-037 | `lib/services/workbench/triage-service.js` | A | `superuser OR the request's lead PD` | Hard manage gate comment still present at L15-18/65-68, matching the row's own [SOURCE-VERIFIED] quote. |
| J27-038 | `shared/config/workbenchProposalDocuments.js` | A | `Cycle-specific overrides go here (e.g. when J27 naming is known). Falls back` | Comment above `PROPOSAL_DOCUMENT_CONFIG_BY_CYCLE` still confirms only a D26 key exists, at L28. |
| J27-038 | `lib/services/workbench-proposal-documents.js` | A | `if (!isInPhaseFolder(folder, config.phaseFolder)) continue;` | Phase-folder gate still present at L110. |
| J27-038 | `lib/services/reviewer-finder/load-proposal-service.js` | A | `/(^|\/)Phase I$/i.test(String(file.folder || ''))` | `isCurrentCycleFallback` still hard-codes the `Phase I` folder match at L84-86. |
| J27-038 | `pages/api/workbench/download-proposal-document.js` | A | `the folder's top-level segment must belong to` | Docblock comment at L71 still names the `Phase I` subfolder example this row is about. |
| J27-038 | `lib/services/workbench/download-proposal-document-service.js` | A | `Reviewer Materials, Phase I, Phase II, or canonical AI` | Authoritative-scope docblock still lists Phase I among allowed document kinds at L12. |
| J27-039 | `shared/components/workbench/ProposalTab.js` | C (line drift, fact intact) | `Phase I documents` | Section heading still present verbatim, but at L443/459, not the cited 336/352; fixed the line cite, no fact changed. |
| J27-039 | `pages/api/workbench/proposal-documents.js` | A | `Phase I/II documents, and` | Docblock still names Phase I/II documents at L6. |
| J27-040 | `shared/config/prompts/phase-i-writeup.js` | A | `**LENGTH REQUIREMENT:** Approximately 1 page (500-600 words total)` | Length spec sized for the short D26 application still present at L35. |
| J27-040 | `phase-i-summaries.js` (sibling-dir token, matches `site`) | A | `analyze this Phase I research proposal` | Prompt still names Phase I research proposal at L38. |
| J27-040 | `phase-i-dynamics.js` (sibling-dir token, matches `site`) | A | `analyzing Phase I research proposals` | System prompt still names Phase I research proposals at L21. |
| J27-040 | `pages/batch-phase-i-summaries.js` | A | `Process multiple Phase I proposals at once` | Page description at L259 still names Phase I proposals. |
| J27-040 | `pages/api/process-phase-i.js` | A | `Use Phase I specific prompt` | Comment at L147 still selects the Phase I prompt; L272 handles Phase I formatting. |
| J27-040 | `pages/phase-i-writeup.js` | A | `Generate Phase I writeup drafts from PDF research proposals` | Page description at L152 still names Phase I writeup drafts. |
| J27-040 | `pages/phase-i-dynamics.js` | A | `Single-request Phase I summarization with writeback` | Page description at L149 still names Phase I summarization. |
| J27-040 | `pages/api/phase-i-dynamics/summarize.js` | A | `POST: Single-request Phase I proposal summarization with Dynamics writeback.` | Docblock at L4-6 still names Phase I proposal summarization. |
| J27-040 | `lib/services/phase-i-dynamics/summarize-service.js` | A | `Phase I Dynamics — single-request summarize + writeback service` | Docblock title at L2 still names Phase I Dynamics. |

## Slice C

| register id | file | case | fragment or note | reason |
|---|---|---|---|---|
| J27-041 | `shared/config/prompts/proposal-summarizer.js` | A | `Used for creating Phase II writeup drafts from research proposals` | Header docblock states the Phase II input fact directly (line 6). |
| J27-041 | `pages/batch-proposal-summaries.js` | A | `title="Batch Phase II Summaries"` | Page title names Phase II (line 268); bag fragment already matched, bound per-file. |
| J27-041 | `pages/phase-ii-writeup.js` | A | `title="Create Phase II Writeup Draft"` | Page title names Phase II (line 450). |
| J27-041 | `shared/components/Phase2WordExportModal.js` | A | `follow the Keck Phase II writeup template format` | Modal copy names the Keck Phase II template (line 41). |
| J27-041 | `shared/components/Phase2FeedbackModal.js` | A | `Phase II refine-summary feedback modal.` | Header docblock names Phase II (line 2). Bound with the full path (not the bare basename) after the `claude/j27-gate-tighten` binding-resolution fix (`8a25a90b`). |
| J27-041 | `shared/components/Phase2QAModal.js` | A | `Phase II Q&A side-panel modal.` | Header docblock names Phase II (line 2). Bound with the full path for the same reason. |
| J27-041 | `lib/services/pre-site-visit/docx-renderer.js` | A | `Template-preserving Phase II Pre-Site Visit Word renderer.` | Header docblock; matches the row's own bag fragment. |
| J27-042 | `lib/services/grant-reporting/classify-file.js` | A | `const isPhaseI = wordRe('phase[\\s_]?i').test(n)` | Filename phase-word heuristic present verbatim at line 27. |
| J27-042 | `lib/services/grant-reporting/lookup-grant-service.js` | A | `Tier 2: phase ii (handles "Phase II", "Phase_II", "Phase-II")` | Same phase-word-heuristic fact restated in the tiered best-guess picker near line 267. |
| J27-043 | `shared/config/prompts/dynamics-explorer.js` | A | `Lifecycle: Concept → Phase I → Phase II → Active → Closed.` | Verbatim at line 607; matches the row's own bag fragment. |
| J27-043 | `docs/DYNAMICS_SCHEMA_ANNOTATION.md` | A | `Phase II outcome: Approved, Phase II Declined, Phase II Pending Committee Review, Phase II Withdrawn, Phase II Deferred (rare)` | `wmkf_phaseiistatus` option-set meanings restated at line 71 (row's Q14). |
| J27-044 | `lib/services/final-writeup/dashboard-service.js` | A | `export const FINAL_WRITEUPS_DEFAULT_CYCLE_WALKBACK = 3;` | The walkback constant itself, near line 50-51. |
| J27-044 | `tests/unit/final-writeups-dashboard-service.test.js` | A | `stops after the walk-back bound and shows the newest cycle empty as exhausted` | Test title at line 726 exercises the same walkback constant. |
| J27-044 | `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md` | A | `within the three newest available cycles` | §6 invariant table restates the walkback=3 fact in prose (line 354). |
| J27-045 | `pages/api/workbench/final-writeups.js` | A | `cycleCode must be a cycle code such as D26, or none` | Error string names D26 verbatim (line 58); matches the row's own bag fragment. |
| J27-045 | `pages/api/workbench/grantee-deliverables/awardees.js` | A | `cycleCode must be a valid cycle (e.g. J26 or D26)` | Distinct error string naming D26 (line 38); not the bag fragment, so bound per-file. |
| J27-045 | `pages/api/workbench/grantee-deliverables/cycle-export.js` | A | `cycleCode must be a valid cycle (e.g. J26 or D26)` | Same error string as awardees.js, at line 37. Bound with the full path (not the bare basename `cycle-export.js` the row's `site` cell uses) after the `claude/j27-gate-tighten` binding-resolution fix (`8a25a90b`). |
| J27-045 | `pages/api/cron/generate-grantee-titles.js` | A | `Invalid cycleCode "${cycleCode}" (expected e.g. J26 / D26).` | Distinct template-literal error string naming D26 (line 54). |
| J27-045 | `pages/api/workbench/initial-assessment.js` | A | `?cycleCode=D26 → registry read model.` | JSDoc example query string names D26 (line 5). |
| J27-045 | `pages/admin.js` | A | `placeholder="D26"` | Input placeholder names D26 (line 2842); matches the row's own bag fragment. |
| J27-047 | `lib/services/review-documents/individual-file-service.js` | A | `REVIEW_DOCX_CYCLE_FLAG = 'REVIEW_DOCX_SHAREPOINT_CYCLE'` | Defines the env-flag name the cycle pin reads (line 40). |
| J27-047 | `docs/CREDENTIALS_RUNBOOK.md` | A | `Production is exact D26 as of 2026-09-03.` | Runbook row for `REVIEW_DOCX_SHAREPOINT_CYCLE` states the live D26 pin (line 196). |
| J27-047 | `docs/REVIEW_DOCX_SHAREPOINT_RETENTION_PLAN.md` | A | `advancing the automatic cycle is a deliberate configuration change.` | Matches the row's own bag fragment (line 507). |
| J27-047 | `docs/API_ROUTE_SECURITY_MATRIX.md` | A | `EXACT WRITE=on, CYCLE=D26` | Security matrix row for `/api/cron/file-review-docx` restates the live pin (line 163). |
| J27-047 | `dataverse-wmkf-appreviewersuggestion.md` | A | `active for exact D26` | Atlas restates the Wave 5 D26 pin near line 152-155 (cited line drifted from 146). |
| J27-047 | `project-review-output-formatting.md` | A | `REVIEW_DOCX_SHAREPOINT_CYCLE=D26` | Memory (`status: active`) states the exact env pin near L146; matches the row's own bag fragment. |
| J27-048 | `lib/services/discovery/constants.js` | A | `const TRACK_B_ENABLED = false;` | Constant + adjoining comment ties Track B's off-state to the D26 thin-signal decision (line 42 area) that J27 (full proposals) may revisit. |
| J27-048 | `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` | A | `Operational plan for finding appropriate reviewers for the **D26 Phase-I** cycle` | Doc title/intro names the D26 cycle; matches the row's own bag fragment. |
| J27-048 | `docs/REVIEWER_FINDER.md` | A | `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` | `related:` frontmatter cites the D26-named flowchart doc by path (line 11); this dependency is itself the J27-sensitive fact (a canonical doc pointing at a cycle-named doc). |
| J27-048 | `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` | A | `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` | Same dependency restated in frontmatter (line 11) and body (lines 23, 921). |
| J27-050 | `docs/GRANT_CYCLE_LIFECYCLE.md` | C (resolved: line-cite fix) | `the standalone "Concept" stage is gone and applicants submit once.` | The row's original hedge ("likely to merge... may go away") no longer appears; it was replaced 2026-09-06 by a confirmed-decision note at the same cited line (23). Bound the current text at the existing cite; no stale line-cite fix needed. |
| J27-050 | `docs/STRATEGY.md` | A | `The cycle is changing — concepts, phases, evaluation methods are all in flux.` | Older hedged planning language is still present near line 318-319, as the row's disposition already notes. |
| J27-050 | `project-staged-review-pipeline.md` | A | `concepts may be eliminated, Phase I may go away` | Memory (`status: active`) still carries the older hedge verbatim at L28; matches the row's own bag fragment. Disposition normalized `partly done` → `open` per plan §3 vocabulary (row not fully resolved — two of three cited files still carry the hedge). |
| J27-053 | `project-reviewer-apps-redesign-direction.md` | A | `real deadline, ~mid-June 2026 Phase I→II flip` | Memory (`status: active`) carries the mid-June 2026 estimate at L482 (word order differs from the row's bag fragment, so bound per-file); left unedited per the row's owner-question note (Q18). |
| J27-053 | `docs/REQUEST_WORKBENCH_BUILD_PLAN.md` | A | `Phase I→II flip ~mid-June 2026` | Same estimate, exact bag-fragment order, near line 33. |
| J27-055 | `project-intake-portal-skinny-scope.md` | A | `next cycle's Phase I intake, ~25 proposals` | Memory (`status: active`); matches the row's own bag fragment at L45. |
| J27-055 | `project-intake-portal-ui-todo.md` | A | `the moment the next cycle's Phase I intake opens` | Memory (`status: active`); restates the "next cycle's Phase I intake" fact without the "~25 proposals" clause, at L64. |
| J27-055 | `project-machine-legible-form-capture.md` | A | `for the next cycle's Phase I intake.` | Memory (`status: active`) at L13. |
| J27-055 | `project-intake-portal-virus-scan-e2e-deferred.md` | A | `the next cycle's Phase I intake; the June 2026 Phase II Research pilot is superseded` | Memory (`status: active`) at L35. |
| J27-055 | `intake-portal.md` (wiki) | A | `Virus-scan E2E was deferred and must run before the next cycle.` | Matches the row's own bag fragment at L88. |
| J27-056 | `dataverse-wmkf-requestdocument.md` (Atlas) | A | `Phase I display documents … do not satisfy the producer contract.` | Matches the row's own bag fragment, present under both cited headings (`#Status` context near L64-68 and `#Initial Assessment pilot contract` near L299-304). |
| J27-056 | `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | A | `The D26 examples provide the starting content contract for the J27` | §"Initial Assessment source and first-template contract" restates the D26→J27 document-contract fact near line 339. |
| J27-056 | `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | A | `The exact Initial Assessment format remains in flux during the transition to a single-phase submission.` | States the same in-flux Initial Assessment fact near line 456-457. |
| J27-057 | `dataverse-akoya-request.md` (Atlas) | A | `"Phase II" is process-era-dependent` | Matches (a substring of) the row's own bag fragment, in the large "Polymorphism & era distribution" section. |
| J27-057 | `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | A | `Phase II remains a business-process stage but creates no second applicant submission.` | §"Lifecycle meaning" states the same process-era-dependent Phase II fact near line 162-163. |
| J27-057 | `project-reviewer-apps-redesign-direction.md` | A | `Phase II Pending (doc arrived) · J27 phase trigger` | Memory (`status: active`); matches (a substring of) the row's own bag fragment at L401-402. |
| J27-058 | `project-reviewer-origination-experiment-result.md` | A | `Phase-I thin-signal cohort (the live D26 condition)` | Memory (`status: active`); matches the row's own bag fragment at L45. |
| J27-058 | `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` | A | `it is the right cohort for the D26 decision` | Restates the same thin-signal-cohort scoping near L119-120 (own text; markdown emphasis around the bag fragment made it unusable verbatim). |
| J27-058 | `reviewer-origination.md` (wiki) | A | `10 D26 Phase-I proposals (PD sniff test substituting` | Restates the D26 Phase-I sniff-test cohort fact near L133. |
| J27-059 | `external-reviewer-portal.md` (wiki) | A | `Research Phase I Application_<timestamp>.pdf contains more information than WMKF sends reviewers and must never be exposed.` | Matches the row's own bag fragment at L457. |
| J27-059 | `lib/external/reviewer-materials.js` | A | `Reviewer Materials/Proposal_{requestNumber}.pdf` | States the reviewer-package filename pattern the row's Q21 asks whether J27 still produces separately. |

## Slice D

| register id | file | case | fragment or note | reason |
|---|---|---|---|---|
| J27-060 | `.claude-memory/project-j27-doc-capture-evolution.md` | A | `In J27 Initial Assessment becomes a real feature (every complete single-submission proposal gets one before advancement)` | Existing bag quote already matches this file verbatim; bound it. |
| J27-060 | `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | A | `Initial Assessments return in J27 as a real feature` | Wiki restates the same fact in different words at L1621 area; quoted the exact clause. |
| J27-060 | `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | A | `before the staff merits discussion and Board advancement decision` | Plan states the fact at the cited J27-060-tagged line (154-157); avoided markdown `**` inside the fragment. |
| J27-062 | `.claude-memory/project-grant-phasing-evolution.md` | A | `Plan an upstream per-PD triage/cycle dashboard for J27` … `up to ~300 full proposals, most never sent for outside review` | Both original bag-fragment halves match this file verbatim (source of the original excerpt). |
| J27-062 | `.claude-memory/project-reviewer-apps-redesign-direction.md` | A | `up to ~300 full proposals and most never reviewed` | Same Build fact restated with different wording ("Triage lens (J27)"); quoted this file's own exact phrasing. |
| J27-062 | `pages/workbench/[requestId].js` | A | `{ key: 'awardee', label: 'Awardee' },` | The file's `TABS` const is the exhaustive current tab list and has no triage entry — the load-bearing evidence for "no triage tab today," corroborating the Build row. Bound the array's last entry as an anchor into this file. |
| J27-062 | `docs/STAGED_REVIEW_PIPELINE.md` | A | `a three-stage automated triage and review pipeline for evaluating a higher volume of full proposals` | `kind: history` but `status: active`; not in the case-B pattern list (not docs/audits, docs/archive, DEVELOPMENT_LOG, or a stale/superseded memory), so it stays checked. Bound to the sentence identifying it as the closest existing triage design, matching the row's own disposition note. |
| J27-063 | `.claude-memory/project-j27-doc-capture-evolution.md` | A | `broader J27 applicant-capture producers and the partial-pilot blockers remain open` | Original bag fragment ("remain future work") was a paraphrase that doesn't appear verbatim; corrected to the file's exact wording at L135-136 (same fact, same location). |
| J27-063 | `lib/services/workbench-proposal-documents.js` | A | `single-submission-cycle cutover is documented but is not implemented here.` | Exact docblock quote at L182 already in the original excerpt; bound it. |
| J27-063 | `docs/atlas/dataverse-wmkf-requestdocument.md` | A | `Schema-as-code, adapter, producer, read API, Workbench panel` | Atlas `#Status` section documents the typed `wmkf_requestdocument` registry implementation that the row's disposition names as the canonical J27 document path (Q5). |
| J27-063 | `docs/audits/memory-router-semantic-reconciliation-2026-07-29.md` | B | moved to disposition: `provenance: docs/audits/memory-router-semantic-reconciliation-2026-07-29.md:44` | Dated audit in `docs/audits/` — case B per §3; citation moved into notes, not deleted. |
| J27-065 | `.claude-memory/project-j27-doc-capture-evolution.md` | A | `which will label and fingerprint both sources so cited authors can inform discovery` | Exact quote at L47-53 restating the bibliography-aware Reviewer Finder fact. |
| J27-065 | `.claude-memory/project-reviewer-finder-proposal-doc-context.md` | A | `Reviewer Finder will load and separately label both for Claude` | Exact quote near L56 restating the same fact in this file's own words. |
| J27-065 | `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | A | `next cycle it will separately label and fingerprint both files` | Exact verbatim match of the row's original first excerpt fragment, found at L185. |
| J27-065 | `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md` | A | `Keep the narrative and bibliography as separate exact AI Materials` | Exact quote at L367 restating the two-file bibliography contract. |
| J27-065 | `docs/agent-wiki/topics/reviewer-origination.md` | A | `bibliography assembled by a Power Automate flow` | Exact verbatim match of the row's original second excerpt fragment, found at L207-209. |
| J27-066 | `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md` | A | `Planning — relevant to single-phase cycle (two cycles out)` | Original excerpt's `Status: Planning …` quote has `**Status:**` markdown between "Status:" and "Planning" in the file, so the literal fragment wasn't a substring; re-quoted starting after the bold marker at L20. |
| J27-066 | `docs/BACKEND_AUTOMATION_PLAN.md` | A | `Not blocking v1; factored in when planning single-phase cycle Dynamics fields.` | L75 restates the deferred/planned status of the extraction plan; the row's exact "deferred until … imminent" phrase is not in this file, so bound a different verbatim clause from the same file that supports the same fact. |
| J27-066 | `.claude-memory/project-proposal-context-extraction.md` | A | `deferred until single-phase cycle is imminent` | Exact verbatim match at L42. |
| J27-070 | `lib/services/final-writeup/dashboard-service.js` | A | `FINAL_WRITEUPS_DASHBOARD_MAX_ROWS = 100` | Exact constant definition at L48. |
| J27-070 | `tests/unit/final-writeups-dashboard-service.test.js` | A | `fails loudly instead of silently truncating the dashboard, naming the oversized cycle` | The constant itself (`= 100`) is only imported/used, not assigned, in this file, so the original bag fragment wouldn't match; bound the test-name clause covering the "fails closed (503)" behavior instead. |
| J27-070 | `docs/atlas/dataverse-wmkf-finalwriteupreviewacknowledgement.md` | A | `batch-read acknowledgements for at most 100` | L107-108 restates the per-cycle 100-row cap. |
| J27-071 | `lib/dataverse/adapters/grant-request.js` | A | `QUERY_ALL_REQUESTS_CAP = MAX_EXPORT_RECORDS` | Exact constant definition at L262. |
| J27-071 | `lib/services/dynamics/constants.js` | A | `MAX_EXPORT_RECORDS = 5000` | Exact constant definition at L47. |
| J27-071 | `tests/unit/final-writeups-dashboard-service.test.js` | A | `warns once with final_writeups_dashboard_cycle_list_near_cap when the scan reaches half the export cap` | Test name at L646 covers the "near-cap warning at half" fact the row states. |
| J27-071 | `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md` | A | `final_writeups_dashboard_cycle_list_near_cap` | Exact code string at L114-115 (the warning code named in the near-cap mitigation). |
| J27-073 | `lib/services/workbench/request-search-service.js` | A | `REQUEST_SEARCH_PAGE_SIZE = 25` | Exact constant definition at L26. |
| J27-073 | `pages/api/workbench/search-requests.js` | A | `REQUEST_SEARCH_MAX_RESULTS - REQUEST_SEARCH_PAGE_SIZE` | Exact usage at L36. |
| J27-073 | `shared/components/workbench/RequestLocator.js` | A | `MAX_SAVED_RESULTS = 100` | Exact constant definition at L9. |
| J27-074 | `docs/atlas/dataverse-akoya-request.md` | A | `returned 236 eligible rows with capped:false` | `#Key fields` section states the 236-row observation with `capped:false` the row cites. |
| J27-074 | `docs/API_ROUTE_SECURITY_MATRIX.md` | A | `fails 503 if its paginated scan is capped` | L265 row for `/api/workbench/dashboard` states the capped-scan-fails-503 fact directly; the `/api/workbench/dashboard` route citation itself is a route path (starts with `/`) and is ignored by the gate, so only the two docs needed binding. |
| J27-079 | `docs/STAGED_REVIEW_PIPELINE.md` | A | `"3x volume") may need to be revisited` | Original excerpt fragment omitted the closing paren present in the file's actual text at L17; corrected to the exact substring. |
| J27-079 | `docs/PDF_INPUT_FOR_BACKEND.md` | A | `300 proposals/year × 3 stages` | Exact verbatim match at L98. |
