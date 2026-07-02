---
title: Docs Staleness Audit - 2026-06-28
domain: docs-governance
kind: audit
status: historical
summary: "- For ARCHIVE items with inbound references, prefer adding or tightening a top-of-file Status: historical banner in place unless Justin also wants..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/archive/
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/AI_DATA_FLOW_MATRIX.md
---

# Docs Staleness Audit - 2026-06-28

> **Action taken 2026-06-28:** all recommendations executed. The 2 DELETEs removed
> (the unreferenced `memory-wiki-*-PROMPT-2026-06-23.md` prompt files, after an
> independent 0-inbound-reference re-check). The **39 ARCHIVE files** (the table below
> lists 39; the summary's "40" was an off-by-one) were **moved to `docs/archive/`**,
> with every inbound full-path reference rewritten across docs, memory, and code
> comments; all doc gates green. KEEP items unchanged. Paths in the tables below are the
> **original pre-move locations** (this report is left as the audit snapshot).

Scope: all 309 markdown files under `docs/` were scanned for dated filenames, point-in-time audit/review markers, shipped/superseded status banners, and durable-reference candidates. Existing `docs/archive/**` files are treated as already archived unless a live path points at them. This report is recommend-only; no source doc should be moved or deleted without a final reference grep immediately before action.

Reference guard: before recommending DELETE, I checked inbound references by exact path and basename across `docs/`, `.claude-memory/`, and repo code roots. The DELETE candidates below had 0 inbound references outside this new audit report at the time of the check. Anything with inbound references is ARCHIVE or KEEP, not DELETE.

## Summary

| Recommendation | Count | Meaning |
|---|---:|---|
| KEEP | 21 | Durable, current, or still serving as a live source/reference despite age. |
| ARCHIVE | 40 | Historical, superseded, shipped, or one-off; preserve or move only with reference updates. |
| DELETE | 2 | Unreferenced prompt artifacts with no durable findings content. |

## KEEP

| File | Reason + evidence |
|---|---|
| `docs/API_ROUTE_SECURITY_MATRIX.md` | KEEP - living route-auth inventory; `Last updated: 2026-06-25` and purpose says it is the living authorization inventory (`docs/API_ROUTE_SECURITY_MATRIX.md:3`, `docs/API_ROUTE_SECURITY_MATRIX.md:7`). |
| `docs/APPLICATION_STATE_ATLAS.md` | KEEP - canonical state router; it explicitly tells agents to use per-entity pages before data-layer claims (`docs/APPLICATION_STATE_ATLAS.md:20`). |
| `docs/AI_DATA_FLOW_MATRIX.md` | KEEP - current data-flow matrix with a recent update and active disposition section (`docs/AI_DATA_FLOW_MATRIX.md:3`, `docs/AI_DATA_FLOW_MATRIX.md:28`). |
| `docs/BUDGET_FORM_SPEC.md` | KEEP - old but still active unresolved design spec; it says the v3 scope carries forward and has an unresolved drain-vs-PA conflict (`docs/BUDGET_FORM_SPEC.md:3`, `docs/BUDGET_FORM_SPEC.md:5`, `docs/BUDGET_FORM_SPEC.md:233`). |
| `docs/CI_GATES_REFERENCE.md` | KEEP - gate mechanics source, not a dated artifact; it describes active P0 and drift gate rules (`docs/CI_GATES_REFERENCE.md:3`, `docs/CI_GATES_REFERENCE.md:5`). |
| `docs/REVIEWER_ARCHITECTURE.md` | KEEP - durable current model updated after the S213 collapse, not stale despite a superseded-in-part banner (`docs/REVIEWER_ARCHITECTURE.md:3`, `docs/REVIEWER_ARCHITECTURE.md:5`). |
| `docs/REVIEWER_DATA_MODEL.md` | KEEP - durable reviewer model summary that defers entity detail to Atlas pages (`docs/REVIEWER_DATA_MODEL.md:3`, `docs/REVIEWER_DATA_MODEL.md:5`). |
| `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md` | KEEP - still referenced as the memory routing contract; the doc defines the compact-router target (`docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md:24`; `.claude-memory/MEMORY.md:16`). |
| `docs/CLAUDE_SKILL_REMEDIATION_PLAN.md` | KEEP - durable skill-pattern guidance, not event output; it defines recurring verification failure modes and desired skill pattern (`docs/CLAUDE_SKILL_REMEDIATION_PLAN.md:7`, `docs/CLAUDE_SKILL_REMEDIATION_PLAN.md:21`). |
| `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md` | KEEP - build plan remains gated on a named prerequisite, not closed; status says ready once `wmkf_portalmembership` exists (`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:3`, `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:25`). |
| `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md` | KEEP - heavily referenced migration history with explicit Atlas override; moving it would break many pointers unless updated (`docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:11`, `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:13`; `lib/services/database-service.js:146`). |
| `docs/REVIEWER_FINDER_ORIGINATION_PLAN.md` | KEEP - active plan; status says ACTIVE PLAN and links the S246 experiment result (`docs/REVIEWER_FINDER_ORIGINATION_PLAN.md:5`). |
| `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md` | KEEP - dated, but it settles the live origination direction and is cited by current flow docs (`docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:5`; `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md:15`). |
| `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md` | KEEP - operational plan for the D26 Phase-I reviewer pipeline, not a closed audit (`docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md:5`, `docs/REVIEWER_FINDER_D26_PIPELINE_FLOWCHART.md:6`). |
| `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` | KEEP - shipped, but still the ground-truth inventory for `check:prompt-injection-tagging` and memory references (`docs/security-audit/A7_PROMPT_INJECTION_PLAN.md:3`, `scripts/check-prompt-injection-tagging.js:8`). |
| `docs/security-audit/SECURITY_AUDIT_2026-06-11.md` | KEEP - latest broad security audit and still referenced by fixes/code comments (`docs/security-audit/SECURITY_AUDIT_2026-06-11.md:5`, `shared/utils/apiKeyManager.js:8`). |
| `docs/security-audit/SECURITY_AUDIT_REMEDIATION_PLAN_2026-06-11.md` | KEEP - not fully closed; source table still has open moderate dependency advisories (`docs/security-audit/SECURITY_AUDIT_REMEDIATION_PLAN_2026-06-11.md:16`). |
| `docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md` | KEEP - parked/inert design with an explicit current decision and active memory/P2 references (`docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md:3`, `docs/security-audit/DOWNLOAD_PROXY_DESIGN_2026-06-11.md:14`; `.claude-memory/project-download-proxy-parked.md:11`). |
| `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md` | KEEP - residual migration tracker with current rollout state, not just the old May audit (`docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md:3`, `docs/security-audit/P2_PRIVATE_BLOB_MIGRATION.md:6`). |
| `docs/security-audit/SECURITY_AUDIT_RUNBOOK.md` | KEEP - repeatable audit runbook, last updated 2026-06-11 (`docs/security-audit/SECURITY_AUDIT_RUNBOOK.md:3`, `docs/security-audit/SECURITY_AUDIT_RUNBOOK.md:5`). |
| `docs/audits/memory-wiki-audit-2026-06-23.md` | KEEP - already stored under `docs/audits/` as a point-in-time report and explicitly says edit scope was report-only (`docs/audits/memory-wiki-audit-2026-06-23.md:3`, `docs/audits/memory-wiki-audit-2026-06-23.md:6`). |

## ARCHIVE

| File | Reason + evidence |
|---|---|
| `docs/CODEX_REVIEW_CLAUDE_AUDIT_FIXES_2026_05_26.md` | ARCHIVE - one-off dated Codex review of a May 26 implementation (`docs/CODEX_REVIEW_CLAUDE_AUDIT_FIXES_2026_05_26.md:3`, `docs/CODEX_REVIEW_CLAUDE_AUDIT_FIXES_2026_05_26.md:7`). |
| `docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md` | ARCHIVE - top banner says both actionable findings are resolved and drain cleanup is superseded; it is retained as historical (`docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md:5`, `docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md:9`, `docs/CORRECTED_AUDIT_FINDINGS_FOR_CLAUDE_REVIEW_2026_05_26.md:12`). |
| `docs/APPRESEARCHER_COLLAPSE_VALIDATION_FINDINGS_2026-06-03.md` | ARCHIVE - dated validation report; canonical docs already mark the collapse shipped (`docs/APPRESEARCHER_COLLAPSE_VALIDATION_FINDINGS_2026-06-03.md:1`, `docs/APPRESEARCHER_COLLAPSE_VALIDATION_FINDINGS_2026-06-03.md:33`). |
| `docs/APPRESEARCHER_COLLAPSE_PLAN.md` | ARCHIVE - status says executed via the lighter V2 cutover and this S196 doc remains historical (`docs/APPRESEARCHER_COLLAPSE_PLAN.md:3`). |
| `docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md` | ARCHIVE - status says executed 2026-06-02 and all phases are done (`docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md:3`). |
| `docs/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md` | ARCHIVE - dated read-only probe output supporting the executed appresearcher collapse (`docs/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md:1`, `docs/DATAVERSE_LIVE_PROBE_FINDINGS_2026-06-02.md:3`). |
| `docs/DATAVERSE_CUSTOM_TABLES_2026-06-05.md` | ARCHIVE - point-in-time snapshot explicitly not gate-maintained and likely to drift (`docs/DATAVERSE_CUSTOM_TABLES_2026-06-05.md:1`, `docs/DATAVERSE_CUSTOM_TABLES_2026-06-05.md:3`). |
| `docs/DOC_TRIAGE_2026-05-07.md` | ARCHIVE - obsolete triage snapshot says repo had 119 markdown docs, while current scan found 309 (`docs/DOC_TRIAGE_2026-05-07.md:3`, `docs/DOC_TRIAGE_2026-05-07.md:5`). |
| `docs/DOCS_GROUND_TRUTH_AUDIT_2026-05-19.md` | ARCHIVE - historical documentation incident report, not current guidance (`docs/DOCS_GROUND_TRUTH_AUDIT_2026-05-19.md:1`, `docs/DOCS_GROUND_TRUTH_AUDIT_2026-05-19.md:13`). |
| `docs/READINESS_AUDIT_2026-05-25.md` | ARCHIVE - point-in-time backend audit with frontmatter declaring `fact_consistency: point-in-time` (`docs/READINESS_AUDIT_2026-05-25.md:1`, `docs/READINESS_AUDIT_2026-05-25.md:4`). |
| `docs/READINESS_AUDIT_2026-05-25_CODEX_REPORT.md` | ARCHIVE - companion discussion report for the May 25 audit (`docs/READINESS_AUDIT_2026-05-25_CODEX_REPORT.md:3`, `docs/READINESS_AUDIT_2026-05-25_CODEX_REPORT.md:7`). |
| `docs/READINESS_AUDIT_PHASE0_PLAN.md` | ARCHIVE - point-in-time emergency closeout plan; code comments still cite it, so move only with reference updates (`docs/READINESS_AUDIT_PHASE0_PLAN.md:1`, `docs/READINESS_AUDIT_PHASE0_PLAN.md:4`; `scripts/apply-migrations.js:22`). |
| `docs/CODEBASE_EVALUATION_2026-05-29.md` | ARCHIVE - dated read-only background workflow; it warns some prod claims may have been resolved since (`docs/CODEBASE_EVALUATION_2026-05-29.md:4`, `docs/CODEBASE_EVALUATION_2026-05-29.md:18`). |
| `docs/MEMORY_REORG_AUDIT_2026-06-04.md` | ARCHIVE - dated Codex audit with no memory edits applied (`docs/MEMORY_REORG_AUDIT_2026-06-04.md:1`, `docs/MEMORY_REORG_AUDIT_2026-06-04.md:5`). |
| `docs/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md` | ARCHIVE - handoff brief for a cleanup that has since become memory/wiki operating context; update its three inbound refs if moved (`docs/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md:1`, `docs/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md:5`; `docs/agent-wiki/log.md:32`). |
| `docs/BUDGET_FORM_SPEC_CODEX_REVIEW.md` | ARCHIVE - first-pass review artifact against the budget spec, superseded by V2 findings (`docs/BUDGET_FORM_SPEC_CODEX_REVIEW.md:1`, `docs/BUDGET_FORM_SPEC_CODEX_REVIEW_V2.md:3`). |
| `docs/BUDGET_FORM_SPEC_CODEX_REVIEW_V2.md` | ARCHIVE - review-verification artifact, not the authoritative spec (`docs/BUDGET_FORM_SPEC_CODEX_REVIEW_V2.md:1`, `docs/BUDGET_FORM_SPEC_CODEX_REVIEW_V2.md:5`). |
| `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN_CODEX_REVIEW.md` | ARCHIVE - first review pass; build plan says v4 was revised against three Codex review passes and closes the findings (`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN_CODEX_REVIEW.md:1`, `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:3`). |
| `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN_CODEX_REVIEW_V2.md` | ARCHIVE - intermediate review status table, superseded by v4 plan closure (`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN_CODEX_REVIEW_V2.md:1`, `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:3`). |
| `docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN_CODEX_REVIEW_V3.md` | ARCHIVE - final review pass folded into the v4 build plan; keep only as historical review evidence (`docs/INTAKE_ADMIN_MEMBERSHIPS_BUILD_PLAN.md:3`). |
| `docs/INTAKE_PORTAL_SCHEMA_REVIEW_2026-05-14.md` | ARCHIVE - dated schema review now used as historical evidence by memories; current schema belongs in catalog/Atlas (`.claude-memory/project-slice0-scope.md:23`, `.claude-memory/feedback-human-legibility-schema-principle.md:25`). |
| `docs/GEMINI_CODE_REVIEW_SUGGESTIONS.md` | ARCHIVE - third-party suggestion source reviewed by a later Codex action plan (`docs/CODEX_GEMINI_SUGGESTIONS_ACTION_PLAN.md:5`). |
| `docs/CODEX_GEMINI_SUGGESTIONS_ACTION_PLAN.md` | ARCHIVE - action plan later executed by Claude per the handoff report (`docs/CODEX_HANDOFF_REPORT_2026-05-12.md:3`). |
| `docs/CODEX_HANDOFF_REPORT_2026-05-12.md` | ARCHIVE - dated handoff and post-execution review of shipped phases (`docs/CODEX_HANDOFF_REPORT_2026-05-12.md:1`, `docs/CODEX_HANDOFF_REPORT_2026-05-12.md:7`). |
| `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_EVALUATION.md` | ARCHIVE - initial rollout evaluation with observation pending; current authority is `docs/CLAUDE_INSTRUCTION_AUTHORITY.md` (`docs/CLAUDE_INSTRUCTION_ARCHITECTURE_EVALUATION.md:3`, `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_EVALUATION.md:4`, `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_EVALUATION.md:5`). |
| `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REMEDIATION_PLAN.md` | ARCHIVE - implementation plan says initial implementation complete and trials pending; authority now lives elsewhere (`docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REMEDIATION_PLAN.md:3`, `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REMEDIATION_PLAN.md:4`, `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REMEDIATION_PLAN.md:24`). |
| `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md` | ARCHIVE - S225 one-off review response against the cleanup plan (`docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md:3`, `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_REVIEW_RESPONSE.md:5`). |
| `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md` | ARCHIVE - proposed cleanup plan for an already-remediated architecture workstream (`docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md:3`, `docs/CLAUDE_INSTRUCTION_ARCHITECTURE_CLEANUP_PLAN.md:4`). |
| `docs/REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md` | ARCHIVE - banner says W3-W6 workstreams shipped and the April narrative is retained for historical context (`docs/REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md:3`, `docs/REVIEWER_FINDER_DATAVERSE_CUTOVER_PLAN.md:5`). |
| `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md` | ARCHIVE - evidence record whose stronger claims were corrected and whose role is to inform, not refute, active direction (`docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md:3`, `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md:10`, `docs/REVIEWER_FINDER_ORIGINATION_EVIDENCE_2026-06-12.md:24`). |
| `docs/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md` | ARCHIVE - S239 probe handoff with verdict reached and no build started; later experiment/plan docs now carry the direction (`docs/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md:3`, `docs/REVIEWER_FINDER_ORIGINATION_PROBE_FINDINGS.md:4`, `docs/REVIEWER_FINDER_ORIGINATION_EXPERIMENT_2026-06-12.md:5`). |
| `docs/REVIEWER_FINDER_REVIEW_REQUEST.md` | ARCHIVE - explicitly labeled a historical one-shot and not a live request (`docs/REVIEWER_FINDER_REVIEW_REQUEST.md:3`, `docs/REVIEWER_FINDER_REVIEW_REQUEST.md:8`). |
| `docs/REVIEWER_IDENTITY_VERIFICATION_FINDINGS.md` | ARCHIVE - supporting Codex trace for a shipped fix plan, now referenced from the plan as a related artifact (`docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md:14`, `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md:16`). |
| `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN_REVIEW.md` | ARCHIVE - dated read-only review of a fix plan (`docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN_REVIEW.md:3`, `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN_REVIEW.md:4`). |
| `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md` | ARCHIVE - status says SHIPPED and live boundary is now owned by enforcement contracts (`docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md:4`, `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md:9`, `docs/REVIEWER_IDENTITY_CONTACT_FIX_PLAN.md:10`). |
| `docs/security-audit/SECURITY_AUDIT_2026-05-21.md` | ARCHIVE - older audit superseded by June security audit; move only with reference updates because migration/runbook still cite it (`docs/security-audit/SECURITY_AUDIT_2026-05-21.md:1`, `docs/security-audit/SECURITY_AUDIT_2026-05-21.md:34`; `docs/security-audit/SECURITY_AUDIT_RUNBOOK.md:11`). |
| `docs/security-audit/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md` | ARCHIVE - implementation design says pilot implemented/smoked and cohort promoted; P2 tracker is the live residual doc (`docs/security-audit/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md:3`, `docs/security-audit/PHASE_1_PRIVATE_BLOB_DESIGN_2026-06-11.md:5`). |
| `docs/security-audit/PHASE_2_EXECUTOR_TRANSPORT_DESIGN_2026-06-11.md` | ARCHIVE - phase design status says implemented 2026-06-11 (`docs/security-audit/PHASE_2_EXECUTOR_TRANSPORT_DESIGN_2026-06-11.md:3`). |
| `docs/security-audit/SEMGREP_AUDIT_REPORT.md` | ARCHIVE - March 9 scanner report; June audit says it was prior precedent, not refreshed results (`docs/security-audit/SEMGREP_AUDIT_REPORT.md:3`, `docs/security-audit/SEMGREP_AUDIT_REPORT.md:26`; `docs/security-audit/SECURITY_AUDIT_2026-06-11.md:182`). |

## DELETE

| File | Reason + evidence |
|---|---|
| `docs/audits/memory-wiki-audit-PROMPT-2026-06-23.md` | DELETE - unreferenced paste-in prompt, not the audit result; exact path/basename inbound reference check returned 0 outside this report, and the file says output lands elsewhere (`docs/audits/memory-wiki-audit-PROMPT-2026-06-23.md:1`, `docs/audits/memory-wiki-audit-PROMPT-2026-06-23.md:3`, `docs/audits/memory-wiki-audit-PROMPT-2026-06-23.md:4`). |
| `docs/audits/memory-wiki-fix-PROMPT-2026-06-23.md` | DELETE - unreferenced paste-in fix prompt for a one-time report; exact path/basename inbound reference check returned 0 outside this report (`docs/audits/memory-wiki-fix-PROMPT-2026-06-23.md:1`, `docs/audits/memory-wiki-fix-PROMPT-2026-06-23.md:3`, `docs/audits/memory-wiki-fix-PROMPT-2026-06-23.md:9`). |

## Action Notes

- For ARCHIVE items with inbound references, prefer adding or tightening a top-of-file `Status: historical` banner in place unless Justin also wants the referencing paths updated in the same change.
- For top-level docs that move to `docs/archive/`, update every exact-path reference first, then run `npm run check:doc-symbol-refs` and `npm run check:canonical-pointers` sequentially.
- Re-run the DELETE inbound-reference grep immediately before deletion; this report's check is current as of 2026-06-28 only, and this report itself will now appear as an audit/reference hit.
