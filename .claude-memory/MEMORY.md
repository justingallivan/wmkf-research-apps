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
- Delegated work: feedback-share-codex-verbatim.md; feedback-surface-full-review-findings.md; ../docs/AGENT_COLLABORATION_PLAN.md
- Environment / deployment: ../docs/agent-wiki/topics/dev-environment.md; feedback-deployment-monitoring-use-inspect.md; reference-vercel-sensitive-env-unreadable.md

## Working Norms
- Git / releases: feedback-verify-branch-before-git-action.md; project-commit-directly-to-main.md; ../docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
- Reviewer product decisions: feedback-prioritize-contact-recall-over-identity-precision.md; feedback-manual-affiliation-edit-no-coi-recheck.md
- Audits / completion: feedback-vacuous-clean-results-print-the-denominator.md; feedback-thoroughness-default.md; feedback-truncation-is-breakage-not-completion.md
- Review posture: feedback-self-review-before-delegating-review.md; feedback-author-adversarial-pass-first.md; feedback-dont-self-certify-convergence.md
- Tone / user context: feedback-no-performative-contrition.md; feedback-stakeholder-email-tone.md; feedback-review-panel-tone.md
- Search / schema language: feedback-grep-general-codebase-terms.md; feedback-human-legibility-schema-principle.md

## Task Routing
- Reviewer origination / retrieval: ../docs/agent-wiki/topics/reviewer-origination.md; project-reviewer-sourcing-constraints.md
- Reviewer identity / finding / contact / COI: ../docs/agent-wiki/topics/reviewer-identity.md; ../docs/REVIEWER_IDENTITY_CONTACT_PLAN.md; project-reviewer-verify-fail-dangerous.md
- Contact promotion / address lifecycle: ../docs/REVIEWER_CONTACT_PROMOTION_AND_ADDRESS_LIFECYCLE.md; ../docs/REVIEWER_FINDER_ENFORCEMENT_CONTRACTS.md (S389: accept promotes; send/decline do not)
- Reviewer workbench / lifecycle / roster / referral: ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md; project-workbench-consolidation-rollout.md
- Reviewer-invite local testing / capture side effects: reviewer-invite-capture-mode-not-full-sandbox.md
- External reviewer portal / accept / forms / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md; ../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md; project-reviewer-upload-dormant-not-deleted.md
- Review-form multiselect: ../docs/agent-wiki/topics/external-reviewer-portal.md; ../docs/REVIEW_FORM_MULTISELECT_BUILD_PLAN.md — implementation and production smoke are complete; broader exposure and rollback rehearsals remain held
- Reviewer closeout / reliability: project-reviewer-closeout-payability.md; project-reviewer-reliability-data.md
- Dataverse / Dynamics / Explorer / CRM facts: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md; project-prompt-governance.md; project-cache-hit-rate-review.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Auth / admin / access / security / private Blob: ../docs/agent-wiki/topics/security-auth.md; project-app-access-control.md; ../docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md
- Intake portal / attachments / institution match / virus scan: ../docs/agent-wiki/topics/intake-portal.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Dev environment / secrets / Vercel / CI / local build: ../docs/agent-wiki/topics/dev-environment.md; ../docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
- Strategy / current queue / roadmap / phasing: ../docs/CURRENT_WORK_QUEUE.md; ../docs/agent-wiki/topics/strategy-roadmap.md
- Grantee / email templates: ../docs/GRANTEE_PORTAL_SPEC.md; project-grantee-deliverable-email-voice.md; project-email-template-token-syntax.md
- Deferred cleanup / dead code: project-deferred-code-cleanup.md
- Public privacy / history remediation: ../docs/audits/public-repository-pii-history-audit-2026-07-27.md; ../docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md

## Archive
- Closed & shipped work index: project-closed-work-archive.md
