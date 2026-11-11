# Pre-flight prompts: Session 673 handoff (2026-11-10)

## Status and owner decisions

Owner: Justin; session agent: Codex. Branch: `codex/coordinated-start-2026-11-10-b`.
This is a dated discovery/decision record, not a completed architecture or deployment plan.
No architecture code, routes, schema, or Power Automate flows were built in this session.
Resume architecture planning and building next session; discuss each prompt's content with Justin individually.

[OWNER DECIDED in chat]
- Keep common tasks in the shared Dataverse prompt library, visible and editable in Admin.
- Pre-flight is their organizational group, not an exclusive backend execution mode.
- Main editing surface should be legible task instructions, e.g. “write a 200 word executive summary.” Wrappers/security/cache plumbing should be separate and rarely edited.
- Power Automate will trigger the shared backend Executor through an authenticated endpoint. This supersedes this session's earlier PA-native child-flow recipe; do not build a second Anthropic executor in PA.
- Adapt PD expertise matching to the current eligible roster. Store in Admin first; assignment integration waits for roster readiness.
- Short-title model: concrete `claude-sonnet-5-5`, output budget 4,096.
- Use the old Phase I Writeup Draft's summary section as the starting point for Executive Summary, then revise with Justin because what is shared with Chairs is changing. Final wording/audience is NOT settled.

## Workbook requirements retained independently of the local workbook

[VERIFIED via read-only XLSX XML extraction in this session]
Source: `/Users/gallivan/Downloads/J27_Review_Workbook_Mockup_v10.1 (edited by SH, JG, CN, DS 11.10.26).xlsx`.
Main sheet: `1 Review (staff master)`, A1:AS203. Rows 1–4 describe stage, field, producer/length, and refresh/audience; proposal rows are 5–203.
The workbook was not modified or committed. The table below preserves the preflight requirements if the Downloads file is unavailable on another Mac.

| Column | Field | Workbook producer / length | Refresh | Workbook audience |
|---|---|---|---|---|
| H | Short title | Claude P1 | Overwrite | All staff, Chairs |
| I | Executive Summary | Claude P2; at most 200 words | Overwrite | All staff, Chairs |
| J | Methodology (page 1) | Claude P3; 2 sentences to 100 words | Overwrite | All staff, Chairs |
| K | Personnel | Claude P4; length scales with team size | Overwrite | All staff, Chairs |
| L | Rationale (Intake) | Claude P5; 3 sentences to 100 words | Versioned | All staff, Chairs |
| M | Field keywords | Claude P7; from list | Overwrite | All staff, Chairs |
| N | Methods keywords | Claude P7; from list | Overwrite | All staff, Chairs |
| O | Flags (Claude, intake) | Claude P6; details on Flags sheet | Versioned | Staff |
| P | Open questions | All prompts; page/section references | Accumulate | Staff |
| Q | Staff notes / rationale | AI drafted, human edited; why excited or opposed, including impact/rationale | Overwrite | Staff |

Workbook audiences are historical mockup requirements, NOT the final sharing contract: Justin explicitly said Chairs sharing is changing. Q is a staff-editing requirement, not automatically a separate model call. P is a cross-task output, not necessarily its own prompt. M/N share P7. Workbook numbering does not require one provider call per number.

Flags sheet records six named flags plus Other:
1. Too applied/translational.
2. Limited impact/incremental.
3. Unclear basic science question.
4. Feasibility.
5. Overlap with existing funding.
6. Overlap with a recent Keck award.

Flags use red/yellow/green/gray; recent Keck overlap is capped at yellow. Reasons are at most 25 words, with two quotes and page/section references. Treat as requirements to review, not a finished rubric. About!B7 questions whether six flags are too many; triage rules remain provisional. Lists field/method keywords are marked D26 placeholders and must be replaced with the approved controlled lists. There are 23 populated H:N examples drawn from earlier-cycle final writeups, and no populated P open questions. Do not treat mock examples as validated prompt performance.

## Existing analogs and destinations

[VERIFIED via repository source]
- `shared/config/prompts/grantee-title.js`: `grantee-title.generate`; short “To [verb]…” objective from applicant title and abstract. Service cleanup/validation in `lib/services/grantee-title-service.js`; existing cron in `lib/services/cron/generate-grantee-titles-service.js` is scoped to invited research requests with blank destinations, NOT generic preflight.
- WMKF Project Description logical field: `akoya_request.wmkf_wmkfprojectdescription`. Justin's identification example was request 1002874: “To discover and harness the molecular machinery of human RNA repair”. Do not conflate this short objective with the executive summary.
- `shared/config/prompts/phase-i-writeup.js`: Summary section requests one paragraph, 150–200 words, covering core hypothesis/innovation, mechanism/approach, model/methodology, what is tested, and ending with major impact if successful. Full prompt additionally includes institution, short title, and four rationale bullets. Reuse the summary section, not the whole writeup.
- `shared/config/prompts/phase-i-summaries.js`: older Batch Phase I Summaries prompt; core paragraph(s) plus Impact & Timing, Funding Justification, Research Classification, Keck Foundation Alignment.
- `shared/config/prompts/phase-i-dynamics.js`: seed/legacy template for stored `phase-i.summary`, not proof of the current live row's exact text. `pages/api/phase-i-dynamics/summarize-v2.js` calls the Executor. Admin catalog places that prompt under Pre-flight.
- App registry marks the two old standalone Phase I apps as sunset candidates, with routes/code retained. Do not delete them or replace their prompts without caller review.
- Personnel, methodology, rationale, and keyword analogs still need focused discovery before new prompts are written.

## Live Admin changes completed during this session

