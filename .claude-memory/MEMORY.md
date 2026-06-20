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
- New/changed enum value, column, or status (plan or code): feedback-symbol-consumer-fanout.md
- "idempotent"/"no re-stamp"/"reuse existing guard"/"backward compatible" claim: feedback-idempotency-name-the-mechanism.md
- Adding a branch/type/gate, or EXEMPTING a path from a gate (check the complement/fall-through): feedback-scrutinize-exemptions-and-fallthrough.md
- rtk reference: project-rtk-grep-output-corruption.md
- Checking a Vercel deploy after push (use `vercel inspect`, don't poll-grep `vercel ls` for the hash): feedback-deployment-monitoring-use-inspect.md

## Working Norms
- Reviewer-finder utility vs precision (before another identity/namesake/affiliation fix): feedback-prioritize-contact-recall-over-identity-precision.md
- Manual affiliation edit on reviewer card → do NOT add COI re-check (owner decision): feedback-manual-affiliation-edit-no-coi-recheck.md
- Thoroughness / completion posture: feedback-thoroughness-default.md; feedback-drive-to-completion.md; feedback-truncation-is-breakage-not-completion.md
- Bug found in review: feedback-real-fix-not-design-note.md
- Before declaring a slice done / committing code / delegating a review (verify+fan-out+boundary+concurrency self-pass): feedback-self-review-before-delegating-review.md
- Declaring tests "green" / safe to commit (run FULL npm test, not a subset/gates): feedback-green-requires-full-test-suite.md
- No performative contrition: feedback-no-performative-contrition.md
- No time-pressure commentary (don't tell the user they're out of time): feedback-no-time-pressure-commentary.md
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
- Reviewer hold/soft-confirm step (this cycle's decouple plan): project-reviewer-hold-step-decouple.md
- Intake portal / attachments / institution match / virus scan: ../docs/agent-wiki/topics/intake-portal.md
- Dataverse / Dynamics / Explorer / Power Tools: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Dynamics CRM facts / grant lifecycle fields: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Is a Dataverse field human- or flow-populated? (audit-trail actor detection): reference-dataverse-audit-trail-actor-detection.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md
- Adding a prompt / editing a seed / prompt-store governance (two-tier, create-only seed, version-preserving --force, timestamps): project-prompt-governance.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Auth / admin / access / security: ../docs/agent-wiki/topics/security-auth.md
- Private Blob / file download patterns: ../docs/agent-wiki/topics/security-auth.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Dev environment / secrets / Vercel deploy / local build: ../docs/agent-wiki/topics/dev-environment.md
- Strategy / system model / roadmap / phasing: ../docs/agent-wiki/topics/strategy-roadmap.md
- Proposal-tab docs / request document capture / J27 doc-storage evolution: project-j27-doc-capture-evolution.md; project-grant-phasing-evolution.md
- Phase I→II decision flip / wmkf_phaseistatus lifecycle / when to generate edited titles vs abstracts: project-phaseistatus-decision-lifecycle.md
- Grantee deliverable email copy (invite/reminder voice, PD-signed, deadline+implied-concurrence, waiver wording): project-grantee-deliverable-email-voice.md
- Virtual Review Panel: ../docs/agent-wiki/topics/strategy-roadmap.md
- Deferred cleanup / dead-code session: project-deferred-code-cleanup.md

## User Context
- Power Automate familiarity: user-powerautomate.md

## Archive
- Closed & shipped work index: project-closed-work-archive.md
