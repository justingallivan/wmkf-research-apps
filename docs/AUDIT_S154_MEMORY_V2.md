---
title: "Memory Audit V2 — Session 154 (Lane 3, redone)"
domain: general
kind: audit
status: historical
summary: "Date: 2026-05-14 Scope: Same as V1 — every file under .claude-memory/ (64 files)."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/atlas/postgres-researchers.md
  - docs/atlas/postgres-other-reviewer-tables.md
  - docs/EXECUTOR_CONTRACT.md
  - shared/config/appRegistry.js
---

# Memory Audit V2 — Session 154 (Lane 3, redone)

**Date:** 2026-05-14
**Scope:** Same as V1 — every file under `.claude-memory/` (64 files).
**Method change vs V1:** Five discipline commitments enforced (see end of doc). Concretely: every named identifier per memory checked; negative claims (`NOT yet built`, `do NOT drop`, `still load-bearing`) grepped for the negated thing; memory creation date treated as upper bound (cross-checked against newer docs); Atlas pages cross-read for entity claims; every "clean" classification re-justified before commit.

No memory edits applied during this audit.

---

## Findings by memory (per-file evidence, not category-grouped)

### `MEMORY.md` (index)

- **Line 74:** "Reviewer Finder Dataverse-native entry path — per-proposal picker + save-candidates SHIPPED; **Postgres reviewer tables still load-bearing until migration ships**" — **STALE.** The "still load-bearing" framing is wrong. `pages/api/reviewer-finder/researchers.js` was deleted W6 (per `docs/atlas/postgres-researchers.md:51`); `extract-summary.js` was retired W5 step 5 (per `docs/atlas/postgres-other-reviewer-tables.md:23`). `generate-emails.js` has zero `@vercel/postgres` imports today. The picker, save-candidates, grant-cycles, and contact-history are all Dataverse-only.
- All other index entries: links resolve to files that exist; descriptions match (modulo per-file findings below).

### `feedback_check_memory_before_asking_user.md`
- Verified — behavioral rule. Single historical reference (`project_intake_portal_external_id_foundation.md` content) confirmed. CLEAN.

### `feedback_codex_verbatim_output.md`
- Verified — `codex:codex-rescue` skill is present at `~/.claude/plugins/cache/openai-codex/codex/1.0.4/agents/codex-rescue.md` and is callable via the `Skill`/`Agent` tools (used live in this session). Codex V1 audit marked this VAGUE because it couldn't find the skill path; in this workspace it's reachable. CLEAN.

### `feedback_concepts_vs_phase_i.md`
- Behavioral rule + filename regex guidance. Supporting context ("Phase I may be eliminated") is now confirmed by `project_grant_phasing_evolution.md` — concepts ARE going away next cycle. The "may shift" hedge is softer than reality.
- **Suggested edit:** tighten hedge to "concepts going away next cycle (confirmed); rule applies through current J26/D26."
- CLEAN with hedge-softening opportunity.

### `feedback_cycle_vs_executor_scope.md`
- Verified — `docs/EXECUTOR_CONTRACT.md` exists; Reviewer Finder is a normal app entry in `shared/config/appRegistry.js`; no PA-trigger plan for it. CLEAN.

### `feedback_human_legibility_schema_principle.md`
- **Line 16 example STALE.** Uses `wmkf_proposalroster` as an example of "still right" new-entity. But `wmkf_proposalroster` was rejected (2026-05-14, per `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:40`). The example now contradicts the rule's *application*. Principle stands; example must change.
- **Suggested edit:** swap to a different example or add "(was a candidate; ultimately decided against — see `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md`)".
- Verified rest: 2026-05-14 schema review doc exists.

### `feedback_red_gates_are_p0.md`
- Verified — `CLAUDE.md:30-34` codifies the rule; `wmkf_apprequestpersons` Atlas page now exists (`docs/atlas/dataverse-wmkf-apprequestperson.md`). CLEAN.

### `feedback_review_panel_tone.md`
- Behavioral rule. `shared/config/prompts/virtual-review-panel.js` exists for application. CLEAN.

### `feedback_surface_full_review_findings.md`
- Pure behavioral rule. CLEAN.

### `feedback_thoroughness_default.md`
- Pure behavioral rule. The S141 doc-currency reference (`docs/archive/DOC_TRIAGE_2026-05-07.md`) exists. CLEAN.

### `feedback_verify_before_destructive_carryover.md`
- Behavioral rule, codified at `CLAUDE.md:11-17`. The historical "20+ live UPDATE sites" can't be re-verified post-W5/W6 retirement, but the rule stands. CLEAN as a rule.

