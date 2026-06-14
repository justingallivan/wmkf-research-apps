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
- Live-state index for data-layer work: ../docs/APPLICATION_STATE_ATLAS.md
- Ground-truth / self-correction rules: ../docs/CLAUDE_REMEDIATION_PLAN.md
- Memory storage invariant: memory-store-propagation.md
- Memory routing contract: ../docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md; project-memory-router-trap-prevention.md

## Always-Read Guardrails
- Destructive carryover / bulk delete: feedback-verify-before-destructive-carryover.md; feedback-list-and-confirm-before-bulk-deletes.md
- Red CI gate or failing startup gate: feedback-red-gates-are-p0.md
- Scope/count/quantity claim: feedback-falsify-not-confirm.md
- Durable docs/memory/fact edit: feedback-reconcile-dont-append-docs.md; feedback-apply-reconcile-to-fix-work.md
- Cleanup/audit/verification loop: feedback-timebox-metawork.md
- External platform capability claim: feedback-verify-external-platform-claims.md; feedback-cite-ground-truth.md
- External literal in code (email/URL/ID/contact): feedback-no-fabricated-placeholder-values.md
- Relay Codex/reviewer output: feedback-share-codex-verbatim.md; feedback-surface-full-review-findings.md
- rtk reference: project-rtk-grep-output-corruption.md

## Working Norms
- Thoroughness / completion posture: feedback-thoroughness-default.md; feedback-drive-to-completion.md; feedback-truncation-is-breakage-not-completion.md
- Bug found in review: feedback-real-fix-not-design-note.md
- No performative contrition: feedback-no-performative-contrition.md
- React async/effect edits: feedback-profile-context-runtime-bugs.md
- Prior-context lookup: feedback-check-memory-before-asking-user.md
- Startup / next-step summary (omit parked items): feedback-dont-resurface-parked-items.md
- Codex app/delegation loop: project-codex-design-pre-impl-iteration.md; project-codex-recurring-review.md; feedback-commit-before-delegating-to-worktree-agent.md
- Grep/search posture: feedback-grep-general-codebase-terms.md
- Schema and stakeholder tone: feedback-human-legibility-schema-principle.md; feedback-stakeholder-email-tone.md; feedback-review-panel-tone.md

## Task Routing
- Reviewer origination / retrieval: ../docs/agent-wiki/topics/reviewer-origination.md
- Reviewer identity / ORCID / contact / COI / PI identity: ../docs/agent-wiki/topics/reviewer-identity.md; project-reviewer-verify-fail-dangerous.md
- Reviewer workbench / lifecycle / roster / referral: ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
- External reviewer portal / accept-decline / E2E / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md
- Intake portal / attachments / institution match / virus scan: ../docs/agent-wiki/topics/intake-portal.md
- Dataverse / Dynamics / Explorer / Power Tools: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Dynamics CRM facts / grant lifecycle fields: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Auth / admin / access / security: ../docs/agent-wiki/topics/security-auth.md
- Private Blob / file download patterns: ../docs/agent-wiki/topics/security-auth.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Dev environment / secrets / Vercel deploy / local build: ../docs/agent-wiki/topics/dev-environment.md
- Strategy / system model / roadmap / phasing: ../docs/agent-wiki/topics/strategy-roadmap.md
- Virtual Review Panel: ../docs/agent-wiki/topics/strategy-roadmap.md
- Deferred cleanup / dead-code session: project-deferred-code-cleanup.md

## User Context
- Power Automate familiarity: user-powerautomate.md

## Archive
- Closed & shipped work index: project-closed-work-archive.md
