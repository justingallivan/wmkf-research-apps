---
title: EXECUTIVE SUMMARY
domain: general
kind: audit
status: historical
summary: "Independent audit performed against all 64 memory files under .claude-memory/ (MEMORY.md plus 63 individual .md files). I did not read..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/AUDIT_S154_MEMORY.md
  - pages/api/reviewer-finder/save-candidates.js
  - pages/api/reviewer-finder/grant-cycles.js
  - docs/APPLICATION_STATE_ATLAS.md
---

# EXECUTIVE SUMMARY

Independent audit performed against all 64 memory files under `.claude-memory/` (`MEMORY.md` plus 63 individual `.md` files). I did not read `docs/AUDIT_S154_MEMORY.md`.

Overall result: the memory set is usable but has several high-impact stale items. The dangerous drift is concentrated in Reviewer Finder/Postgres-to-Dataverse migration state and intake-portal schema decisions. Several memories are procedural/user-preference guidance rather than repo-verifiable facts; those are classified as VAGUE where the claim depends on user history or external-platform state instead of live repo state.

Highest-priority corrections:

- `project_reviewer_finder_dataverse_entry_path.md` is materially stale. It still says broad Reviewer Finder flows run on Postgres and names deleted endpoints (`researchers.js`, `extract-summary.js`). Live code and Atlas show those readers/writers were retired or cut over.
- `project_reviewer_accept_decline_links.md` is stale. It says accept/decline-specific click flow and `/api/external/review/[token]/respond` are unbuilt; the route now exists and writes accept/decline state.
- `project_reviewer_postgres_to_dataverse_migration.md` is internally stale and contradicts `project_w6_table_drop_pending.md` on cleanup-cron vs. one-shot drain-only table deletion.
- `project_intake_portal_pilot_decisions_2026-05-13.md` was superseded by 2026-05-14 schema decisions: roster is no longer a new `wmkf_proposalroster` entity and `lib/dataverse/schema/intake/` does not exist.
- Some doc path references are stale because live docs were archived (`docs/IT_SECURITY_RESPONSE.md`, `docs/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`, `docs/CONNOR_INTAKE_PORTAL_SYNC.md`, `docs/CODE_REVIEW_RESPONSE_2026-04-30.md`, `docs/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md`).

# STALE

## MEMORY.md

Claim: `.claude-memory/MEMORY.md:74` says: “Reviewer Finder Dataverse-native entry path — per-proposal picker + save-candidates SHIPPED; Postgres reviewer tables still load-bearing until migration ships”

Evidence: `pages/api/reviewer-finder/save-candidates.js:4-10` says saves go to Dataverse and “Postgres is no longer written”; `pages/api/reviewer-finder/grant-cycles.js:9-15` says “W3 cutover (2026-05-12) — Dataverse-only”; `docs/APPLICATION_STATE_ATLAS.md:99-102` says researcher/publication/suggestion methods were gutted/removed in W5; `docs/atlas/postgres-researchers.md:51` says the last live reader `researchers.js` was retired.

Conclusion: STALE. The index carries the older “still load-bearing” framing even though major Postgres readers/writers named by the linked memory have already been cut over or retired.

## project_reviewer_finder_dataverse_entry_path.md

Claim: `.claude-memory/project_reviewer_finder_dataverse_entry_path.md:12` says: “Postgres reviewer tables are NOT dormant. Audit 2026-05-03 found `researchers`, `publications`, `reviewer_suggestions`, `proposal_searches`, `grant_cycles` are still load-bearing for the broader Reviewer Finder app — `pages/api/reviewer-finder/researchers.js` (browse/manage), `extract-summary.js`, `generate-emails.js`, `grant-cycles.js`, and `my-proposals.js` all still read/write Postgres.”

Evidence: `rg --files | rg '^pages/api/reviewer-finder/(researchers|extract-summary)\.js$'` returns no active source files. `docs/atlas/postgres-researchers.md:51` says `researchers.js` was retired and no live application code reads the table. `pages/api/reviewer-finder/grant-cycles.js:9-15` says the route is Dataverse-only. `pages/api/reviewer-finder/my-proposals.js:124-130` builds a Dataverse `akoya_request` filter, not a Postgres query. `docs/API_ROUTE_SECURITY_MATRIX.md:121-122` says `my-proposals` reads Dataverse and `save-candidates` writes Dataverse.

Conclusion: STALE. This was correct on 2026-05-03 but is now wrong as operational guidance.

Claim: `.claude-memory/project_reviewer_finder_dataverse_entry_path.md:17` says: “Do NOT drop the Postgres reviewer tables without a broader migration of the browse/email/summary flows.”

