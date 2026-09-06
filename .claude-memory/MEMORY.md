# Project Memory Router

> Auto-loaded retrieval index: terse triggers point to hubs and live hazards.
> Source, probes, and the Atlas override memory; mark contradicted leaves stale.

## Startup
- Current handoff: ../SESSION_PROMPT.md
- Agent wiki index: ../docs/agent-wiki/index.md
- Current priority queue: ../docs/CURRENT_WORK_QUEUE.md
- Live-state ownership Atlas: ../docs/APPLICATION_STATE_ATLAS.md
- Ground-truth rules: ../CLAUDE.md
- Memory hygiene / router edits: ../docs/MEMORY_HYGIENE_RUNBOOK.md; ../.claude/rules/durable-docs.md; project-memory-router-trap-prevention.md
- Stop-hook staleness acks: reference-staleness-ack-markers-single-line.md

## Always-Read Guardrails
- Carryover / destructive work: feedback-verify-before-destructive-carryover.md; feedback-list-and-confirm-before-bulk-deletes.md
- Evidence / reconciliation: ../.claude/skills/sweep/SKILL.md; ../.claude/skills/contract-reconcile/SKILL.md; ../.claude/rules/durable-docs.md
- Red gates / test trust: ../docs/CI_GATES_REFERENCE.md; feedback-red-gates-are-p0.md
- External systems / literals: feedback-verify-external-platform-claims.md; feedback-no-fabricated-placeholder-values.md
- Delegated work: ../docs/AGENT_COLLABORATION_PLAN.md; feedback-codex-delegation-review-vs-rescue-routing.md; reference-codex-review-needs-a-committed-diff.md
- Environment / deployment: ../docs/agent-wiki/topics/dev-environment.md; feedback-deployment-monitoring-use-inspect.md; feedback-no-vercel-cli-update-reminders.md; reference-vercel-sensitive-env-unreadable.md
- Vercel runtime cannot require(esm) / sanitize-html pin: project-vercel-node22-no-require-esm.md; project-jsdom-serverless-esm-incompat.md
- Production data access: feedback-never-self-authorize-prod-dataverse-reads.md
- Production smoke residue / cleanup scope: project-test-residue-cleanup-is-for-data-mining.md

## Working Norms
- Performance/caching/refactor plans: feedback-latency-plan-scope-accretion-postmortem.md
- Git / releases: ../docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md; feedback-verify-branch-before-git-action.md; feedback-scope-git-stash-in-shared-worktrees.md
- Action affordances / UI gating: feedback-ui-gates-must-mirror-server-guards.md
- Tunables / mutable parameters: feedback-mutable-parameters-not-in-code.md
- Reviewer product decisions: feedback-prioritize-contact-recall-over-identity-precision.md; feedback-manual-affiliation-edit-no-coi-recheck.md; project-institution-identity-cost-calibration.md
- Audits / completion: feedback-vacuous-clean-results-print-the-denominator.md; feedback-apply-measurement-artifacts-in-both-directions.md; feedback-briefs-are-snapshots-not-ship-state.md
- Review posture: feedback-read-the-implementation-not-the-callers-docblock.md; feedback-weigh-the-risks-you-name.md; feedback-corrections-decay-unless-mechanized.md; feedback-consistency-over-preview-rationale.md
- Test teeth / mutation checks: feedback-mutation-test-with-the-discriminating-fixture.md
- Tone / user context: feedback-no-performative-contrition.md; feedback-user-facing-error-copy-voice.md
- Search / schema language: feedback-grep-general-codebase-terms.md; feedback-human-legibility-schema-principle.md

## Task Routing
- Reviewer origination / retrieval / excluded-reviewer intake: ../docs/agent-wiki/topics/reviewer-origination.md; project-reviewer-sourcing-constraints.md; ../docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md
- Reviewer identity / finding / contact / COI: ../docs/agent-wiki/topics/reviewer-identity.md; ../docs/REVIEWER_IDENTITY_CONTACT_PLAN.md; project-reviewer-verify-fail-dangerous.md
- Contact promotion / lifecycle: ../docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md; ../docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
- Reviewer address trust: ../docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md; ../docs/REVIEWER_EMAIL_CONFLICT_SELF_SERVICE_PLAN.md
- Reviewer workbench / lifecycle / roster / referral: ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md; project-workbench-consolidation-rollout.md
- Lifecycle Stages 2/3/5/7 autonomy grant + orchestration cycle (S489): project-reviewer-lifecycle-autonomy-directive-2026-09-05.md
- Accepted-awaiting-materials is transient / release-modal smoke deferred to first real acceptance: project-accepted-awaiting-materials-is-transient.md
- Candidate-card simplification / matching-layer sequencing / COI split: project-reviewer-card-simplification-direction.md; feedback-affordance-consistency-beats-deduplication.md
- Reviewer workflow stabilization / Request 1002912: ../docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md; ../outputs/reviewer-workflow-stabilization-fable-assessment.md
- Reviewer Find latency / warm reconciliation / Request 1002903: feedback-latency-plan-scope-accretion-postmortem.md; ../docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md
- Reviewer-invite local testing / capture side effects: reviewer-invite-capture-mode-not-full-sandbox.md
- External reviewer portal / accept / forms / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md; ../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md
- Review-form multiselect: ../docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md
- Reviewer closeout / reliability: project-reviewer-closeout-payability.md; project-reviewer-reliability-data.md
- Dataverse / Dynamics / Explorer / CRM facts: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Dynamics Explorer behavior campaign / SoCal vernacular / Explorer telemetry+eval: ../docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md; project-dynamics-explorer-socal-campaign.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md; project-prompt-governance.md
- Initial Assessment registry/controls and Final Writeup lineage/review: ../docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md; ../docs/atlas/dataverse-wmkf-requestdocument.md; ../docs/FINAL_WRITEUP_REVIEW_IMPLEMENTATION_PLAN.md; project-j27-doc-capture-evolution.md; project-reviewer-apps-redesign-direction.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Auth / admin / access / security / private Blob: ../docs/agent-wiki/topics/security-auth.md; ../docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md; project-reviewer-org-open-access-by-design.md
- Intake portal / attachments / institution match / virus scan: ../docs/agent-wiki/topics/intake-portal.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Grantee / email templates: ../docs/GRANTEE_PORTAL_SPEC.md; project-grantee-deliverable-email-voice.md; project-email-template-token-syntax.md
- Deferred cleanup / dead code: project-deferred-code-cleanup.md
- Invitation-link validation strictness (post-cycle decision): project-invitation-link-strictness-open-decision.md
- Public privacy / history remediation: ../docs/audits/public-repository-pii-history-audit-2026-07-27.md; ../docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md

## Archive
- Closed & shipped work index: project-closed-work-archive.md