[VERIFIED via production Admin UI readback at time of change; re-read before future edits]
1. Created `pd-assignment.expertise-match` v1, id `90ffc835-7ddd-f111-84ea-000d3a361c1f`, title “PD expertise matching”, group Pre-flight, usage unconnected.
   Inputs: `applications`, `eligible_program_directors`. Uses eligible roster instead of hardcoded BP/KM/JK/JG or Beth fallback. Retains primary/adjacent/method scoring, no workload balancing, best available match with low confidence, four JSON fields `requestnum`, `assigned_to`, `confidence`, `rationale`; deterministic roster-order tie-break. No assignment integration.
2. Published `grantee-title.generate` v2, id `da564ce6-81dd-f111-84ea-000d3a361c1f`, concrete model `claude-sonnet-5-5`, max tokens 4096; moved to Pre-flight. Task wording/output schema unchanged. Existing application usage retained. No model call or output-quality test performed.

Connor's original expertise prompt used BP/KM/JK/JG, Beth as no-overlap fallback, confidence 0–10, core-primary overlap 8–10, adjacent-core 5–7, primary-comfortable 4–6, methods +1–2, no overlap 0–2. New work must use roster eligibility and expertise as data. Consult the roster stream's actual state before connecting it.

## Executor verification and limits

[VERIFIED via source and 22 passing mocked tests]
`lib/services/execute-prompt.js` composeMessages/callProvider currently interpolates system/body and puts one cache_control marker on the system text. Proposal in user body follows that boundary. The declaration `cacheable:true` does not move it into a cached block. `applyVariableBoundaries` derives secure stable nonces using prompt name + variable + content, so wrappers differ across tasks. `lib/services/llm-client.js` passes the system array through. Executor supports JSON outputs/validation and returns/logs cache read/write token counts.
Test: `npx jest tests/unit/execute-prompt-payload-boundary.test.js --runInBand --silent` — 22/22 passed. These mocks prove construction/accounting, not provider cache hits or output quality.

Provider documentation checked 2026-11-10:
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching — prefix equality, workspace isolation, minimum lengths, default 5-minute/optional 1-hour TTL. First response must start before concurrent followers can hit a newly created cache.
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs — changing native output_config.format invalidates prompt cache; schema compilation cache is a separate mechanism.
No paid cache experiment occurred. Do not claim measured savings.

Historical Executor direction (Sessions 102/109/110) was shared Dataverse rows plus two contract-conforming runtimes; only the Vercel implementation is verified in this repo. Connor used PA + Dataverse prompts last cycle per owner testimony; that is not evidence of a generic PA executor. The newly chosen HTTP-triggered shared backend is a FUTURE change to that architectural direction. Existing contract docs still describe the as-built/deferred design; reconcile them when the new design is finalized, not by claiming an endpoint already exists.

## Proposed architecture to refine next session (NOT implementation-ready)

1. Existing prompt body becomes editable task instructions for an opt-in execution profile; retain legacy behavior for unmigrated rows. Explicit versioned profile reference and storage/schema shape require design. Group labels must not drive execution.
2. Main Admin editor shows purpose, task instructions, readable inputs/outputs; advanced settings retain model/budget/output metadata; read-only assembled preview shows machinery. Preserve versioned publishing/concurrency/audit.
3. Prepare authorized proposal documents once per workflow job, preserving page/section context, source revisions, extraction version and content hash. Secure wrapper identity stable across tasks within an authorized snapshot, not prompt name. Ambiguous/missing/oversized input fails visibly.
4. Compose shared instructions → protected proposal → cache boundary → task instructions/inputs/output instructions. Compatible model/settings share prefix. Five-minute TTL initially; measure before selecting one-hour caching. Task-specific native schemas may require separate cache groups; pilot prose tasks can use suffix output instructions and post-generation validation. Do not sacrifice validation for savings.
5. PA submits an authenticated durable job (request id, allowed tasks, idempotency key), gets job id, polls per-task status. Backend owns prompt/source authorization, model call, validation/audit and approved concurrency-safe writeback. PA owns schedule/triggers/business follow-up. Service authentication, endpoint shape, queue reuse, durable job/result storage and limits remain to be designed after source/Atlas review.
6. Freeze task/profile versions and proposal identity per job. Preserve completed results across writeback failures. Distinguish ambiguous provider outcomes from safely retryable failures. Prevent duplicate delivery from blindly repeating paid calls. Saved-result reuse is separate from provider cache TTL; protect human edits and clearing.
7. Rollout: foundation (profile/editor/composition), then executive summary plus one agreed second task with app + PA pilot, then migrate prompts individually. Verify byte-identical prefixes, mismatches, expiry, schema/model differences, unauthorized requests, duplicate delivery, partial failure and stale edits. Live metered validation requires explicit approval.

Important existing constraint: inherited J27 owner decision says apps do NOT automatically rerun or flag AI outputs when files are replaced. Snapshot identity/reuse checks apply on an explicit run; they do not authorize replacement-triggered automation. Coordinate output destinations with Request narratives and J27 streams. Chairs audiences, exact input document sets, controlled keyword lists and overwrite/versioning rules still require discussion.

## Resume and preservation

Worktree at close: `/private/tmp/wmkf-coordinated-start-2026-11-10-b` (volatile); restore from pushed branch if absent. Base `33a233633`. Main and other worktrees untouched. Local .env.local/node_modules are symlinked to main; local data targets are Production, not a sandbox. No schema/deployment/env changes or communications to Connor authorized by this handoff.

Current-session claim-evidence report unavailable (local state could not be read); no observation row invented. No memory-router changes. No DEVELOPMENT_LOG milestone entry required: only two Admin prompt/config edits and architecture discovery; no new runtime architecture/capability shipped. CLAUDE.md unchanged.
