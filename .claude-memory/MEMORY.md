# Project Memory Router

> Routing table, not the memory itself. Each line answers: "for this task, which
> hub or high-risk memory do I read before acting?" Domain detail lives in the
> agent wiki; durable lessons live in leaf memory files; live structural state
> lives in source, probes, and the Atlas. If memory/wiki conflicts with code,
> Atlas, or a live probe, the live source wins and the stale surface must be
> marked `status: stale`.

## Startup
- Current handoff: ../SESSION_PROMPT.md
- Agent wiki index: ../docs/agent-wiki/index.md
- Current priority queue: ../docs/CURRENT_WORK_QUEUE.md
- Live-state ownership Atlas: ../docs/APPLICATION_STATE_ATLAS.md
- Ground-truth rules: ../CLAUDE.md
- Memory storage/routing contract: ../.claude/rules/durable-docs.md

## Always-Read Guardrails
- Carryover / destructive work: feedback-verify-before-destructive-carryover.md; feedback-list-and-confirm-before-bulk-deletes.md; feedback-verify-additive-carryover-not-just-destructive.md
- Evidence / reconciliation: ../.claude/skills/sweep/SKILL.md; ../.claude/skills/contract-reconcile/SKILL.md; ../.claude/rules/durable-docs.md
- Red gates / test trust: ../docs/CI_GATES_REFERENCE.md; feedback-red-gates-are-p0.md; feedback-green-requires-full-test-suite.md
- External systems / literals: feedback-verify-external-platform-claims.md; feedback-cite-ground-truth.md; feedback-no-fabricated-placeholder-values.md
- Delegated work: feedback-share-codex-verbatim.md; feedback-surface-full-review-findings.md; feedback-codex-delegation-review-vs-rescue-routing.md; reference-codex-review-needs-a-committed-diff.md; ../docs/AGENT_COLLABORATION_PLAN.md
- Environment / deployment: ../docs/agent-wiki/topics/dev-environment.md; feedback-deployment-monitoring-use-inspect.md; feedback-no-vercel-cli-update-reminders.md; reference-vercel-sensitive-env-unreadable.md
- Production data access: feedback-never-self-authorize-prod-dataverse-reads.md (never set DATAVERSE_ALLOW_PROD_READS yourself — hand over the command or ask and wait; applies to read-only probes and scratch diagnostics too)