### `feedback_verify_external_platform_claims.md`
- Pure behavioral rule. CLEAN.

### `project_admin_dashboard.md`
- **Line 13:** "Justin (id=2) is superuser" — verified through `pages/admin.js` and admin routes; `user_profiles.id` is auto-increment and stable per DB instance.
- Verified: `/admin` page exists, `api_usage_log` referenced from `lib/utils/usage-logger.js` and 5 other files, `CLAUDE_API_KEY` centralization in code.
- **Minor:** "id=2" is brittle across DB rebuilds. Add a lookup-by-email hint? Not required.
- CLEAN.

### `project_akoya_request_pd_fields.md`
- Verified field names against `docs/atlas/dataverse-akoya-request.md:37` — match.
- Filter pattern verified in `pages/api/reviewer-finder/my-proposals.js:124-130`.
- `lib/utils/cycle-code.js` confirms `wmkf_meetingdate` is the cycle-derivation field.
- **One field claim I did NOT independently verify:** "`ownerid` is `# BCO akoyaGO Integration` service account" — requires live Dataverse probe, not repo-checkable. Memory says "On real prod data (request 1002379)" — historical sample, can't re-prove from repo.
- CLEAN for repo-verifiable claims; one external-platform claim left as marked.

### `project_api_credit_monitoring.md`
- Verified: `pages/api/cron/spend-check.js` exists (158 lines), `scripts/update-balance-anchor.sh` exists, `parseClaudeStream` in `pages/api/dynamics-explorer/chat.js:403-404, 1776-1777` captures both `cache_creation_input_tokens` and `cache_read_input_tokens` on `r.usage`. Memory's bug-fix-and-fix-confirmation narrative checks out.
- Commit `5d53a32` referenced in memory — not re-checked via git but body code matches.
- CLEAN.

### `project_app_access_control.md`
- **Line 11 STALE:** "single source of truth for all **15 app definitions**" — actual count is **16** (verified `grep -c "^    key: '" shared/config/appRegistry.js`). Expertise Finder added since memory was written.
- **Line 14 STALE:** "`requireAppAccess(req, res, ...appKeys)` on **all ~30 app endpoints**" — actual count is **48** (verified `grep -rln "requireAppAccess" pages/api/ | wc -l`).
- Verified: `wmkf_appuserappaccesses` entity (Wave 1 cutover); `shared/context/AppAccessContext.js` exists; `DEFAULT_APP_GRANTS = ['dynamics-explorer']` at `shared/config/appRegistry.js:168`.

### `project_app_roadmap_2026-04-25.md`
- **STALE framing on Concept Evaluator:** "Concept Evaluator — being deprecated... Eventually remove from `appRegistry.js`, archive `pages/concept-evaluator.js`..." All three actions have **already happened**: page archived to `_archived/pages/concept-evaluator.js`, API archived to `_archived/pages/api/evaluate-concepts.js`, key removed from `appRegistry.js` (residual comment line 12 only). Memory still reads as future work.
- Doc tail item: `docs/AI_PROMPTS_DETAILED.md`, `docs/SYSTEM_OVERVIEW.md`, `docs/PDF_EXPORT.md`, `docs/AI_PROMPTS_OVERVIEW.md` still reference Concept Evaluator. Tail cleanup is real, but the headline action is done.
- Other app status claims (Grant Reporting, Integrity Screener, Reviewer Finder, Phase II Writeup, Peer Review Summarizer, Phase I winddown) all align with current code + atlas. CLEAN for those.

### `project_backend_automation.md`
- Direction memory, no breakable refs. The named new fields on `akoya_request` (`wmkf_ai_summary`, `wmkf_ai_structured_data`, ...) — only `wmkf_ai_summary` exactly matches v3 spec; `structured_data` was renamed to `wmkf_ai_dataextract` per `project_dynamics_ai_writeback.md` and Atlas. Stale field-name list inside a direction memo.
- **Minor STALE:** the field-name list (lines 14-15) uses old v2-era names. Per `project_dynamics_ai_writeback.md` they were renamed in v3.

### `project_codex_recurring_review.md`
- **Line 7 STALE path:** references `docs/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md` and `docs/CODE_REVIEW_RESPONSE_2026-04-30.md`. Both moved to `docs/archive/`.
- **Line 16 STALE:** "`docs/API_ROUTE_SECURITY_MATRIX.md` is the living artifact (**untracked in our repo, owned by the Codex session**)" — file is tracked in the repo today (`docs/API_ROUTE_SECURITY_MATRIX.md` exists), and `CLAUDE.md:245` calls it "the full route catalogue, CI-gated via `npm run check:api-routes`". The "untracked, owned by Codex session" framing is wrong.

