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
- Additive carryover ("build/migrate/add X" next-step or TODO) — verify it's not already done/blocked before surfacing or acting: feedback-verify-additive-carryover-not-just-destructive.md
- Red CI gate or failing startup gate: feedback-red-gates-are-p0.md
- Full `npm test` shows red (confirm it's ONLY the known bill.com expected-red set before chasing): project-bill-com-integration-tests-known-red.md
- Scope/count/quantity claim: feedback-falsify-not-confirm.md
- Claim about how THIS system behaves (screen/return/feature-live/field/gate/token/link), incl. in chat — cite producer, not consumer: feedback-behavior-claims-cite-the-producer.md
- Durable docs/memory/fact edit: feedback-reconcile-dont-append-docs.md; feedback-apply-reconcile-to-fix-work.md
- Retiring/consolidating a renamed-or-merged capability, or a `/sweep` keeps re-finding the same stale claim (rename the CODE/ground truth, not just docs): feedback-rename-code-not-just-docs.md
- Cleanup/audit/verification loop: feedback-timebox-metawork.md
- External platform capability claim: feedback-verify-external-platform-claims.md; feedback-cite-ground-truth.md
- External literal in code (email/URL/ID/contact): feedback-no-fabricated-placeholder-values.md
- Relay Codex/reviewer output: feedback-share-codex-verbatim.md; feedback-surface-full-review-findings.md
- New/changed enum value, column, or status (plan or code): feedback-symbol-consumer-fanout.md
- "idempotent"/"no re-stamp"/"reuse existing guard"/"backward compatible" claim: feedback-idempotency-name-the-mechanism.md
- Adding a branch/type/gate, or EXEMPTING a path from a gate (check the complement/fall-through): feedback-scrutinize-exemptions-and-fallthrough.md
- Building a safeguard, or an advisory hook fired but the mistake still happened — gate the artifact against source in CI fail-closed, not promises: feedback-enforcement-hierarchy.md
- rtk reference: project-rtk-grep-output-corruption.md
- Checking a Vercel deploy after push (use `vercel inspect`, don't poll-grep `vercel ls` for the hash): feedback-deployment-monitoring-use-inspect.md
- Verifying a Vercel env var VALUE via pull (Sensitive vars read back EMPTY — can't be verified; recreate non-sensitive): reference-vercel-sensitive-env-unreadable.md
- Branded domains / portal base URLs / wmkeck.org vs vercel.app / *_PORTAL_BASE_URL / NEXTAUTH_URL (staff auth cut over to applications.wmkeck.org 2026-06-23; verify via /api/health, NOT env pull): project-branded-domains.md
- jsdom / DOMPurify / markdown sanitization on a server route (jsdom won't load in Vercel/Turbopack serverless — ESM-require; split client/server + DOM-free sanitizer; grantee/app-markdown still latent): project-jsdom-serverless-esm-incompat.md

## Working Norms
- Before ANY commit / checkout / branch-assuming action (shared working dir drifts when the concurrent Codex-app session checks out branches; Justin chose self-policing over worktrees): feedback-verify-branch-before-git-action.md
- Git commit/push: go straight to `main` (no branch-first/PR flow; harness "branch off default" default does NOT apply here): project-commit-directly-to-main.md
- Reviewer-finder utility vs precision (before another identity/namesake/affiliation fix): feedback-prioritize-contact-recall-over-identity-precision.md
- Manual affiliation edit on reviewer card → do NOT add COI re-check (owner decision): feedback-manual-affiliation-edit-no-coi-recheck.md
- Thoroughness / completion posture: feedback-thoroughness-default.md; feedback-drive-to-completion.md; feedback-truncation-is-breakage-not-completion.md
- Cost tradeoff (prevention vs. fix-later; overhead on start/stop/commit is wanted if it prevents errors): feedback-first-time-correctness-over-rework.md
- Bug found in review: feedback-real-fix-not-design-note.md
- Before declaring done / committing / delegating a review (verify+fan-out+trust-boundary+concurrency + lifecycle + provenance self-pass; don't deflect a behavioral fix into project code): feedback-self-review-before-delegating-review.md
- Declaring tests "green" / safe to commit (run FULL npm test, not a subset/gates): feedback-green-requires-full-test-suite.md
- No performative contrition: feedback-no-performative-contrition.md
- No time-pressure commentary (don't tell the user they're out of time): feedback-no-time-pressure-commentary.md
- React async/effect edits: feedback-profile-context-runtime-bugs.md
- Prior-context lookup: feedback-check-memory-before-asking-user.md
- Startup / next-step summary (omit parked items): feedback-dont-resurface-parked-items.md
- Codex app/delegation loop: project-codex-design-pre-impl-iteration.md; project-codex-recurring-review.md; feedback-commit-before-delegating-to-worktree-agent.md
- Delegating a BUILD to codex:codex-rescue (don't lead with "plan only" then resume to implement — read-only sandbox is fixed at launch; spawn a FRESH build-framed agent): reference-codex-rescue-plan-task-runs-readonly.md
- codex:codex-rescue self-report ("killed it"/"done") or unexpected pkill/Bash from the rescue wrapper — verify process state directly, don't trust it: reference-codex-rescue-pkill-overstep.md
- High-stakes / colleague-facing / prod-deploying change — offer Codex plan/review BEFORE solo-implementing, don't rush then review at the end: feedback-pause-for-codex-on-high-stakes.md
- Delegating a Codex task whose acceptance includes `npm run build` (Next 16/Turbopack sandbox panic = env failure, not app failure; escalate, don't delete .next): feedback-codex-build-gate-turbopack-sandbox.md
- Grep/search posture: feedback-grep-general-codebase-terms.md
- Schema and stakeholder tone: feedback-human-legibility-schema-principle.md; feedback-stakeholder-email-tone.md; feedback-review-panel-tone.md

## Task Routing
- Reviewer origination / retrieval: ../docs/agent-wiki/topics/reviewer-origination.md
- Reviewer identity / ORCID / contact / COI / PI identity: ../docs/agent-wiki/topics/reviewer-identity.md; project-reviewer-verify-fail-dangerous.md
- Reviewer workbench / lifecycle / roster / referral: ../docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
- Workbench consolidation / non-techsavvy PD rollout / remove dead-end (now-automated) UI / reviewer-finder+review-manager sunset: project-workbench-consolidation-rollout.md
- Nomenclature sweep / legacy app sunset / stale memory+wiki cleanup (DEFERRED TODO — overloaded "candidate"/"Candidates" vs "Invite Reviewers", 3 API namespaces for 1 app): project-nomenclature-and-app-sunset-sweep.md
- Reviewer duplicate merge / email alt-key (wmkf_emailaddress_unique) 412 dead-end / the THREE distinct duplicate problems (PR↔PR vs PR↔contact vs contact↔contact): project-reviewer-duplicate-merge.md
- External reviewer portal / accept-decline / E2E / SharePoint: ../docs/agent-wiki/topics/external-reviewer-portal.md
- Reviewer invite→accept collapse (S279: onboard up front at one final Accept; no hold/finalize step; capture-only honorarium; .ics on accept): project-reviewer-hold-step-decouple.md
- Reviewer review-form in-browser authoring rework — Phases 0–5 DONE (S302): tiptap authoring, /submit atomic snapshot changeset, workbench read-back, draft lifecycle: ../docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md
- Reviewer file-upload path is hidden-not-deleted (Phase 2 cutover; route retained + finality-guarded; how to re-enable): project-reviewer-upload-dormant-not-deleted.md
- Intake portal / attachments / institution match / virus scan: ../docs/agent-wiki/topics/intake-portal.md
- Dataverse / Dynamics / Explorer / Power Tools: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Dynamics CRM facts / grant lifecycle fields: ../docs/agent-wiki/topics/dataverse-dynamics.md
- Is a Dataverse field human- or flow-populated? (audit-trail actor detection): reference-dataverse-audit-trail-actor-detection.md
- Atomic multi-row Dataverse write / `$batch` changeset availability (WORKS in prod, refutes the prompts/[name].js "no $batch" belief; helper = `DynamicsService.executeChangeset`): project-dataverse-batch-changeset-available.md
- Dataverse alt-key upsert URL whose key includes a LOOKUP (address by `_<lookup>_value=<guid>`, NOT bare logical name/nav property — else 400 0x80060888; verified S302): reference-dataverse-altkey-lookup-upsert-url.md
- Dataverse settings auditing / recovering an accidentally-blanked admin email default (or any wmkf_appsystemsetting value) — PARKED, needs Connor on scope + retention: project-dataverse-settings-audit-enablement.md
- Prompt / Executor / document processing: ../docs/agent-wiki/topics/prompt-executor.md
- Adding a prompt / editing a seed / prompt-store governance (two-tier, create-only seed, version-preserving --force, timestamps): project-prompt-governance.md
- BILL / honoraria / payment semantics: ../docs/agent-wiki/topics/finance-honoraria.md
- Reviewer honorarium onboarding→payment current-state / Ops "mimic Rosie's grant flow" / why no individual gets paid (0/9,151): project-honorarium-payment-landscape.md
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