## Working Norms
- Performance/caching/refactor plans: feedback-latency-plan-scope-accretion-postmortem.md (S395 debacle — scope accretion, tier-gate skip, fail-closed over legacy data, revert-first)
- Git / releases: feedback-verify-branch-before-git-action.md; project-commit-directly-to-main.md; ../docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md; feedback-scope-git-stash-in-shared-worktrees.md (multi-agent worktrees: never unscoped stash/revert); feedback-clear-jest-cache-in-shared-worktrees.md (clear Jest cache before citable verification after multi-agent edits when false reds appear; cache involvement remains unconfirmed)
- Action affordances / UI gating: feedback-ui-gates-must-mirror-server-guards.md (mirror the service's precondition guard in the enable condition; prefer a server-computed capability flag)
- Reviewer product decisions: feedback-prioritize-contact-recall-over-identity-precision.md; feedback-manual-affiliation-edit-no-coi-recheck.md; project-institution-identity-cost-calibration.md (alert-tier false clears cheap — reviewer self-corrects; identity-bind tier stays strict)
- Audits / completion: feedback-vacuous-clean-results-print-the-denominator.md; feedback-thoroughness-default.md; feedback-truncation-is-breakage-not-completion.md; feedback-apply-measurement-artifacts-in-both-directions.md; feedback-briefs-are-snapshots-not-ship-state.md (check DEVELOPMENT_LOG/git log before repeating any doc's status claim — a brief's open risk or a plan's "not started"; for another agent's work enumerate branches, not worktrees)
- Review posture: feedback-read-the-implementation-not-the-callers-docblock.md (a caller's comment about a write is a scoped summary — read the writing function); feedback-self-review-before-delegating-review.md; feedback-author-adversarial-pass-first.md; feedback-dont-self-certify-convergence.md; feedback-weigh-the-risks-you-name.md (a named risk is not a discharged risk; settle soundness before asking polish questions)
- Test teeth / mutation checks: feedback-mutation-test-with-the-discriminating-fixture.md (pick the fixture where the correct and buggy predicates disagree; a mutation that leaves the suite green means the test is decorative)
- Tone / user context: feedback-no-performative-contrition.md; feedback-stakeholder-email-tone.md; feedback-review-panel-tone.md; feedback-user-facing-error-copy-voice.md
- Search / schema language: feedback-grep-general-codebase-terms.md; feedback-human-legibility-schema-principle.md

## Task Routing
- Reviewer origination / retrieval / excluded-reviewer intake: ../docs/agent-wiki/topics/reviewer-origination.md; project-reviewer-sourcing-constraints.md; ../docs/EXCLUDED_REVIEWERS_STRUCTURED_INTAKE_PLAN.md
- Reviewer identity / finding / contact / COI: ../docs/agent-wiki/topics/reviewer-identity.md; ../docs/REVIEWER_IDENTITY_CONTACT_PLAN.md; project-reviewer-verify-fail-dangerous.md
- Contact promotion / lifecycle: ../docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md; ../docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md
- Reviewer address trust: ../docs/agent-wiki/topics/reviewer-identity.md; ../docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md; ../docs/REVIEWER_EMAIL_CONFLICT_SELF_SERVICE_PLAN.md
- Reviewer workbench / lifecycle / roster / referral: ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md; project-workbench-consolidation-rollout.md
- Candidate-card simplification / matching-layer sequencing / COI split: project-reviewer-card-simplification-direction.md; feedback-affordance-consistency-beats-deduplication.md
- Reviewer workflow stabilization / Request 1002912: ../docs/REVIEWER_WORKFLOW_STABILIZATION_DIRECTIVE.md (Phase -1 done, findings accepted); ../outputs/reviewer-workflow-stabilization-fable-assessment.md (read §0 first — it supersedes the body); ../SESSION_PROMPT.md (Codex Slice A work order).
- Reviewer Find latency (increments A/C/D LIVE through S399; read postmortem before ANY expansion) / warm incident (RESOLVED S396) / Request 1002903: ../SESSION_PROMPT.md; ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md; feedback-latency-plan-scope-accretion-postmortem.md; project-reviewer-find-usage-cadence-blocks-observation-windows.md; ../docs/REVIEWER_FIND_WARM_RECONCILIATION_INCIDENT_2026-08-03.md; superseded: ../docs/REVIEWER_FIND_PERFORMANCE_PLAN.md, ../docs/REVIEWER_WARM_STAGE_PRODUCER_SPEC.md.
- Reviewer-invite local testing / capture side effects: reviewer-invite-capture-mode-not-full-sandbox.md
- External reviewer portal / accept / forms / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md; ../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md; project-reviewer-upload-dormant-not-deleted.md
- Review-form multiselect: ../docs/agent-wiki/topics/external-reviewer-portal.md; ../docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md — implementation and production smoke are complete; broader exposure and rollback rehearsals remain held
- Reviewer closeout / reliability: project-reviewer-closeout-payability.md; project-reviewer-reliability-data.md
- Dataverse / Dynamics / Explorer / CRM facts: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Dynamics Explorer behavior campaign / SoCal vernacular / Explorer telemetry+eval: ../docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md; project-dynamics-explorer-socal-campaign.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md; project-prompt-governance.md; project-cache-hit-rate-review.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Auth / admin / access / security / private Blob: ../docs/agent-wiki/topics/security-auth.md; project-app-access-control.md; ../docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md; project-reviewer-org-open-access-by-design.md; project-merge-candidates-authorization-gap.md (org-open reviewer/document access accepted by-design 2026-08-15; no Dataverse request/data ownership to scope against)
- Intake portal / attachments / institution match / virus scan: ../docs/agent-wiki/topics/intake-portal.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Dev environment / secrets / Vercel / CI / local build: ../docs/agent-wiki/topics/dev-environment.md; ../docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
- Strategy / current queue / roadmap / phasing: ../docs/CURRENT_WORK_QUEUE.md; ../docs/agent-wiki/topics/strategy-roadmap.md
- Grantee / email templates: ../docs/GRANTEE_PORTAL_SPEC.md; project-grantee-deliverable-email-voice.md; project-email-template-token-syntax.md
- Deferred cleanup / dead code: project-deferred-code-cleanup.md
- Public privacy / history remediation: ../docs/audits/public-repository-pii-history-audit-2026-07-27.md; ../docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md

## Archive
- Closed & shipped work index: project-closed-work-archive.md