### `project_contact_promotion_permission.md`
- Verified: `pages/api/review-manager/send-emails.js` has the promotion block (~line 247-265, off by ~10 from the memory's "~line 247"). `_wmkf_contact_value` null-check + link logic present.
- **Line 13 STALE path:** "Tracked in `docs/PENDING_ADMIN_REQUESTS.md` Section 4" — moved to `docs/archive/PENDING_ADMIN_REQUESTS.md`.

### `project_dataverse_creator_privileges.md`
- Policy memory; `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` exists as the running audit catalog. CLEAN.

### `project_dataverse_schema_deploy_gotchas.md`
- All four gotchas hold:
  - `MAX_EXPORT_RECORDS = 5000` at `lib/services/dynamics-service.js:77` ✓
  - `wmkf_ai_Prompt@odata.bind` (PascalCase) at `lib/services/execute-prompt.js:592` ✓
  - 429 throttling pattern (operational, not in code; preserved as warning)
  - Logical-name lowercasing (operational pattern)
- CLEAN.

### `project_dev_environment.md`
- Verified: `.env.local` exists, contains `WAVE1_BACKEND_SETTINGS=dataverse`, `WAVE1_BACKEND_APP_ACCESS=dataverse`, `WAVE1_BACKEND_PREFS=dataverse`.
- Fail-loud dispatcher confirmed at `lib/services/{settings,app-access,database}-service.js:35/44/47`.
- CLEAN.

### `project_dynamics_ai_writeback.md`
- Verified all 4 named test scripts exist (`test-dynamics-write.js`, `test-dynamics-email.js`, `test-log-ai-run.js`, `inspect-ai-fields.js`).
- Verified field-name claims match Atlas at `docs/atlas/dataverse-akoya-request.md:48-50`.
- **Line 60 STALE TODO:** "Justin owes: exclude `wmkf_ai_run` from search results and schema suggestions in the Dynamics Explorer chat tool" — `wmkf_ai_run` is **not** in `TABLE_ANNOTATIONS` (verified `grep "wmkf_ai_run\b" shared/config/prompts/dynamics-explorer.js` returns no entries in the entitySet enumeration). TODO is DONE; memory should remove.
- **External contradiction surfaced (not in this memory but adjacent):** `docs/atlas/dataverse-akoya-request.md:50` labels `wmkf_ai_fitassessment + wmkf_ai_fitrationale` as "Field Set D: ready," but `docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md:107` says Field Set D is PD Assignment (no new fields). This memory aligns with v3. The Atlas labeling is the inconsistent one. Worth resolving in Atlas, not in this memory.

### `project_dynamics_as_prompt_ground_truth.md`
- Strategic direction memory. `wmkf_ai_prompt` table real (Atlas: `docs/atlas/dataverse-wmkf-ai-run-and-prompt.md`); `lib/services/execute-prompt.js` exists. CLEAN.

### `project_dynamics_crm_limitations.md`
- Platform behavior; not repo-verifiable but consistent with code that works around these limits (no `$skip` in `DynamicsService` queries; uses `$count=true` not `/$count` endpoint). CLEAN.

### `project_dynamics_crm_users.md`
- Counts (16 staff, ~180 service accounts) require Dynamics admin probe to verify; not repo-verifiable. CLEAN as user-supplied context.

### `project_dynamics_email.md`
- Verified all 5 named service methods exist in `lib/services/dynamics-service.js:1033,1045,1116,1151,1176`.
- Test surfaces: `pages/test-email.js` + `pages/api/test-email.js` exist. CLEAN.

### `project_dynamics_explorer_archive_libs.md`
- Verified: `getRequestSharePointBuckets` in `lib/utils/sharepoint-buckets.js`. `list_documents` and `search_documents` in `pages/api/dynamics-explorer/chat.js` use it. Sample request numbers (`993879`, `993347`, `1001289`) — historical, can't re-prove. CLEAN.

### `project_dynamics_explorer_details.md`
- Search API claims (77K+ docs, 154MB index) are external state, not repo-verifiable. Code references (`Microsoft.Dynamics.CRM` annotations, top-4 inline schemas, SSE streaming) present in `pages/api/dynamics-explorer/chat.js`. CLEAN.

### `project_dynamics_explorer_schema_diff.md`
- Both scripts exist (`scripts/dynamics-schema-diff.js`, `scripts/dynamics-schema-map.js`). Commit `25d91e4` referenced — not git-verified but body matches. `TABLE_ANNOTATIONS` confirmed live in prompt config. CLEAN.

### `project_dynamics_explorer_serializer_deferred.md`
- Verified: `lib/utils/dynamics-explorer-serializer.js`, `tests/unit/dynamics-explorer-serializer.test.js`, `tests/integration/dynamics-explorer-tool-serialization.test.js` all exist. CLEAN.

### `project_dynamics_identity_reconciliation.md`
- Verified all named files: `lib/services/dynamics-identity-service.js`, `scripts/reconcile-dynamics-identities.js`, `pages/api/cron/reconcile-identities.js`, `lib/services/dynamics-service.js:167` impersonation gate.
- 7 endpoints listed as plumbed — verified `actingUserSystemId` reaches each: `phase-i-dynamics/summarize.js`, `phase-i-dynamics/summarize-v2.js`, `grant-reporting/extract.js`, `review-manager/{send-emails,mark-received-no-file,upload-review}.js`, `test-email.js` (all exist).
- 8 endpoints from S129: verified all 8 take `actingUserSystemId` (`reviewer-finder/{save-candidates,my-candidates}`, `review-manager/{render-emails,send-emails,regenerate-token,revoke-token,reviewers,upload-review}`).
- All 4 adapters take `actingUserSystemId`: verified (`grep -l "actingUserSystemId" lib/dataverse/adapters/*.js` returns all 4).
- `tests/unit/dynamics-service-caller-id.test.js` and `tests/unit/adapters-caller-id.test.js` exist.
- Live "Delegate role granted" status is external Dataverse state — not repo-verifiable. Memory's description tag says "Remaining: full /phase-i-dynamics overwrite=true run + flip prod env flag DYNAMICS_IMPERSONATION_ENABLED=true." Active still per `CLAUDE.md:163` ("off by default for safe rollout").
- CLEAN.

### `project_external_reviewer_file_access.md`
- Verified all 4 `lib/external/` primitives: `token-lifecycle.js`, `verify-suggestion-token.js`, `reviewer-materials.js`, `review-form-schema.js` (also `policy-fetcher.js` exists — memory didn't mention it, harmless omission).
- Verified `pages/external/review/[token].js` + endpoints `context.js`, `proposal.js`, `upload.js`, `respond.js` (memory listed 3; respond.js exists too — added since memory).
- `/api/external/*` middleware allowlist at `middleware.js:131-133` ✓.
- Commit `2277d23` (Vercel Blob retirement) in `git log` history. CLEAN.

### `project_grant_lifecycle_states_confirmed.md`
- Verified filter `akoya_requeststatus eq 'Phase II Pending'` at `pages/api/reviewer-finder/my-proposals.js:127`.
- **STALE FALSE CLAIM (this is C1 from V1, now verified again):** "**`wmkf_potentialreviewer1..5` do NOT exist on `akoya_request`** — got a schema error querying." This contradicts Atlas (`docs/atlas/dataverse-akoya-request.md:36`: "`wmkf_potentialreviewer1..5` → `wmkf_potentialreviewers` (legacy slots)") AND contradicts `project_akoya_request_pd_fields.md` and `project_reviewer_count_invariant.md`. The slots DO exist on `akoya_request`; live code doesn't read them anymore (verified: `grep -rn "wmkf_potentialreviewer[1-5]" pages/ lib/ scripts/ shared/` returns nothing), but they're real Dataverse fields.
- D26 production sample counts — historical, not repo-verifiable.

### `project_grant_phasing_evolution.md`
- Strategic direction; aligns with `project_intake_portal_pilot_decisions_2026-05-13.md` and intake design docs. CLEAN.

### `project_intake_meeting_agenda_cleanup.md`
- Trigger date 2026-05-27 — not yet due (today is 2026-05-14). Agenda file `docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md` still present. CLEAN, correctly waiting.

### `project_intake_portal_external_id_foundation.md`
- Verified all tenant facts in `pages/api/auth/[...nextauth].js:10-11,37,63`: `wmkeckapply` tenant, `entra-external` provider id, env-var triplet.
- Sign-in auto-dispatch verified at `pages/auth/signin.js:24-29`.
- `/apply` exclusion in `_app.js:23` ✓.
- **Line 40 STALE path:** `docs/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md` moved to `docs/archive/`.

### `project_intake_portal_pilot_decisions_2026-05-06.md`
- Self-marks items 2 and 6 as superseded by 2026-05-13 ✓.
- **Line 9 STALE path:** `docs/CONNOR_INTAKE_PORTAL_SYNC.md` moved to `docs/archive/`.
- **Line 28 STALE entity list:** `wmkf_budgetline, wmkf_personnel, wmkf_priorsupport, wmkf_milestone` — superseded by 2026-05-14 (`wmkf_proposalbudgetline` only; roster extends `wmkf_apprequestperson`; milestones/prior-support deferred). Memory's own top-of-file warning catches the 2026-05-13 supersession but not the 2026-05-14 one.

### `project_intake_portal_pilot_decisions_2026-05-13.md`
- **THIS MEMORY IS ONE-DAY STALE.** The 2026-05-14 schema review (`docs/archive/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md` at 11:40 today, `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` at 14:05 today, `docs/INTAKE_PORTAL_DESIGN.md:587-588` at 14:05 today) supersedes this memory.
- **Line 20 STALE:** "narrowed scope to budget + roster only. JSON specs drafted by 2026-05-15, applied by 2026-05-18." — refined to: budget = new `wmkf_proposalbudgetline`; roster extends `wmkf_apprequestperson`; no new `wmkf_proposalroster` (per `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:40`).
- **Line 30 STALE path:** "Two JSON schema specs under `lib/dataverse/schema/intake/`" — that directory does NOT exist (verified `find lib/dataverse/schema -maxdepth 3 -type d` returns `roles, wave1, wave2, wave2-existing, wave3` only). Budget spec landed at `docs/BUDGET_FORM_SPEC.md` instead.
- **Line 24 STALE:** "Naming alignment is open... between `wmkf_proposalroster` and `wmkf_personnel`" — closed 2026-05-14: no new roster entity at all.

### `project_intake_portal_skinny_scope.md`
- Verified `docs/INTAKE_PORTAL_DESIGN.md` exists at root (not archive). CLEAN.

### `project_interim_report_automation.md`
- Verified `pages/api/grant-reporting/extract.js` exists; SharePoint write granted 2026-04-15 (per `project_dynamics_ai_writeback.md`); `getRequestSharePointBuckets` and `lib/utils/sharepoint-buckets.js` exist. CLEAN.

### `project_irs_exempt_verification.md`
- Verified every named file (5/5): `lib/db/migrations/008_irs_exempt_orgs.sql`, `lib/services/irs-bmf-service.js`, `pages/api/cron/refresh-irs-bmf.js`, `pages/api/irs/verify-ein.js`, `scripts/import-irs-bmf.js`.
- Verified cron schedule `0 6 15 1,4,7,10 *` in `vercel.json`.
- Verified middleware allowlist at `middleware.js:131`.
- Verified `IRS_VERIFY_SECRET` in `docs/CREDENTIALS_RUNBOOK.md:41`.
- "First load not yet run" — external state, can't verify. CLEAN.

### `project_machine_legible_form_capture.md`
- Verified `shared/forms/phase-ii-research-2026-06/` exists with `schema.js`, `validate.js`, `map-to-dynamics.js`. CLEAN.

### `project_new_ai_capabilities.md`
- Vague planning memory. Compliance screening (Field Set C) and PD Assignment (Field Set D) ARE deployed per Atlas — memory frames them as future, but pieces have already shipped. Same issue I flagged in V1.

### `project_pdf_processing_tiers.md`
- Conceptual; not repo-tied. CLEAN.

### `project_phase_i_summary_app_winddown.md`
- Verified all 4 named scripts/pages exist (`pages/phase-i-dynamics.js`, `scripts/compare-phase-i-v1-v2.js`, `scripts/ab-phase-i-prompts.js`, `scripts/audit-system-prompt-sizes.js`).
- `pages/api/phase-i-dynamics/{summarize,summarize-v2}.js` ✓. CLEAN.

### `project_prompt_storage_strategy.md`
- Verified `docs/EXECUTOR_CONTRACT.md`, `docs/PROMPT_STORAGE_DESIGN.md`, `docs/WORKFLOW_CHAINING_DESIGN.md` exist.
- Verified `wmkf_ai_Prompt@odata.bind` at `execute-prompt.js:592`; `wmkf_ai_systemprompt` field used at `execute-prompt.js:197,389`.
- Plan file at `/Users/gallivan/.claude/plans/ok-claude-connor-is-precious-dove.md` — not verified (out of repo).
- **Lines 32-36 STALE framing:** Phase 0 "by May 1 2026" listed as in-progress. Already shipped (Executor live; `summarize-v2` uses it; Atlas confirms `wmkf_ai_prompt` v3 path live). Same staleness as V1, confirmed.

### `project_proposal_context_extraction.md`
- Verified `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md` exists. CLEAN as deferred plan.

### `project_reviewer_accept_decline_links.md`
- **STALE — main claim wrong.** Memory says "What is NOT yet built: Dedicated Accept / Decline buttons... auto-fill of `response_received_at`/`accepted`/`declined` from a click action." Reality: `pages/api/external/review/[token]/respond.js` exists (verified `ls`); writes `wmkf_accepted`, `wmkf_declined`, `wmkf_responsetype`, `wmkf_responsereceivedat` per `lib/dataverse/adapters/reviewer-suggestion.js:444-469`.
- Filename-specific claim ("`pages/review-response.js` and `pages/api/review-response/confirm.js` were never created") still technically true — those exact filenames don't exist. But the capability moved to `respond.js`.
- Codex caught this in V1; I missed it. Confirmed.

### `project_reviewer_count_invariant.md`
- Business invariant memory. The slot existence claim aligns with Atlas (slots do exist on `akoya_request`; not read by current code). CLEAN.

### `project_reviewer_finder_dataverse_entry_path.md`
- **MATERIALLY STALE — central claim wrong.** Memory line 12: "Postgres reviewer tables are NOT dormant... `researchers.js` (browse/manage), `extract-summary.js`, `generate-emails.js`, `grant-cycles.js`, and `my-proposals.js` all still read/write Postgres."
  - `researchers.js`: **deleted W6 step 1 2026-05-12** (per `docs/atlas/postgres-researchers.md:51,59,70`).
  - `extract-summary.js`: **retired W5 step 5 2026-05-12** (per `docs/atlas/postgres-other-reviewer-tables.md:23`).
  - `grant-cycles.js`: Dataverse-only since W3 cutover 2026-05-12 (header at `pages/api/reviewer-finder/grant-cycles.js:9`).
  - `generate-emails.js`: zero `@vercel/postgres` imports (`grep -c "@vercel/postgres" pages/api/reviewer-finder/generate-emails.js` → 0).
  - `my-proposals.js`: Dataverse-only (builds OData filter; verified line 124-130).
- **Line 17 STALE:** "Do NOT drop the Postgres reviewer tables without a broader migration." That migration completed (W3–W6); the four drain-only tables (`researchers`, `researcher_keywords`, `publications`, `proposal_searches`) are scheduled for post-pilot one-shot DELETE per `project_w6_table_drop_pending.md`. The "do not drop" carryover this memory created is now itself a risk: someone reading it might leave dead tables in place indefinitely.
- Picker (`ProposalPickerCard`) + save-candidates writeback claims still hold (verified earlier).
- Codex caught this in V1; I missed it. **This was the most dangerous miss of V1** — acting on this memory's "do not drop" would block legitimate cleanup; treating its "Postgres still load-bearing" framing as current would mislead architectural plans.

### `project_reviewer_history_data_quality.md`
- Pre-J26 absence claim is historical and not repo-verifiable. Underlying logic (Postgres `reviewer_suggestions` was the writer, only used J26+) holds. CLEAN as historical context.

### `project_reviewer_lifecycle_automation.md`
- Direction memory. Wave 2 schema decisions (`wmkf_review_status` choice, `wmkf_response_type` choice) align with deployed `wmkf_appreviewersuggestion` per Atlas. CLEAN.

### `project_reviewer_lifecycle.md`
- Phase A (CRM send) shipped per `project_contact_promotion_permission.md` (live 2026-05-01).
- Phase C (review intake to SharePoint) shipped per `project_external_reviewer_file_access.md` (live 2026-05-03).
- Reviewer Portal concept ("`/review/[token]` token-based link") shipped as `/external/review/[token]` — different URL, but same primitive.
- **Memory frames it all as future work plan**, but multiple pieces shipped via other memories. Same issue I flagged in V1.
- **Line 61 stale ref:** "Add Researcher modal (reviewer-finder.js:2802)" — `pages/reviewer-finder.js` is 3645 lines now; line 2802 may or may not still hit the modal. Specific line numbers in long-lived files rot.

### `project_reviewer_postgres_to_dataverse_migration.md`
- **Line 22 STALE:** "Cleanup cron runs weekly; only acts twice a year." Cron was **deferred** per `project_w6_table_drop_pending.md`; verified `grep -rln "reviewer-cleanup\|reviewerCleanup\|cleanupReviewer" pages/api/ lib/ scripts/` returns nothing. No such cron exists or is planned in the W6 path.
- **Line 33 STALE:** "Batched lookup: new endpoint `/api/reviewer-finder/contact-history` POST `{ contactIds }`." Actual route is **GET single-contact** (`pages/api/reviewer-finder/contact-history.js:4` says "GET — PI / co-PI history for a single contact"; `:62-64` rejects non-GET).
- **Line 66-75 STALE as current state:** S136 live-state probe describes Postgres "$reviewer_suggestions: 337 rows, grant_cycles: 13 rows..." Subsequent W3–W6 migrations changed this. Atlas page `docs/atlas/postgres-grant-cycles.md:8` says Dataverse counterpart has 0 rows but live reads are Dataverse-only per the W3 cutover. Memory's row-count snapshot is historical.
- Other content (locked decisions, S136 codex stress-test addressed) is historical and useful.
- Codex caught these in V1; I missed them.

### `project_sharepoint_integration.md`
- Verified site URL, library names (`akoya_request` + 3 archives), `lib/services/graph-service.js` exists, `scripts/probe-sharepoint-write.js` exists.
- **Line 17 STALE path:** "IT security response: `docs/IT_SECURITY_RESPONSE.md`" — moved to `docs/archive/IT_SECURITY_RESPONSE.md`.
- Site URL and Graph API claims not repo-verifiable but consistent with code that uses them.

### `project_staged_review_pipeline.md`
- Both plan docs exist (`docs/STAGED_REVIEW_PIPELINE.md`, `docs/STAGED_PIPELINE_IMPLEMENTATION_PLAN.md`). VRP service files exist. CLEAN.

### `project_strategy_direction.md`
- **Line 11 STALE temporal hedge:** "Connor partnership: Will flesh out backend vision together **in coming weeks (from ~March 12, 2026)**" — that's ~2 months ago today. Strategic direction (Dynamics-first, backend triggers, AkoyaGO minimize) confirmed by other memories. Temporal framing rots; principles stand.
- `docs/STRATEGY.md` exists. CLEAN with hedge-softening opportunity.

### `project_virtual_review_panel.md`
- Verified appRegistry entry (`shared/config/appRegistry.js:142`), page (`pages/virtual-review-panel.js`), API (`pages/api/virtual-review-panel.js`), services (`lib/services/multi-llm-service.js`, `lib/services/panel-review-service.js`), prompts (`shared/config/prompts/virtual-review-panel.js`), migration (`lib/db/migrations/003_virtual_review_panel.sql`). All exist.
- Env-var claims (`OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `PERPLEXITY_API_KEY`) not env-probed but referenced in `docs/CREDENTIALS_RUNBOOK.md`.
- CLEAN.

### `project_w6_table_drop_pending.md`
- Trigger date 2026-07-01 — not yet due. Tables `researchers`, `researcher_keywords`, `publications`, `proposal_searches` all still exist per `docs/atlas/postgres-researchers.md` and `postgres-other-reviewer-tables.md`.
- **Line 33 references stale Atlas:** "`proposal_searches` JOIN site mentioned in `docs/atlas/postgres-other-reviewer-tables.md:25`" — Atlas page line 25 still says JOIN is load-bearing in `grant-cycles.js`. But `pages/api/reviewer-finder/grant-cycles.js` shows the route is Dataverse-only (the JOIN comment at line 100 is past-tense). **The Atlas page itself is stale.** Memory's instruction is "verify it was killed in W3" — verification result is YES, killed. Memory is fine; Atlas needs correcting.

### `project_wave1_onboarding.md`
- Verified: `lib/services/onboarding.js` does NOT exist (memory correctly says "to be created").
- Verified: `lib/services/dataverse-identity-map.js` exists.
- Verified: `lib/dataverse/role-apply.js` exists.
- Verified: `scripts/apply-security-role.js` exists.
- `grantDefaultApps` at `pages/api/auth/[...nextauth].js:157,178,313` ✓. CLEAN.

### `project_wave1_pending.md`
- Verified: `lib/db/migrations/007_drop_wave1_tables.sql` exists.
- Verified: `docs/WAVE1_REVERT_TEMP_ELEVATIONS.md` exists.
- Verified fail-loud dispatcher in 3 services.
- App-user GUID `53e97fb3-a006-f111-8406-000d3a352682` — external state, not repo-verifiable.
- CLEAN.

### `user_powerautomate.md`
- User-supplied context; no repo claims. CLEAN.

---

## Atlas-vs-code drift I surfaced incidentally (not memory issues, but worth flagging)

These are **not memory findings** but came up during verification. The Atlas is supposed to be ground truth; some pages contradict live code:

1. **`docs/atlas/postgres-other-reviewer-tables.md:25`** — says JOIN site `proposal_searches` in `grant-cycles.js` is load-bearing. Live code (`pages/api/reviewer-finder/grant-cycles.js`) is Dataverse-only post-W3 cutover. The JOIN is gone. Atlas should be updated to reflect retirement.

2. **`docs/atlas/postgres-grant-cycles.md:8`** — says "all live reads still go to Postgres" because Dataverse `wmkf_appgrantcycle` has 0 rows. Live code at `pages/api/reviewer-finder/grant-cycles.js:9` says "W3 cutover (2026-05-12) — Dataverse-only" and the route reads from `lib/services/grant-cycles-dataverse.js`. The Atlas page is stale; the live route IS reading Dataverse.

3. **`docs/atlas/dataverse-akoya-request.md:50`** vs **`docs/DYNAMICS_AI_FIELDS_SPEC_v3_cn.md:107`** — Atlas labels `wmkf_ai_fitassessment + wmkf_ai_fitrationale` as "Field Set D". v3 spec says Field Set D is PD Assignment (writes to existing `wmkf_programdirector`, no new fields). Doc-vs-doc contradiction. Memory `project_dynamics_ai_writeback.md` aligns with v3 spec.

The `check:atlas` CI gate enforces *coverage* (every entity used in code is mentioned in an Atlas page) but doesn't check Atlas *currency* against live code. The three drifts above are exactly the class the gate doesn't catch.

---

## What V2 surfaced that V1 missed

Of Codex's V1 findings, V2 independently confirmed:
- ✅ `project_reviewer_finder_dataverse_entry_path.md` central claim wrong (researchers.js, extract-summary.js deleted; generate-emails.js Postgres-free).
- ✅ `project_reviewer_accept_decline_links.md` "NOT yet built" wrong (`respond.js` exists).
- ✅ `project_reviewer_postgres_to_dataverse_migration.md` two stale items (cleanup cron deferred; contact-history is GET single-contact, not POST batched).
- ✅ `project_intake_portal_pilot_decisions_2026-05-13.md` one-day stale per 2026-05-14 schema docs; `lib/dataverse/schema/intake/` doesn't exist.
- ✅ `feedback_human_legibility_schema_principle.md` example `wmkf_proposalroster` now self-contradicting.
- ✅ All archive-path moves (S8–S11 in V1).
- ✅ Concept Evaluator already removed (V1 caught this; V2 confirms `_archived/` location).

V2 surfaced beyond Codex:
- The C1 three-way contradiction on `wmkf_potentialreviewer1..5` (Codex marked this VAGUE; my V1 caught the contradiction; V2 confirms with grep evidence that slots exist in Atlas but no live code reads them).
- The Atlas-vs-code drift items (1, 2, 3 above) — Codex marked the `proposal_searches` Atlas note as stale; V2 found two more.
- App count 16 not 15; `requireAppAccess` count 48 not 30 (V1 caught these; Codex VAGUE'd them).
- `project_backend_automation.md` field-name list (`wmkf_ai_structured_data`) is v2-era; renamed in v3 (V1 didn't flag this; V2 catches it cross-checking against v3 spec).

---

## Confidence statement

V2 found **everything V1 found + everything Codex found + 3 additional items** (the Atlas-vs-code drifts surfaced as side effects of the deeper verification). The discipline change isn't aspirational; it's measurable in the delta.

The remaining risk: there are claims in memories I marked CLEAN that depend on **external systems** (Dataverse tenant config, SharePoint permissions, Anthropic admin API behavior, historical sample data). I cannot verify those from the repo, and I haven't.

---

## V2 discipline checklist — applied to every memory

1. ☑ Every named identifier checked, not a sample.
2. ☑ Negative claims (`NOT yet built`, `do NOT drop`, `still load-bearing`) grepped for the negated thing.
3. ☑ Memory date treated as upper bound — newer docs searched (`ls -t docs/`, find by mtime).
4. ☑ Atlas pages cross-read on every memory naming a Postgres table or Dataverse entity.
5. ☑ Every CLEAN classification re-justified before commit (explicit "no external claims left unverified" or "external-state only" tag).

If any of these slipped in this audit, that's the gap to call out — show me a memory where I missed one, and the discipline isn't real yet.