Evidence: `project_w6_table_drop_pending.md:10-16` now defines a future table-drop trigger for `researchers`, `researcher_keywords`, `publications`, and `proposal_searches`; `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:799-801` says W6 retired `researchers.js` and defers drain-only table drop to post-pilot.

Conclusion: STALE without qualification. It should now say the four drain-only tables are scheduled for verified post-pilot deletion, not categorically “do not drop.”

## project_reviewer_accept_decline_links.md

Claim: `.claude-memory/project_reviewer_accept_decline_links.md:16-20` says: “What is NOT yet built … Dedicated Accept / Decline buttons … `pages/review-response.js` and `pages/api/review-response/confirm.js` were never created … Auto-fill of `response_received_at` / `accepted` / `declined` from a click action.”

Evidence: `pages/api/external/review/[token]/respond.js:2-12` is a unified accept/decline endpoint; `pages/api/external/review/[token]/respond.js:66-68` validates `action` as `accept` or `decline`; `lib/dataverse/adapters/reviewer-suggestion.js:444-469` writes `wmkf_accepted`, `wmkf_declined`, `wmkf_responsetype`, and `wmkf_responsereceivedat`. `docs/API_ROUTE_SECURITY_MATRIX.md:86` catalogs `/api/external/review/[token]/respond` as “Token-scoped accept/decline.”

Conclusion: STALE. The old proposed `review-response` filenames still do not exist, but the capability moved to `/api/external/review/[token]/respond` and is now built.

Claim: `.claude-memory/project_reviewer_accept_decline_links.md:23` says: “If accept/decline buttons come up again, build them … and a `/api/external/review/[token]/respond` endpoint.”

Evidence: `pages/api/external/review/[token]/respond.js:1-181` exists.

Conclusion: STALE as future work. The endpoint already exists.

## project_reviewer_postgres_to_dataverse_migration.md

Claim: `.claude-memory/project_reviewer_postgres_to_dataverse_migration.md:22` says: “Cleanup cron runs weekly; only acts twice a year.”

Evidence: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:799` says “cleanup cron + restore script” was deferred and recommends a one-shot DELETE path instead. `project_w6_table_drop_pending.md:14` says the cleanup cron was deferred in favor of one-shot DELETE. `lib/services/maintenance-service.js` contains no reviewer cleanup cron; `rg -n "reviewer-cleanup|cleanup cron" pages/api lib/services` returns no built route/service.

Conclusion: STALE. The memory still describes a cron design that was explicitly deferred.

Claim: `.claude-memory/project_reviewer_postgres_to_dataverse_migration.md:33` says: “Batched lookup: new endpoint `/api/reviewer-finder/contact-history` POST `{ contactIds }`.”

Evidence: `pages/api/reviewer-finder/contact-history.js:4` says the route is GET for a single contact; `pages/api/reviewer-finder/contact-history.js:62-64` rejects non-GET methods; `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:557` says the earlier batched POST shape “was never built” and is a post-pilot enhancement.

Conclusion: STALE. The live route is single-contact GET, not batched POST.

Claim: `.claude-memory/project_reviewer_postgres_to_dataverse_migration.md:66-75` describes S136 live Postgres state and says data were 2026-01-03 to 2026-04-30.

Evidence: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:797-799` says later W3/W4/W5/W6 work shipped after S136, including grant-cycle cutover, reviewer-suggestion reader cutover, `extract-summary` retirement, and `researchers.js` retirement.

Conclusion: STALE as current state. Keep only as historical context.

## project_w6_table_drop_pending.md

Claim: `.claude-memory/project_w6_table_drop_pending.md:33` says: “Be aware of `proposal_searches` JOIN site mentioned in `docs/atlas/postgres-other-reviewer-tables.md:25` — that JOIN was in `grant-cycles.js`; verify … that it was killed in W3.”

Evidence: `pages/api/reviewer-finder/grant-cycles.js:62-66` fetches Dataverse cycles/counts and has no `proposal_searches` JOIN. However, `docs/atlas/postgres-other-reviewer-tables.md:25` still says a `proposal_searches` JOIN in `grant-cycles.js` is load-bearing.

Conclusion: The memory’s instruction to verify is sound, but the cited Atlas note is stale. Treat the memory as CLEAN for action, with a stale dependency in the referenced Atlas page.

## project_app_roadmap_2026-04-25.md

Claim: `.claude-memory/project_app_roadmap_2026-04-25.md:9` says: “Concept Evaluator — being deprecated. Don’t migrate its prompt. Eventually remove from `appRegistry.js`, archive `pages/concept-evaluator.js` and `pages/api/evaluate-concepts.js`, drop from CLAUDE.md app table.”

