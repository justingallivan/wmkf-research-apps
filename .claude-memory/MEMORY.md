# Project Memory Router

> Auto-loaded retrieval index: terse triggers point to hubs and live hazards.
> Source, probes, and the Atlas override memory; mark contradicted leaves stale.

## Startup
- Current handoff: ../SESSION_PROMPT.md
- Agent wiki index: ../docs/agent-wiki/index.md
- Current priority queue: ../docs/CURRENT_WORK_QUEUE.md
- Live-state ownership Atlas: ../docs/APPLICATION_STATE_ATLAS.md
- Ground-truth rules: ../CLAUDE.md
- Memory hygiene / router edits: ../docs/MEMORY_HYGIENE_RUNBOOK.md; ../.claude/rules/durable-docs.md; project-memory-router-trap-prevention.md; reference-staleness-ack-markers-single-line.md (stop-hook staleness acks)

## Always-Read Guardrails
- Carryover / destructive work: feedback-verify-before-destructive-carryover.md; feedback-list-and-confirm-before-bulk-deletes.md
- Evidence / reconciliation: ../.claude/skills/sweep/SKILL.md; ../.claude/skills/contract-reconcile/SKILL.md; ../.claude/rules/durable-docs.md
- Red gates / test trust: ../docs/CI_GATES_REFERENCE.md; feedback-red-gates-are-p0.md; feedback-one-session-runs-gates-per-worktree.md
- External systems / literals: feedback-verify-external-platform-claims.md; feedback-no-fabricated-placeholder-values.md
- Delegated work / builds / review cadence / environment / deploy / Vercel / require(esm) / local containers / sandbox rehearsal / Factory ledger / audits and test evidence: ../docs/AGENT_COLLABORATION_PLAN.md; ../docs/agent-wiki/topics/dev-environment.md (Durable Memory); project-agent-worktree-base-is-main.md; project-vercel-workflow-runs-pinned-to-deployment.md
- Production data access: feedback-never-self-authorize-prod-dataverse-reads.md
- Production smoke residue / cleanup scope: project-test-residue-cleanup-is-for-data-mining.md

## Working Norms
- Performance/caching/refactor plans; safety machinery vs usage volume: feedback-latency-plan-scope-accretion-postmortem.md; feedback-scale-safety-machinery-to-usage.md
- Multi-session features / MVP drift / owner review burden: feedback-anchor-multisession-features-to-the-original-ask.md; feedback-owner-review-burden-must-shrink.md; changing the owner's named input source: feedback-keep-the-owners-named-input-source.md
- J27 Workbench Research-only scope / Research membership by Grant program (not Program field) / SoCal separate app, Final Writeup parked (Stage 4–5 recipient hazard): project-workbench-is-research-only.md; project-program-field-retired-use-grant-program.md; project-j27-cycle-page-redesign-pending.md; project-socal-writeup-workflow-parked.md
- Git / releases: ../docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md; feedback-verify-branch-before-git-action.md; feedback-scope-git-stash-in-shared-worktrees.md
- Migration numbers / schema_migrations / branch-applied migrations: project-migration-numbers-claimed-off-main.md
- Action affordances / UI gating: feedback-ui-gates-must-mirror-server-guards.md; feedback-match-existing-ui-patterns.md; ordered workflows as one guided action: feedback-ordered-workflows-as-one-action.md
- Tunables / cycle-scoped settings / per-cycle allowlists / PD campaign settings vs central defaults: feedback-mutable-parameters-not-in-code.md; feedback-minimize-per-cycle-configuration.md; feedback-centralize-over-pd-specific-settings.md
- Test venue (default: Production test requests, not sandbox) / Factory safety vs fidelity / sandbox Request creates and derived status: feedback-factory-safe-not-full-fidelity.md; feedback-question-the-rehearsal-venue.md; project-sandbox-request-status-business-rules.md
- Tone / user context: feedback-no-performative-contrition.md; feedback-user-facing-error-copy-voice.md; item codes in owner/colleague text: feedback-no-item-codes-in-owner-facing-text.md
- Legacy labels / interim trims on surfaces with a decided target: feedback-skip-legacy-fixes-that-the-target-state-removes.md
- Search / schema language: feedback-grep-general-codebase-terms.md; feedback-human-legibility-schema-principle.md; feedback-staff-ui-never-shows-internal-ids.md; feedback-staff-ui-desktop-first.md

## Task Routing
- Grant Reporting / Literature Analyzer: project-grant-reporting-rework.md; project-literature-analyzer-rework.md
- Reviewer origination / retrieval / excluded-reviewer intake: ../docs/agent-wiki/topics/reviewer-origination.md; ../docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md
- Reviewer identity / finding / contact / COI / verify-fail safety / contact promotion / address lifecycle / product decisions: ../docs/agent-wiki/topics/reviewer-identity.md (Durable Memory); ../docs/agent-wiki/topics/reviewer-address-referrals.md; ../docs/REVIEWER_IDENTITY_CONTACT_PLAN.md; ../docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md; feedback-prioritize-contact-recall-over-identity-precision.md
- Reviewer workbench / lifecycle / roster / referral / closeout / invite capture / candidate card / stabilization (1002912): ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md (Durable Memory)
- External reviewer portal / accept / forms / multiselect / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md
- Dataverse / Dynamics / Explorer (incl. behavior campaign) / CRM facts / SharePoint DOCX-XLSX byte identity: ../docs/agent-wiki/topics/dataverse-dynamics.md (Durable Memory)
- Prompt / Executor / prompt governance / thinking-budget truncation: ../docs/agent-wiki/topics/prompt-executor.md (Durable Memory)
- Initial Assessment registry/controls and Final Writeup lineage/review: ../docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md; ../docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md; ../docs/agent-wiki/topics/intake-portal.md (J27)
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Auth / admin / access / org-open reviewer access / private Blob: ../docs/agent-wiki/topics/security-auth.md; ../docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md
- Intake portal / attachments / institution match / virus scan / pre-flight prompts (CSO workbook): ../docs/agent-wiki/topics/intake-portal.md
- Site Visit materials / applicant additional materials / briefing room: ../docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md; project-site-visit-materials-planning-handoff.md
- Research request file corpus / SharePoint file inventory / pre-2018 parked (microfiche): ../docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md
- Cross-visit D26 sentiment vs ranking / discussion misattribution diagnosis: project-d26-cross-visit-sentiment-ranking-study.md; ../docs/plans/DISCUSSION_MISATTRIBUTION_BRIEF_2026-10-17.md
- PC Meeting Tracker / sessions / visits / agenda email / Staff Deliberations rail: ../docs/PC_MEETING_TRACKER_PLAN.md; project-deliberation-session-precedes-site-visit.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Grantee / email templates: ../docs/GRANTEE_PORTAL_SPEC.md; project-grantee-deliverable-email-voice.md; project-email-template-token-syntax.md
- Deferred cleanup / dead code / invitation-link strictness (open decision): project-deferred-code-cleanup.md; project-invitation-link-strictness-open-decision.md
- Public privacy / history remediation: ../docs/audits/public-repository-pii-history-audit-2026-07-27.md; ../docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md

## Archive
- History / completed-work index: project-closed-work-archive.md
