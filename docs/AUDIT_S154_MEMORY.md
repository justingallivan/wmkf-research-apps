# Memory Audit — Session 154 (Lane 3)

**Date:** 2026-05-14
**Scope:** Every file under `.claude-memory/` (1 index + 11 feedback + 51 project + 1 user = 64 files). All read in full. Claims cross-checked against current codebase via grep + read.
**Method:** Read full bodies (not just descriptions). For each factual claim naming a file/function/table/route/script/doc, verified against live state. Cross-checked overlapping memories for contradictions.

No memory edits applied during this audit. Findings only — review before changes.

---

## STALE — claim no longer matches live state

### S1. `project_app_access_control.md` says "15 app definitions"
**Verified:** `grep "key: '" shared/config/appRegistry.js | wc -l` → **16 apps**. Expertise Finder added since this memory was written. CLAUDE.md app table shows 17 entries (one is `phase-i-dynamics` which is intentionally out of nav, so 16 in registry is consistent with CLAUDE.md).
**Fix:** "all 15 app definitions" → "all 16 app definitions" (or "all current app definitions").

### S2. `project_app_access_control.md` says "requireAppAccess on all ~30 endpoints"
**Verified:** `grep -rln "requireAppAccess" pages/api/ | wc -l` → **48 routes use it**. Total API routes: 80.
**Fix:** "~30 endpoints" → "~48 endpoints" (or drop the count — it's CI-gated by the security matrix anyway).

### S3. `project_app_roadmap_2026-04-25.md` — Concept Evaluator framed as "being deprecated, eventually remove"
**Verified:** `pages/concept-evaluator.js` and `pages/api/evaluate-concepts.js` **already removed**. No `concept-evaluator` key in `shared/config/appRegistry.js`. Residual references only in narrative docs (`docs/AI_PROMPTS_DETAILED.md`, `docs/SYSTEM_OVERVIEW.md`, `docs/PDF_EXPORT.md`, `docs/AI_PROMPTS_OVERVIEW.md`) and a one-line vestigial comment in `shared/config/appRegistry.js:12`.
**Fix:** Reframe as "Concept Evaluator REMOVED from code; doc-cleanup tail item still open in 4 narrative docs." This memory currently reads as a future action; it's already in the past.

### S4. `project_dynamics_ai_writeback.md` carries a "Dynamics Explorer TODO: exclude `wmkf_ai_run` from search results"
**Verified:** `shared/config/prompts/dynamics-explorer.js` table list (the `entitySet:` enumeration) does **not** include `wmkf_ai_run`. The exclusion is done.
**Fix:** Remove the TODO paragraph or mark "DONE — `wmkf_ai_run` is not in `TABLE_ANNOTATIONS`."

### S5. `feedback_concepts_vs_phase_i.md` — useful rule, but factual frame is dated
The rule "hard-exclude `/concept/i` files from Phase I prompt pipelines" is still defensible. The supporting context ("Phase I may be eliminated") is now superseded by `project_grant_phasing_evolution.md` — concepts ARE going away (decided), Phase I/II merge into single-package next cycle. Rule still applies for current cycle, but the "this taxonomy may shift" hedge can be tightened to "concepts are going away next cycle (confirmed); rule applies through current J26/D26 cycle."
**Fix:** Tighten the hedge; link `[[project_grant_phasing_evolution]]`.

### S6. `project_reviewer_lifecycle.md` — describes Reviewer Portal "concept" at `/review/[token]`; shipped as `/external/review/[token]`
The full Phase A/B/C/D plan in this memory is from Session 87 (2026-03-13/14). Status by current ground truth:
- **Phase A (CRM send):** SHIPPED — confirmed by `project_contact_promotion_permission.md` (live 2026-05-01).
- **Phase C (review intake to SharePoint):** SHIPPED — confirmed by `project_external_reviewer_file_access.md` (live 2026-05-03).
- **Reviewer Portal concept** with token-based link: SHIPPED as `/external/review/[token]` (the URL the memory speculates `/review/[token]` was a placeholder).
- **Phase B (status dashboard) and Phase D (schema cleanup):** status not asserted anywhere I can find in memory.

The whole memory now reads as a planning doc when most of it shipped via different memories. It's not wrong, just leading.
**Fix:** Either retire this memory (Phase A + C status now lives in dedicated shipped memories) or replace its body with a Phase-status one-liner that links to those memories.

### S7. `project_reviewer_lifecycle.md` references `reviewer-finder.js:2802`
**Verified:** `pages/reviewer-finder.js` is now 3645 lines; `ProposalPickerCard` is at line 389; `FileUploaderSimple` import at line 20. The "Add Researcher modal at line 2802" claim is unverifiable now; line numbers from a deeply-edited file are bit-rot.
**Fix:** Drop the line number, or update to "Add Researcher modal" symbol name lookup.

### S8. `project_codex_recurring_review.md` references `docs/CODE_REVIEW_*_2026-04-30.md` (no archive path)
**Verified:** Both docs **moved to `docs/archive/`** (`docs/archive/CODE_REVIEW_FRAGILITY_FINDINGS_2026-04-30.md` and `docs/archive/CODE_REVIEW_RESPONSE_2026-04-30.md`).
**Fix:** Update paths to `docs/archive/...`.

### S9. `project_sharepoint_integration.md` references `docs/IT_SECURITY_RESPONSE.md`
**Verified:** Moved to `docs/archive/IT_SECURITY_RESPONSE.md`.
**Fix:** Update path or remove ref.

### S10. `project_intake_portal_external_id_foundation.md` references `docs/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`
**Verified:** Moved to `docs/archive/IT_ENTRA_EXTERNAL_TENANT_REQUEST_2026-05-04.md`.
**Fix:** Update path.

### S11. `project_contact_promotion_permission.md` references `docs/PENDING_ADMIN_REQUESTS.md`
**Verified:** Moved to `docs/archive/PENDING_ADMIN_REQUESTS.md`.
**Fix:** Update path or recognize it's archived (the memory says "now marked Done" — could just drop the doc ref entirely since the memory itself is the record).

### S12. `project_contact_promotion_permission.md` line ref "~line 247"
**Verified:** `pages/api/review-manager/send-emails.js` — the contact-promotion block sits at line ~265 today, send block ~243. "Approximately 247" was true at the time; close enough that a maintainer can still find it via the surrounding comment. Low-severity.
**Fix:** Optional — drop the line number, keep the symbol/comment hint.

---

## CONTRADICTORY — memories disagree with each other

### C1. Does `wmkf_potentialreviewer1..5` exist on `akoya_request`?

Three memories disagree:

- **`project_akoya_request_pd_fields.md`** (DEFINITE YES): "**Pre-existing reviewer slots:** `wmkf_potentialreviewer1` through `wmkf_potentialreviewer5` — five lookup slots → `wmkf_potentialreviewers`. Connor's pre-existing pattern."
- **`project_reviewer_count_invariant.md`** (DEFINITE YES): "**Why 5 slots on `akoya_request`:** `wmkf_potentialreviewer1` through `wmkf_potentialreviewer5` are 5 lookup slots..."
- **`project_grant_lifecycle_states_confirmed.md`** (DEFINITE NO): "**`wmkf_potentialreviewer1..5` do NOT exist on `akoya_request`** — got a schema error querying."

**Verified live state via Atlas (which probes live Dataverse):**
- `docs/atlas/dataverse-akoya-request.md:36`: "`wmkf_potentialreviewer1..5` → `wmkf_potentialreviewers` (legacy slots — actual reviewer state lives in `wmkf_appreviewersuggestion`)" — they exist.
- `docs/atlas/dataverse-akoya-request.md` further down: "The 5-slot `wmkf_copi1..5` and `wmkf_potentialreviewer1..5` patterns are vendor-conceived... being phased out via child entities."

**Ground truth:** the slots **do exist** on `akoya_request` as lookup fields, but **no live code reads them** anymore (verified: `grep -rn "wmkf_potentialreviewer[1-5]" pages/ lib/ scripts/ shared/` returns nothing). They're legacy fields the Atlas knows about; current code uses `wmkf_appreviewersuggestion`.

The `project_grant_lifecycle_states_confirmed.md` claim is **wrong** — whatever schema-error probe was run that day either targeted the wrong attribute or had a typo. This is exactly the kind of belief that propagates if not caught.

**Fix:** correct `project_grant_lifecycle_states_confirmed.md` to remove the false "do NOT exist" assertion. Possibly add a one-line note in all three that "code no longer reads these slots — verified 2026-05-14 via grep."

### C2. `feedback_red_gates_are_p0.md` cites `wmkf_apprequestpersons` as the entity that caused the S139–S140 gate red
**Verified:** `docs/atlas/dataverse-wmkf-apprequestperson.md` exists. Atlas entity set is `wmkf_apprequestpersons`. No contradiction with other memories, but the incident is now covered by an Atlas page — the memory is consistent.

(No actual contradiction here; flagging for completeness because the same name appears in `SESSION_PROMPT.md` and CLAUDE.md.)

### C3. `wmkf_potentialreviewer` slot status across memories — consistent on the per-person table, fuzzy on which memory owns the rule
`project_reviewer_count_invariant.md`, `project_reviewer_history_data_quality.md`, and `project_reviewer_postgres_to_dataverse_migration.md` all touch slot semantics but with different framings (the 5-slot pattern as buffer; pre-J26 zeros as unknown; engaged-slot history as canonical). Not contradictory, but overlapping. Could collapse to a single "reviewer slot model" memory or cross-link more explicitly.
**Fix:** Optional — add `[[...]]` cross-links between the three.

### C4. Two memories about reviewer accept/decline links partially overlap with the external-reviewer file access memory
- `project_reviewer_accept_decline_links.md` says: shipped as the broader external-reviewer landing, dedicated accept/decline buttons NOT built.
- `project_external_reviewer_file_access.md` confirms the broader landing shipped.

Internally consistent (one defers to the other), so not a contradiction. The accept-decline memory correctly says its original ask is partly subsumed and partly still unbuilt. Clean.

---

## VAGUE — claim is too soft to verify or act on

### V1. `project_strategy_direction.md` references "Foundation colleague" and "Connor partnership... in coming weeks (from ~March 12, 2026)"
The "coming weeks" framing is now ~2 months stale relative to today (2026-05-14). The strategic direction itself (Dynamics as ground truth, backend triggers, minimize AkoyaGO) is still authoritative per other memories. Just the temporal framing rots.
**Fix:** Drop "in coming weeks" hedge; keep the strategic decisions.

### V2. `project_new_ai_capabilities.md` — "Compliance Screening" + "Staff-Proposal Matching"
Reads as future plans without a "status" line. Compliance screening shipped as Field Set C (per `project_dynamics_ai_writeback.md`), and staff-matching is partially Expertise Finder. The memory hasn't been updated to reflect that some of what it describes already exists.
**Fix:** Add status lines pointing to the shipped pieces; mark which sub-capabilities remain unbuilt.

### V3. `project_pdf_processing_tiers.md`
A two-tier conceptual model without a "where this is currently applied" line. Useful as principle, not as state.
**Fix:** Optional — add a note "where in code this lives today" line if there's a concrete service.

### V4. `project_proposal_context_extraction.md` says "Not building yet — deferred"
Still accurate, but no trigger condition stated. When does this come up again? Memory says "until single-phase cycle is imminent or until a concrete deep-dive workflow first needs the extracted context" — that's good. Lower vagueness than V2/V3 but worth a re-read to confirm 2-cycle horizon is still right.

### V5. `project_admin_dashboard.md` — "Justin (id=2) is superuser"
The `id=2` is the Postgres `user_profiles.id` primary key, which is stable but specific to one DB instance. If we ever rebuild the DB this would be wrong. Low-severity but worth a "lookup-by-email" hint as a fallback.

---

## CLEAN — verified accurate

The following memories were checked and all factual claims hold against live state:

- `MEMORY.md` — index entries match files; no broken `[[...]]` links discovered.
- `feedback_check_memory_before_asking_user.md` — pure behavioral rule, no state claims.
- `feedback_codex_verbatim_output.md` — behavioral rule.
- `feedback_cycle_vs_executor_scope.md` — behavioral framing; aligned with other memories.
- `feedback_human_legibility_schema_principle.md` — behavioral rule; supporting context (S149 doc) verified at `docs/archive/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md`.
- `feedback_red_gates_are_p0.md` — accurate; gates exist and run as described.
- `feedback_review_panel_tone.md` — pure tone rule.
- `feedback_surface_full_review_findings.md` — pure behavioral rule.
- `feedback_thoroughness_default.md` — behavioral rule.
- `feedback_verify_before_destructive_carryover.md` — accurate; aligned with CLAUDE.md.
- `feedback_verify_external_platform_claims.md` — behavioral rule.
- `project_api_credit_monitoring.md` — verified: `pages/api/cron/spend-check.js`, `scripts/update-balance-anchor.sh`, `parseClaudeStream` captures both cache fields in `pages/api/dynamics-explorer/chat.js`.
- `project_codex_recurring_review.md` — except for the archive-path issue (S8), accurate.
- `project_contact_promotion_permission.md` — verified: send-emails contact-promotion logic exists.
- `project_dataverse_creator_privileges.md` — pure policy memory.
- `project_dataverse_schema_deploy_gotchas.md` — verified: `MAX_EXPORT_RECORDS = 5000` in `lib/services/dynamics-service.js:77`; `wmkf_ai_Prompt@odata.bind` (PascalCase) in `lib/services/execute-prompt.js:592`.
- `project_dev_environment.md` — verified `.env.local` has WAVE1_BACKEND_* = dataverse.
- `project_dynamics_ai_writeback.md` — except for the TODO staleness (S4), accurate.
- `project_dynamics_as_prompt_ground_truth.md` — pure direction memory.
- `project_dynamics_crm_limitations.md` — OData behavior; no internal refs to drift.
- `project_dynamics_crm_users.md` — accurate.
- `project_dynamics_email.md` — verified service-method names exist in `lib/services/dynamics-service.js`.
- `project_dynamics_explorer_archive_libs.md` — verified `getRequestSharePointBuckets` in `lib/utils/sharepoint-buckets.js`.
- `project_dynamics_explorer_details.md` — Dataverse Search facts verified by Atlas.
- `project_dynamics_explorer_schema_diff.md` — both scripts exist.
- `project_dynamics_explorer_serializer_deferred.md` — verified `lib/utils/dynamics-explorer-serializer.js` exists.
- `project_dynamics_identity_reconciliation.md` — verified `DYNAMICS_IMPERSONATION_ENABLED` gate at `lib/services/dynamics-service.js:167`; adapters exist; `lib/external/token-lifecycle.js` exists.
- `project_external_reviewer_file_access.md` — verified `lib/external/*` primitives exist.
- `project_grant_lifecycle_states_confirmed.md` — except for the false `wmkf_potentialreviewer1..5` claim (C1), the lifecycle-status content is accurate. Filter `akoya_requeststatus eq 'Phase II Pending'` verified at `pages/api/reviewer-finder/my-proposals.js:127`.
- `project_grant_phasing_evolution.md` — strategic memory, no breakable refs.
- `project_intake_meeting_agenda_cleanup.md` — file still present, trigger 2026-05-27, today is 2026-05-14, memory is correctly waiting.
- `project_intake_portal_external_id_foundation.md` — except for archive-path issue (S10), accurate.
- `project_intake_portal_pilot_decisions_2026-05-06.md` — internally flags items superseded by 2026-05-13; correct.
- `project_intake_portal_pilot_decisions_2026-05-13.md` — accurate; correctly identifies which 2026-05-06 items reverse.
- `project_intake_portal_skinny_scope.md` — direction memory.
- `project_interim_report_automation.md` — accurate planning doc.
- `project_irs_exempt_verification.md` — verified all 5 named files exist; cron schedule `0 6 15 1,4,7,10 *` verified in `vercel.json`.
- `project_machine_legible_form_capture.md` — direction memory.
- `project_phase_i_summary_app_winddown.md` — verified all 4 named scripts exist.
- `project_prompt_storage_strategy.md` — `docs/EXECUTOR_CONTRACT.md` exists; `lib/services/execute-prompt.js` exists.
- `project_reviewer_accept_decline_links.md` — accurate (no rebuild needed).
- `project_reviewer_finder_dataverse_entry_path.md` — verified `ProposalPickerCard` and `FileUploaderSimple` in `pages/reviewer-finder.js`.
- `project_reviewer_history_data_quality.md` — accurate.
- `project_reviewer_lifecycle_automation.md` — direction memory.
- `project_reviewer_postgres_to_dataverse_migration.md` — verified all 4 adapters exist (`contact.js`, `potential-reviewer.js`, `researcher.js`, `reviewer-suggestion.js` in `lib/dataverse/adapters/`); plan doc exists.
- `project_sharepoint_integration.md` — except for archive path (S9), accurate.
- `project_staged_review_pipeline.md` — accurate; both plan docs exist.
- `project_virtual_review_panel.md` — accurate.
- `project_w6_table_drop_pending.md` — accurate; trigger 2026-07-01, not yet due.
- `project_wave1_onboarding.md` — accurate (`lib/services/onboarding.js` correctly identified as "to be created"; not built yet).
- `project_wave1_pending.md` — verified migration file `lib/db/migrations/007_drop_wave1_tables.sql` exists; settings-service dispatcher fail-loud confirmed.
- `user_powerautomate.md` — user fact, no state claims.

---

## Suggested fix order (if you want to act on findings)

1. **C1 + S4 + S2 + S1** — these are direct factual corrections; each is a one-line edit. Highest value because they're the kind of claims I'd act on in a future session.
2. **S8 + S9 + S10 + S11** — bulk archive-path fixes; same edit pattern across 4 memories.
3. **S3 + S6** — reframe-from-planning-to-shipped edits. Slightly more involved.
4. **V1 + V2 + V5** — soften or status-line additions. Cleanup, not correctness.
5. **S5 + S7 + S12** — small hedges and line-number drops.
6. **C3** — optional cross-linking.

I have not edited any memory files. Confirm what to apply and I'll batch the edits.