Evidence: `shared/config/appRegistry.js:9-13` says Concept Evaluator was deprecated and page/API/prompt were archived to `/_archived`. `rg --files | rg '(^pages/concept-evaluator\.js$|^pages/api/evaluate-concepts\.js$)'` returns no active files; `_archived/pages/concept-evaluator.js` and `_archived/pages/api/evaluate-concepts.js` exist.

Conclusion: STALE as future work. The deprecation/archive has already happened.

## project_codex_recurring_review.md

Claim: `.claude-memory/project_codex_recurring_review.md:7` says: “The 2026-04-30 review (`docs/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md`) is the first one; my response is in `docs/CODE_REVIEW_RESPONSE_2026-04-30.md`.”

Evidence: active root paths do not exist. `rg --files | rg '^docs/CODE_REVIEW_(FRAGILITY_FINDINGS|RESPONSE)_2026-04-30\.md$'` returns no rows. Archived files exist at `docs/archive/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md` and `docs/archive/CODE_REVIEW_RESPONSE_2026-04-30.md`.

Conclusion: STALE path references. The content exists but moved to `docs/archive/`.

Claim: `.claude-memory/project_codex_recurring_review.md:16` says: “`docs/API_ROUTE_SECURITY_MATRIX.md` is the living artifact (untracked in our repo, owned by the Codex session).”

Evidence: `docs/API_ROUTE_SECURITY_MATRIX.md` exists in the repo and `CLAUDE.md:245` calls it the full route catalogue, “CI-gated via `npm run check:api-routes`.”

Conclusion: STALE. It is no longer accurate to call it untracked/outside the repo.

## project_sharepoint_integration.md

Claim: `.claude-memory/project_sharepoint_integration.md:17` says: “IT security response: `docs/IT_SECURITY_RESPONSE.md`.”

Evidence: `rg --files | rg '^docs/IT_SECURITY_RESPONSE\.md$'` returns no active file. `docs/archive/IT_SECURITY_RESPONSE.md` exists.

Conclusion: STALE path reference. The doc was archived.

## project_intake_portal_external_id_foundation.md

Claim: `.claude-memory/project_intake_portal_external_id_foundation.md:40` says: “Reference: `docs/INTAKE_PORTAL_DESIGN.md`, `docs/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`.”

Evidence: active `docs/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md` does not exist. `docs/archive/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md` exists. The active design doc exists at `docs/INTAKE_PORTAL_DESIGN.md`.

Conclusion: STALE path reference for the IT tenant-request doc.

## project_intake_portal_pilot_decisions_2026-05-06.md

Claim: `.claude-memory/project_intake_portal_pilot_decisions_2026-05-06.md:9` says: “Walked through `docs/CONNOR_INTAKE_PORTAL_SYNC.md` with Connor…”

Evidence: active `docs/CONNOR_INTAKE_PORTAL_SYNC.md` does not exist; `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` exists.

Conclusion: STALE path reference. The memory correctly notes some decisions are superseded, but the referenced doc path moved.

Claim: `.claude-memory/project_intake_portal_pilot_decisions_2026-05-06.md:28` says: “Suggested entity set: `wmkf_budgetline`, `wmkf_personnel`, `wmkf_priorsupport`, `wmkf_milestone`.”

Evidence: the same memory flags this as superseded at lines 3 and 7. `docs/INTAKE_PORTAL_DESIGN.md:587-588` says the 2026-05-14 refinement is budget = `wmkf_proposalbudgetline`; roster = extension of `wmkf_apprequestperson`; milestones and prior support are deferred.

Conclusion: STALE but self-marked as superseded. Keep only if future readers do not miss the top warning.

## project_intake_portal_pilot_decisions_2026-05-13.md

Claim: `.claude-memory/project_intake_portal_pilot_decisions_2026-05-13.md:20` says: “Structured-tables persistence … narrowed scope to budget + roster only. Milestones → narrative field for pilot; prior support → attached PDF for pilot. JSON specs drafted by 2026-05-15, applied by 2026-05-18.”

Evidence: `docs/INTAKE_PORTAL_DESIGN.md:587-588` says the 2026-05-14 refinement changed the shape: budget is a new `wmkf_proposalbudgetline` entity, roster extends existing `wmkf_apprequestperson`, no new `wmkf_proposalroster`; child-entity naming alignment is closed. `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:38-40` explicitly says “Roster — extend `wmkf_apprequestperson`, do NOT create `wmkf_proposalroster`.”

Conclusion: STALE. The May 13 decision was refined the next day.

Claim: `.claude-memory/project_intake_portal_pilot_decisions_2026-05-13.md:30` says: “Two JSON schema specs under `lib/dataverse/schema/intake/` (budget + roster) — draft after naming resolves with Connor.”

