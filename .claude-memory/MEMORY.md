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
- Carryover / bulk actions: feedback-verify-before-destructive-carryover.md; feedback-list-and-confirm-before-bulk-deletes.md; feedback-verify-additive-carryover-not-just-destructive.md
- Red gates / test claims: feedback-red-gates-are-p0.md; feedback-green-requires-full-test-suite.md; project-bill-com-integration-tests-known-red.md; feedback-new-gate-fixtures-trip-scanner-gates.md
- Scope or behavior claims: feedback-falsify-not-confirm.md; feedback-behavior-claims-cite-the-producer.md; feedback-verify-write-paths-against-live-service.md; feedback-plan-contracts-read-the-extremes.md
- Durable docs/memory fixes: feedback-reconcile-dont-append-docs.md; feedback-apply-reconcile-to-fix-work.md; feedback-rename-code-not-just-docs.md; feedback-timebox-metawork.md
- External/platform/literal claims: feedback-verify-external-platform-claims.md; feedback-cite-ground-truth.md; feedback-no-fabricated-placeholder-values.md
- Review relay / fanout / guards: feedback-share-codex-verbatim.md; feedback-surface-full-review-findings.md; feedback-symbol-consumer-fanout.md; feedback-idempotency-name-the-mechanism.md; feedback-scrutinize-exemptions-and-fallthrough.md; feedback-enforcement-hierarchy.md
- Vercel/deploy/env/domain checks: feedback-deployment-monitoring-use-inspect.md; reference-vercel-sensitive-env-unreadable.md; project-branded-domains.md; project-jsdom-serverless-esm-incompat.md
- Local `npm run dev` auth setup (wrong-user/no-signout symptom, invite-link minting): project-local-dev-auth-setup.md; project-vercel-cli-deploy-preview-auth.md

## Working Norms
- Git/branch/main: feedback-verify-branch-before-git-action.md; project-commit-directly-to-main.md
- Reviewer preferences: feedback-prioritize-contact-recall-over-identity-precision.md; feedback-manual-affiliation-edit-no-coi-recheck.md
- Completion posture: feedback-thoroughness-default.md; feedback-drive-to-completion.md; feedback-truncation-is-breakage-not-completion.md; feedback-first-time-correctness-over-rework.md; feedback-real-fix-not-design-note.md; feedback-self-review-before-delegating-review.md; feedback-dont-self-certify-convergence.md; feedback-escalate-aggregate-scope-not-step-size.md
- Refactor / behavior-freeze extraction: feedback-behavior-freeze-passthrough-no-default.md; ../docs/DISCOVERY_SERVICE_DECOMPOSITION_PLAN.md (facade+modules decomposition playbook)
- Tone / user context: feedback-no-performative-contrition.md; feedback-no-time-pressure-commentary.md; feedback-stakeholder-email-tone.md; feedback-review-panel-tone.md
- React / memory lookup / handoff summary: feedback-profile-context-runtime-bugs.md; feedback-check-memory-before-asking-user.md; feedback-dont-resurface-parked-items.md
- Codex delegation: reference-codex-detached-exec-protocol.md; project-codex-design-pre-impl-iteration.md; project-codex-recurring-review.md; feedback-commit-before-delegating-to-worktree-agent.md; reference-codex-rescue-plan-task-runs-readonly.md; reference-codex-plugin-job-tracking-bugs.md; reference-codex-rescue-pkill-overstep.md; feedback-pause-for-codex-on-high-stakes.md; feedback-codex-build-gate-turbopack-sandbox.md; feedback-dont-tune-against-hook-source.md
- Search / schema language: feedback-grep-general-codebase-terms.md; feedback-human-legibility-schema-principle.md