Evidence: `find lib/dataverse/schema -maxdepth 3 -type d` lists `roles`, `wave1`, `wave2`, `wave2-existing`, and `wave3`; there is no `lib/dataverse/schema/intake/`. `docs/INTAKE_PORTAL_DESIGN.md:587-588` says roster is not a new entity, so there should not be a roster JSON spec under that path.

Conclusion: STALE. The path and “two specs” plan do not match current repo state.

## feedback_human_legibility_schema_principle.md

Claim: `.claude-memory/feedback_human_legibility_schema_principle.md:16` says: “New entities are still right when they have a different parent, different lifecycle, or genuinely different shape (e.g., `wmkf_proposalroster` per-person vs `wmkf_proposalbudgetline` per-amount).”

Evidence: `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:38-40` says the 2026-05-13 `wmkf_proposalroster` plan is withdrawn and roster data lives in existing `wmkf_apprequestperson`. `docs/INTAKE_PORTAL_DESIGN.md:587` repeats that roster is an extension of `wmkf_apprequestperson`, not a new `wmkf_proposalroster` entity.

Conclusion: STALE example. The principle is still clean, but the example should be updated because it now names a rejected entity.

## project_prompt_storage_strategy.md

Claim: `.claude-memory/project_prompt_storage_strategy.md:32-36` says Phase 0 is “by May 1 2026” and lists Connor adding fields and Justin building `executePrompt()` / refactoring `summarize-v2.js` as future/in-progress work.

Evidence: `lib/services/execute-prompt.js:2-4` identifies the Phase 0 Executor implementation; `pages/api/phase-i-dynamics/summarize-v2.js:27` imports `executePrompt`; `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md:48-67` documents `wmkf_ai_prompt` rows and the v3 Executor path as live.

Conclusion: STALE if read as current work. The architectural decisions remain useful, but the Phase 0 delivery checklist is historical.

# CONTRADICTORY

## project_reviewer_postgres_to_dataverse_migration.md vs project_w6_table_drop_pending.md

Claim A: `.claude-memory/project_reviewer_postgres_to_dataverse_migration.md:22` says: “Cleanup cron runs weekly; only acts twice a year.”

Claim B: `.claude-memory/project_w6_table_drop_pending.md:14` says: “Codex recommended deferring [cleanup cron] per the Wave 1 precedent … one-shot DELETE … Building a cron that sits in dry-run during an active pilot is maintained surface for noise nobody reads.”

Evidence: `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:799-801` contains both the old cron framing and the later W6 deferral, but the W6 row is the newer, more specific post-pilot checklist. `lib/services/maintenance-service.js` has no reviewer cleanup cron and `pages/api/cron/` has no reviewer cleanup route.

Conclusion: CONTRADICTORY. The older migration memory should defer to `project_w6_table_drop_pending.md` and the post-pilot row in the plan.

## project_intake_portal_pilot_decisions_2026-05-13.md vs feedback_human_legibility_schema_principle.md / current docs

Claim A: `.claude-memory/project_intake_portal_pilot_decisions_2026-05-13.md:24` says naming alignment remained open between `wmkf_proposalroster` and `wmkf_personnel`.

Claim B: `.claude-memory/feedback_human_legibility_schema_principle.md:12` documents the next-day decision to reduce table proliferation; current docs apply that principle to roster.

Evidence: `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:38-40` says “Roster — extend `wmkf_apprequestperson`, do NOT create `wmkf_proposalroster`.” `docs/INTAKE_PORTAL_DESIGN.md:588` says child-entity naming alignment closed on 2026-05-14.

Conclusion: CONTRADICTORY as a memory set. The May 13 file should be explicitly marked superseded by the May 14 schema-review memory/docs.

## project_dynamics_ai_writeback.md vs docs/atlas/dataverse-akoya-request.md

Claim: `.claude-memory/project_dynamics_ai_writeback.md:43` says: “Field Set D (PD Assignment): DEPLOYED — writes to existing `wmkf_programdirector` lookup.”

Conflicting ground truth: `docs/atlas/dataverse-akoya-request.md:50` says: “`wmkf_ai_fitassessment` (Picklist) + `wmkf_ai_fitrationale` (Memo) — Field Set D: ready.”

Evidence on the memory side: `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md:107-111` and `docs/GRANT_CYCLE_LIFECYCLE.md:100` both agree that Field Set D is PD Assignment and writes to `wmkf_programdirector`. Evidence on the Atlas side: `shared/config/prompts/dynamics-explorer.js:96` documents `wmkf_ai_fitrationale`, and `docs/EXECUTOR_EXTENSIONS_PLAN.md:190-202` references `wmkf_ai_fitassessment`.

Conclusion: CONTRADICTORY ground truth, not a simple memory error. The memory aligns with the v3 spec, but the Atlas labels fit-assessment fields as “Field Set D.” Before implementing against “Field Set D,” resolve the naming collision.

# VAGUE

These files contain mostly behavioral guidance, user preference, or external/session history that cannot be fully verified from the live repo alone. Where they name repo artifacts, I checked those artifacts; the remaining claims are classified VAGUE because they depend on user/session facts or external systems.

## feedback_check_memory_before_asking_user.md

Claim: `.claude-memory/feedback_check_memory_before_asking_user.md:9` says the answer to “IT email actually sent Monday” was already in memory.

Evidence: `.claude-memory/project_intake_portal_external_id_foundation.md:7-23` documents the External ID foundation in code; `pages/api/auth/[...nextauth].js:54-84` verifies the `entra-external` provider. The actual email-send event is not verifiable from repo state.

Conclusion: VAGUE/procedural. The repo supports the auth-foundation claim, not the historical “IT email sent” fact.

## feedback_codex_verbatim_output.md

Claim: `.claude-memory/feedback_codex_verbatim_output.md:10-17` describes how to return `codex:codex-rescue` output verbatim and references `codex:codex-result-handling`.

Evidence: no active repo file or available skill path in this workspace verifies `codex:codex-rescue` or `codex:codex-result-handling`.

Conclusion: VAGUE/procedural. Treat as user preference, not repo state.

## feedback_concepts_vs_phase_i.md

Claim: `.claude-memory/feedback_concepts_vs_phase_i.md:7-15` distinguishes concept PDFs from Phase I PDFs and gives filename regex guidance.

Evidence: `.claude-memory/project_staged_review_pipeline.md:7-16` supports a staged review model, but the actual SharePoint/PDF corpus is not present in the repo for verification.

Conclusion: VAGUE with clean internal consistency. The claim may be true operationally, but it is not repo-verifiable.

## feedback_cycle_vs_executor_scope.md

Claim: `.claude-memory/feedback_cycle_vs_executor_scope.md` says cycle timing gates Connor/PA/permissions work, not every Claude-using app, and user-facing apps like Reviewer Finder are independent.

Evidence: `docs/EXECUTOR_CONTRACT.md:12-14` supports Executor as a specific PA/Vercel prompt contract; `shared/config/appRegistry.js:70-83` shows Reviewer Finder/Review Manager are normal app entries.

Conclusion: VAGUE but directionally supported. The “cycle gating” policy is a planning convention, not live code state.

## feedback_review_panel_tone.md

Claim: tone should balance critique with upside and not mimic conservative study sections.

Evidence: `shared/config/prompts/virtual-review-panel.js` exists, but tone calibration is subjective and user-feedback based.

Conclusion: VAGUE/user preference.

## feedback_surface_full_review_findings.md

Claim: always surface all external-review findings with reviewer labels.

Evidence: no source code governs assistant response formatting.

Conclusion: VAGUE/procedural.

## feedback_thoroughness_default.md

Claim: skimming, banner-only edits, and same-frame rereads are unacceptable shortcuts.

Evidence: `CLAUDE.md:19-34` supports probe-before-plan and red-gate rigor, but the memory is mainly user preference.

Conclusion: VAGUE/procedural.

## feedback_verify_before_destructive_carryover.md

Claim: `.claude-memory/feedback_verify_before_destructive_carryover.md:13` says on 2026-05-03 the Reviewer Finder Postgres tables had 20+ live UPDATE sites and active reads in named files.

Evidence: current live repo no longer has some named files (`researchers.js`, `extract-summary.js`), but `CLAUDE.md:11-17` codifies the carryover hygiene rule and `docs/APPLICATION_STATE_ATLAS.md:99-102` shows those paths were later removed/cut over.

Conclusion: VAGUE/historical. The rule is clean; the historical live-site count is not verifiable from current repo state.

## feedback_verify_external_platform_claims.md

Claim: verify Dataverse/PA/Azure/Vercel behavior via authoritative docs before stating platform behavior.

Evidence: repo cannot verify external platform behavior. `CLAUDE.md:19-28` supports probing live state before plans, but WebFetch/doc-checking behavior is outside repo state.

Conclusion: VAGUE/procedural.

## project_akoya_request_pd_fields.md

Claim: `wmkf_programdirector` is lead PD; `wmkf_programdirector2` does not assign reviewers; `ownerid` is the integration service account.