## Task Routing
- Reviewer origination / retrieval: ../docs/agent-wiki/topics/reviewer-origination.md; project-reviewer-sourcing-constraints.md (owner: ~1 applicant rec/panel recent policy; reuse per-PD practice; referral multiplies the engine)
- Reviewer finding/identity holistic redesign (Fable 2026-07-08 plan; owner S349 wants a dedicated branch build-out + head-to-head vs main, NOT incremental-to-main; PARKED pending go): project-reviewer-holistic-redesign-parallel-build.md; ../docs/REVIEWER_HOLISTIC_REVIEW_IMPLEMENTATION_PLAN.md
- Reviewer identity / ORCID / contact / COI / PI identity: ../docs/agent-wiki/topics/reviewer-identity.md; project-reviewer-verify-fail-dangerous.md
- Reviewer workbench / lifecycle / roster / referral: ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md; project-workbench-consolidation-rollout.md
- Reviewer-invite local testing / capture mode side effects: reviewer-invite-capture-mode-not-full-sandbox.md
- Reviewer nomenclature / duplicate merge: project-nomenclature-and-app-sunset-sweep.md; project-reviewer-duplicate-merge.md
- External reviewer portal / accept / forms / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md; project-reviewer-hold-step-decouple.md; ../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md; ../docs/STAFF_EDITABLE_REVIEW_QUESTIONS_BUILD_PLAN.md; project-reviewer-upload-dormant-not-deleted.md
- Campaign settings / reminder-config UX revisit (owner ask, S326): project-campaign-settings-ux-revisit.md
- Review rendition formatting pass — courtesy copy + staff DOCX/PDF (owner ask, S328): project-review-output-formatting.md
- Reviewer limbo / "back to square one": closeout payability flag (owner ask, S343) + potential/invited reset button: project-reviewer-closeout-payability.md
- Staff "manually enter a review" rescue tool (owner ask, S347; off Track Reviewers panel, full structured form): project-staff-review-rescue-tool.md; project-reviewer-upload-dormant-not-deleted.md
- Intake portal / attachments / institution match / virus scan (BUILD PARKED S348 — Connor re-engineering GOApply): project-intake-portal-parked.md; ../docs/agent-wiki/topics/intake-portal.md
- Dataverse / Dynamics / Explorer / Power Tools / CRM facts / grant lifecycle fields: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Dataverse write/audit/settings specifics: reference-dataverse-audit-trail-actor-detection.md; project-dataverse-batch-changeset-available.md; reference-dataverse-altkey-lookup-upsert-url.md; project-dataverse-settings-audit-enablement.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md; project-prompt-governance.md
- Peer-review summarizer wired to Executor (SHIPPED S344; A7 assertSystemIncludes pattern): project-peer-review-executor-migration.md; ../docs/PEER_REVIEW_EXECUTOR_MIGRATION_PLAN.md
- Prompt legacy audit (RESOLVED S344 — apps sunset, peer-review wired, dead gens removed): project-prompt-legacy-audit-followup.md; ../docs/PROMPT_LEGACY_AUDIT.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md; project-honorarium-payment-landscape.md
- Auth / admin / access / security / private Blob / file download: ../docs/agent-wiki/topics/security-auth.md
- Integrity screener / Retraction Watch / PubPeer / News: ../docs/agent-wiki/topics/integrity-screener.md
- Dev environment / secrets / Vercel deploy / local build: ../docs/agent-wiki/topics/dev-environment.md
- Strategy / system model / roadmap / phasing / Virtual Review Panel: ../docs/agent-wiki/topics/strategy-roadmap.md
- Proposal docs / phasing / Phase I-II: project-j27-doc-capture-evolution.md; project-grant-phasing-evolution.md; project-phaseistatus-decision-lifecycle.md
- Grantee and email templates: project-grantee-deliverable-email-voice.md; project-email-template-token-syntax.md
- Deferred cleanup / dead-code session: project-deferred-code-cleanup.md
- Whack-a-mole / accumulated patch-debt / redesign candidates (S349 audit; ranked areas + tiered remediation to-do): ../docs/audits/whack-a-mole-audit-2026-07-08.md; meta-review to dispatch: ../docs/WHACK_A_MOLE_META_REVIEW_FABLE_PROMPT.md
- Parked: project-wide prompt-caching audit (Anthropic flagged low cache-hit rate, S339): project-cache-hit-rate-review.md
- Parked: spec-audit design-docs recovery (work computer, ~2026-07-08): project-spec-audit-docs-recovery-parked.md
- Private-repo CI (why CodeQL gone, Semgrep split, Pro needed for branch protection): project-private-repo-ci-visibility.md
- E2E reviewer suite re-baseline (RESOLVED 2026-07-04, 23/23 green; client-UX drift lesson): project-e2e-reviewer-rebaseline-parked.md

## Archive
- Closed & shipped work index: project-closed-work-archive.md