Evidence: `pages/api/reviewer-finder/my-proposals.js:12-13` says the picker filters on `_wmkf_programdirector_value` and `wmkf_programdirector2` does not assign reviewers; `docs/atlas/dataverse-akoya-request.md:37` documents the two lookups. The `ownerid` operational assertion is not verified by source code.

Conclusion: VAGUE only for `ownerid`; otherwise clean.

## project_dataverse_creator_privileges.md

Claim: Connor delegated creator privileges and summary-after model.

Evidence: `docs/INTAKE_PORTAL_DESIGN.md:155` says the repo owns pilot schema work directly with Connor looped in. Actual privilege delegation is external Dataverse/admin state.

Conclusion: VAGUE/external permission state.

## project_dynamics_crm_users.md

Claim: 16 licensed staff and ~180 service accounts; OBO not recommended.

Evidence: `docs/atlas/dataverse-akoya-request.md` and `CLAUDE.md` do not verify tenant user counts; external Dynamics tenant state would be required.

Conclusion: VAGUE/external tenant state.

## project_dynamics_crm_limitations.md

Claim: OData limitations such as `$skip` unsupported, `$count` failures with complex filters, formatted fields not selectable.

Evidence: live code uses `DynamicsService.queryAllRecords` and Dataverse patterns, but these platform claims require external/API verification.

Conclusion: VAGUE/platform behavior.

## project_dynamics_explorer_details.md

Claim: Dataverse Search API enabled with 77K+ docs and perf optimizations.

Evidence: `pages/api/dynamics-explorer/chat.js` and `shared/config/prompts/dynamics-explorer.js` exist; repo cannot verify live Dataverse Search index size or tenant enablement.

Conclusion: VAGUE for live tenant/search count.

## project_dynamics_identity_reconciliation.md

Claim: delegate role granted, impersonation smoke PASS, 333/333 test suite.

Evidence: `lib/services/dynamics-identity-service.js`, `pages/api/cron/reconcile-identities.js`, `scripts/reconcile-dynamics-identities.js`, and `tests/unit/dynamics-service-caller-id.test.js` exist. Live delegate role state and historical suite result are not repo-verifiable.

Conclusion: VAGUE for live permission/test-history claims; code-path references are clean.

## project_grant_lifecycle_states_confirmed.md

Claim: D26 counts and `wmkf_phaseiistatus IS NULL` correlation from production samples.

Evidence: `pages/api/reviewer-finder/my-proposals.js:124-130` verifies the current `Phase II Pending` + `wmkf_phaseiistatus eq null` actionable filter; `docs/atlas/dataverse-akoya-request.md:19` verifies `akoya_requeststatus` is a string with those values. Historical D26 distribution cannot be verified from repo.

Conclusion: VAGUE for production sample counts; clean for code filter.

## project_reviewer_count_invariant.md

Claim: need 3 confirmed reviewers per proposal; 5 potential-reviewer slots are over-invite buffer.

Evidence: reviewer-suggestion adapters and Review Manager code support lifecycle tracking, but the “3 confirmed” policy is business logic not centrally enforced in code.

Conclusion: VAGUE/business rule.

## project_reviewer_history_data_quality.md

Claim: pre-J26 proposals have no Postgres rows; zeros mean unknown.

Evidence: current Atlas documents migrations and row counts, but not the historical pre-J26 absence in a way the repo can prove.

Conclusion: VAGUE/historical data quality.

## user_powerautomate.md

Claim: Justin has no PowerAutomate experience; Connor has used it.

Evidence: no repo artifact can verify user skill levels.

Conclusion: VAGUE/user context.

# CLEAN

The following files were read in full and their concrete repo claims were verified or found to be historical/procedural without stale repo references:

- `feedback_red_gates_are_p0.md` — matches `CLAUDE.md:19-34` and `docs/CLAUDE_REMEDIATION_PLAN.md`.
- `project_admin_dashboard.md` — `/admin`, `api_usage_log`, server-side `CLAUDE_API_KEY`, and admin surfaces are present (`pages/admin.js`, `docs/atlas/postgres-infra-tables.md:86`, `CLAUDE.md:100-120`).
- `project_api_credit_monitoring.md` — `/api/cron/spend-check`, alert env vars, `api_usage_log`, and low-balance email path exist (`pages/api/cron/spend-check.js:1-158`; `docs/CREDENTIALS_RUNBOOK.md:119`).
- `project_app_access_control.md` — `wmkf_appuserappaccesses`, `shared/config/appRegistry.js`, `shared/context/AppAccessContext.js`, `DEFAULT_APP_GRANTS`, and `requireAppAccess` posture are verified (`shared/config/appRegistry.js:8-168`; `CLAUDE.md:142-149`; `docs/API_ROUTE_SECURITY_MATRIX.md`).
- `project_backend_automation.md` — aligns with `docs/EXECUTOR_CONTRACT.md` and prompt/PA strategy docs.
- `project_contact_promotion_permission.md` — `pages/api/review-manager/send-emails.js:13-18` and adapter imports confirm promotion/contact-link flow.
- `project_dataverse_schema_deploy_gotchas.md` — `scripts/apply-dataverse-schema.js` exists and repo code uses Dataverse nav-prop binding conventions; no contradictory source found.
- `project_dev_environment.md` — `.env.local:22`, `.env.local:31`, `.env.local:78-80`, and `CLAUDE.md:116` verify auth/dev flag claims.
- `project_dynamics_ai_writeback.md` — v3 spec, scripts, writeback fields, and test scripts exist; note the Field Set D naming contradiction recorded above.
- `project_dynamics_as_prompt_ground_truth.md` — `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md:48-71`, `lib/services/execute-prompt.js`, and seed scripts verify `wmkf_ai_prompt` direction.
- `project_dynamics_email.md` — `scripts/test-dynamics-email.js`, `/api/test-email`, and `DynamicsService` email methods exist.
- `project_dynamics_explorer_archive_libs.md` — `lib/utils/sharepoint-buckets.js` and `pages/api/dynamics-explorer/chat.js` support active + archive library traversal.
- `project_dynamics_explorer_schema_diff.md` — `scripts/dynamics-schema-diff.js`, `scripts/dynamics-schema-map.js`, and `shared/config/prompts/dynamics-explorer.js` exist; generated `scripts/dynamics-schema-diff.json` is expected to be gitignored/transient.
- `project_dynamics_explorer_serializer_deferred.md` — serializer, chat wiring, and unit/integration tests exist.
- `project_external_reviewer_file_access.md` — `lib/external/*`, `/external/review/[token]`, tokenized endpoints, SharePoint upload/writeback paths, and middleware allowlist exist (`CLAUDE.md:204-208`; `docs/API_ROUTE_SECURITY_MATRIX.md:82-86`).
- `project_grant_phasing_evolution.md` — strategic phasing claims align with `docs/STRATEGY.md` and intake design docs.
- `project_intake_meeting_agenda_cleanup.md` — trigger is future relative to this audit date; active agenda file exists in `docs/` and archive precedent exists.
- `project_intake_portal_skinny_scope.md` — `docs/INTAKE_PORTAL_DESIGN.md:24-35` verifies skinny pilot posture.
- `project_interim_report_automation.md` — `pages/api/grant-reporting/extract.js` and SharePoint helpers exist; blocked/future automation framing is consistent.
- `project_irs_exempt_verification.md` — migration 008, service, cron, verify endpoint, middleware allowlist, and Vercel schedule all exist (`lib/db/migrations/008_irs_exempt_orgs.sql`; `lib/services/irs-bmf-service.js`; `pages/api/cron/refresh-irs-bmf.js`; `pages/api/irs/verify-ein.js`; `vercel.json:45-46`; `middleware.js:131-133`).
- `project_machine_legible_form_capture.md` — `docs/INTAKE_PORTAL_DESIGN.md:20`, `:382-388`, and `shared/forms/phase-ii-research-2026-06/schema.js` support structured capture.
- `project_new_ai_capabilities.md` — broad strategy; no stale concrete repo path found.
- `project_pdf_processing_tiers.md` — consistent with codebase split between text extraction and selective PDF/media handling.
- `project_phase_i_summary_app_winddown.md` — `/phase-i-dynamics`, summarize routes, and A/B scripts exist; CLAUDE notes direct-URL test app.
- `project_proposal_context_extraction.md` — `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md` exists.
- `project_reviewer_lifecycle.md` — lifecycle fields and Review Manager routes exist in adapters and `pages/api/review-manager/*`.
- `project_reviewer_lifecycle_automation.md` — manual timestamp/status fields exist and automation-goal framing is still future-compatible.
- `project_staged_review_pipeline.md` — `docs/STAGED_REVIEW_PIPELINE.md` and `docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md` exist; VRP service files exist.
- `project_strategy_direction.md` — aligns with `docs/STRATEGY.md`.
- `project_virtual_review_panel.md` — app registry entry, page/API route, services, prompts, env vars, and Postgres tables are verified (`shared/config/appRegistry.js:141-149`; `lib/db/migrations/003_virtual_review_panel.sql:9-61`; `docs/API_ROUTE_SECURITY_MATRIX.md:130`).
- `project_wave1_onboarding.md` — accurately describes a not-yet-built helper (`lib/services/onboarding.js` absent) and existing auth/default grant wiring (`pages/api/auth/[...nextauth].js:155-183`, `:310-320`).
- `project_wave1_pending.md` — migration 007 exists; `CLAUDE.md:116` and services confirm Dataverse default / loud-fail posture.

# METHODOLOGY NOTES

Read coverage:

- Enumerated `find .claude-memory -type f -name '*.md' | sort` and confirmed 64 files.
- Read all 64 files in full using line-numbered output. Some terminal output was truncated in the UI due to size, so targeted re-reads were performed for every file that produced concrete findings.
- Did not read `docs/AUDIT_S154_MEMORY.md`.

Verification sources used:

- Repo conventions: `CLAUDE.md`.
- Data/source-of-truth docs: `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/*.md`, `docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`, `docs/INTAKE_PORTAL_DESIGN.md`, `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`.
- Code: `shared/config/appRegistry.js`, `lib/db/migrations/*.sql`, `lib/services/*`, `lib/dataverse/adapters/*`, `lib/external/*`, `pages/api/**`, relevant pages/scripts/tests.

Commands used included `find`, `wc -l`, `nl -ba`, `rg --files`, `rg -n`, targeted `sed`, and file existence checks. For missing-file evidence, absence from `rg --files` was treated as staleness unless the file existed under `docs/archive/` or `_archived/`, in which case the finding is “stale path” rather than “missing content.”

Coverage by file:

- STALE: `MEMORY.md`, `feedback_human_legibility_schema_principle.md`, `project_app_roadmap_2026-04-25.md`, `project_codex_recurring_review.md`, `project_intake_portal_external_id_foundation.md`, `project_intake_portal_pilot_decisions_2026-05-06.md`, `project_intake_portal_pilot_decisions_2026-05-13.md`, `project_prompt_storage_strategy.md`, `project_reviewer_accept_decline_links.md`, `project_reviewer_finder_dataverse_entry_path.md`, `project_reviewer_postgres_to_dataverse_migration.md`, `project_sharepoint_integration.md`, `project_w6_table_drop_pending.md`.
- CONTRADICTORY: `project_reviewer_postgres_to_dataverse_migration.md`, `project_w6_table_drop_pending.md`, `project_intake_portal_pilot_decisions_2026-05-13.md`, `feedback_human_legibility_schema_principle.md`, `project_dynamics_ai_writeback.md`.
- VAGUE: `feedback_check_memory_before_asking_user.md`, `feedback_codex_verbatim_output.md`, `feedback_concepts_vs_phase_i.md`, `feedback_cycle_vs_executor_scope.md`, `feedback_review_panel_tone.md`, `feedback_surface_full_review_findings.md`, `feedback_thoroughness_default.md`, `feedback_verify_before_destructive_carryover.md`, `feedback_verify_external_platform_claims.md`, `project_akoya_request_pd_fields.md`, `project_dataverse_creator_privileges.md`, `project_dynamics_crm_limitations.md`, `project_dynamics_crm_users.md`, `project_dynamics_explorer_details.md`, `project_dynamics_identity_reconciliation.md`, `project_grant_lifecycle_states_confirmed.md`, `project_reviewer_count_invariant.md`, `project_reviewer_history_data_quality.md`, `user_powerautomate.md`.
- CLEAN: `feedback_red_gates_are_p0.md`, `project_admin_dashboard.md`, `project_api_credit_monitoring.md`, `project_app_access_control.md`, `project_backend_automation.md`, `project_contact_promotion_permission.md`, `project_dataverse_schema_deploy_gotchas.md`, `project_dev_environment.md`, `project_dynamics_as_prompt_ground_truth.md`, `project_dynamics_email.md`, `project_dynamics_explorer_archive_libs.md`, `project_dynamics_explorer_schema_diff.md`, `project_dynamics_explorer_serializer_deferred.md`, `project_external_reviewer_file_access.md`, `project_grant_phasing_evolution.md`, `project_intake_meeting_agenda_cleanup.md`, `project_intake_portal_skinny_scope.md`, `project_interim_report_automation.md`, `project_irs_exempt_verification.md`, `project_machine_legible_form_capture.md`, `project_new_ai_capabilities.md`, `project_pdf_processing_tiers.md`, `project_phase_i_summary_app_winddown.md`, `project_proposal_context_extraction.md`, `project_reviewer_lifecycle.md`, `project_reviewer_lifecycle_automation.md`, `project_staged_review_pipeline.md`, `project_strategy_direction.md`, `project_virtual_review_panel.md`, `project_wave1_onboarding.md`, `project_wave1_pending.md`.

One caveat: I did not query live Dataverse, SharePoint, Vercel, PowerAutomate, or external platform docs. Claims that require those systems are marked VAGUE unless the repo contains a current source-of-truth document or code path that verifies the claim.
