# Project Memory Router

> Routing table, not the memory itself. Each line answers: "for THIS task, which 1–3 files do I read before acting?" Read the routed files **in full** before acting. Structural live-state (schemas, source-of-truth, read/write paths, drop status) lives in the **Atlas**, not here — memory is intent, lessons, and hazards. If memory conflicts with code / Atlas / a live probe, the probe wins → mark the memory `status: stale`.

## Startup
- Current handoff: ../SESSION_PROMPT.md
- Live-state index (read before data-layer work): ../docs/APPLICATION_STATE_ATLAS.md
- Ground-truth / self-correction rules: ../docs/CLAUDE_REMEDIATION_PLAN.md
- Memory storage invariant (symlink/slug): memory-store-propagation.md
- This router's contract + reorg history: ../docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md

## Always-Read Guardrails (damage / wasted-work preventers)
- Destructive carryover or bulk delete: feedback-verify-before-destructive-carryover.md; feedback-list-and-confirm-before-bulk-deletes.md
- Red CI gate at session start: feedback-red-gates-are-p0.md
- Any scope/count/quantity claim: feedback-falsify-not-confirm.md
- Editing a fact in docs/memory (READ THE WHOLE FILE, not the grepped line; PreToolUse hook enforces): feedback-reconcile-dont-append-docs.md; feedback-apply-reconcile-to-fix-work.md
- Cleanup/audit/verify loop ballooning (time-box ~30min/2 commits, check in): feedback-timebox-metawork.md
- Stating Dataverse/PA/Azure/Vercel behavior: feedback-verify-external-platform-claims.md; feedback-cite-ground-truth.md
- External identifier literal (email/URL/ID/contact) in code, esp. Codex-generated — verify it's REAL, not a fabricated placeholder; prefer env config: feedback-no-fabricated-placeholder-values.md
- Relaying Codex/reviewer output: feedback-share-codex-verbatim.md; feedback-surface-full-review-findings.md
- rtk UNINSTALLED (S220) — don't call rtk; the global rtk instructions are stale: project-rtk-grep-output-corruption.md

## Working Norms (cross-cutting; apply most sessions)
- Effort posture (no skimming, no "keep going?" menus): feedback-thoroughness-default.md; feedback-drive-to-completion.md
- Bug found in review → fix it, don't design-note it: feedback-real-fix-not-design-note.md
- No performative contrition: feedback-no-performative-contrition.md
- React/async/effect edits (CI won't catch, smoke it): feedback-profile-context-runtime-bugs.md
- "Has X happened?" is a lookup, not a question: feedback-check-memory-before-asking-user.md
- Codex iteration loop (design→pre-impl→impl→post-impl): project-codex-design-pre-impl-iteration.md; project-codex-recurring-review.md
- Delegating to Codex/app (runs in ISOLATED git worktree) → commit/patch first; uncommitted edits don't travel: feedback-commit-before-delegating-to-worktree-agent.md
- Grep general terms, not domain jargon: feedback-grep-general-codebase-terms.md
- Schema design: expand enums over new child tables: feedback-human-legibility-schema-principle.md
- Stakeholder/email tone: feedback-stakeholder-email-tone.md; feedback-review-panel-tone.md

## Task Routing
- Reviewer-finder EOD-S222 topics (#1 timeout + #2 recency/affiliation SHIPPED; #3 Perplexity web-discovery shipped S225–S227 then EVALUATED → ABANDONED S230): project-reviewer-finder-next-topics.md
- Reviewer web-discovery / Perplexity reviewer-agent EVALUATED → ABANDONED S230 (verified hallucination of reviewers + affiliations; don't re-attempt ungrounded): project-reviewer-web-discovery-abandoned.md
- Reviewer-finder RETRIEVAL REDESIGN direction (S231 — demote Claude generator → field-routed retrieval/fan-out; provenance model; OpenAlex+ORCID spine; reuse existing resolver+ranker; NOT BUILT): project-reviewer-finder-retrieval-redesign.md
- Reviewer-finder PROPOSAL-DOC context (Phase I = thin signal, no bibliography → under-delivers; NEXT cycle combines I+II w/ bibliography — build a Power Automate flow to assemble ONE clean reviewer doc; + classifyFile demotes Phase-I bug): project-reviewer-finder-proposal-doc-context.md
- Reviewer VERIFY fail-dangerous HAZARD (S231 — fabricated wrong-forename verified against real same-initial namesake; LARGELY CLOSED S235-S236: forename gates now on BOTH PubMed + spine verify paths; principle still a forward guard): project-reviewer-verify-fail-dangerous.md
- Reviewer FIELD-AWARE verification (SHIPPED S236 — non-biomedical proposals verify Track-A via OpenAlex/ORCID spine not PubMed; pubMedVerificationContract stays field-UNAWARE to not break coauthor-COI gate; spine-verified must match PubMed candidate shape): project-reviewer-field-aware-verification.md
- Reviewer CONTACT-enrichment namesake fix (S234 — identity resolution works; CONTACT/bibliometric enrichment was the locus; anchor-to-resolved-identity-or-abstain; identity-confirmed ≠ contact-validated; Fixes A–D merged S234; Fix E deferred-candidate gate + roster-marker persistence + server 422 shipped S235): project-reviewer-contact-enrichment-anchoring.md
- Reviewer enrichment fan-out / SerpAPI budget (~15k/mo, cost not the limiter; LATENCY is — don't add per-candidate round-trips): project-serpapi-budget-latency.md
- Reviewer Workbench / lifecycle: project-reviewer-apps-redesign-direction.md; project-reviewer-workbench-invite-workflow.md; project-reviewer-lifecycle.md
- Find-tab durable roster + cross-run search dedup (SHIPPED S224; operational PG table, don't drop-carryover) + clearing/resetting a request's reviewers (use `scripts/reset-request-reviewers.mjs`, don't hand-roll): project-reviewer-find-roster.md
- Reviewer identity resolver / ORCID: project-reviewer-identity-resolution.md; project-reviewer-identity-resolution-phase1.md; project-reviewer-self-report-orcid-sticky-confirmed.md
- Reviewer identity fragmentation (why the resolver exists): reviewer-identity-fragmentation.md
- Reviewer lifecycle automation (cron/reminders) + address: project-reviewer-lifecycle-automation.md; project-reviewer-address-collection-provisional.md
- Reviewer data model / migration: project-reviewer-postgres-to-dataverse-migration.md; project-reviewer-finder-dataverse-entry-path.md; project-appresearcher-collapse-post-pilot.md
- Reviewer matching / institution / contacts: project-reviewer-institution-match.md; project-contact-promotion-permission.md; project-institution-foundation-liaison.md
- Reviewer COI concern surfacing + former-institution COI + from-scratch test reset (S229): project-reviewer-coi-concern-surfacing.md
- Reviewer RANKING (recency must outweigh citations/h-index): project-reviewer-ranking-recency-over-citations.md
- Reviewer invariants (counts, history, excluded): project-reviewer-count-invariant.md; project-reviewer-history-data-quality.md; project-excluded-reviewers-often-in-pool.md
- External reviewer flow / accept-decline / files: project-external-reviewer-file-access.md; project-reviewer-accept-decline-links.md; project-sharepoint-integration.md
- Intake portal (scope + capture): project-intake-portal-skinny-scope.md; project-intake-portal-reviewer-capture.md; project-machine-legible-form-capture.md
- Intake portal (auth + institution match): project-intake-portal-external-id-foundation.md; project-intake-portal-institution-match.md; project-dataverse-creator-privileges.md
- Intake portal (pilot decisions + slice-0 + UI todos): project-intake-portal-pilot-decisions-2026-05-13.md; slice0-deactivate-not-delete-recalc.md; project-intake-portal-ui-todo.md
- Intake virus-scan e2e (MUST before next cycle): project-intake-portal-virus-scan-e2e-deferred.md; project-virus-scanning-it-context.md; project-cloudmersive-advanced-endpoint.md
- Dataverse schema / probes / OData: project-dataverse-schema-deploy-gotchas.md; project-dataverse-odata-null-filter.md; project-living-taxonomy-principle.md
- Dynamics CRM facts (fields, lifecycle, temporal): project-akoya-request-pd-fields.md; project-grant-lifecycle-states-confirmed.md; akoya-temporal-axis-encodings.md
- Dynamics CRM (users + email): project-dynamics-crm-users.md; project-dynamics-email.md
- Dynamics CRM (OData limits + AI fields): project-dynamics-crm-limitations.md; project-dynamics-ai-writeback.md
- Dynamics identity reconciliation / impersonation: project-dynamics-identity-reconciliation.md
- Dynamics Explorer (core + schema): project-dynamics-explorer-details.md; project-dynamics-explorer-schema-diff.md
- Dynamics Explorer (reuse direction + feedback-admin anti-rebuild): project-dynamics-explorer-reuse-power-tools.md; project-dynamics-feedback-admin-shipped.md
- Dataverse Power Tools (find&fix + bulk export): project-dataverse-power-tools.md; dataverse-export-floor-scoping.md
- Prompt / Executor work: project-prompt-storage-strategy.md; project-dynamics-as-prompt-ground-truth.md; project-pdf-processing-tiers.md
- Reviewer-finder prompt → Dataverse migration (admin + per-user editing, SHIPPED S222): project-reviewer-prompt-dataverse-migration.md
- BILL / honoraria: project-bill-honorarium-integration.md; akoya-request-honorarium-nomenclature.md; akoya-payment-field-semantics.md
- No banking/PII in Dataverse (firm constraint): project-no-banking-pii-in-dataverse.md
- App access / auth / admin: project-app-access-control.md; project-admin-dashboard.md; project-api-credit-monitoring.md
- Security (A7 prompt-injection hardening): project-a7-prompt-injection-hardening.md
- Virtual Review Panel: project-virtual-review-panel.md
- Dev environment / secrets: project-dev-environment.md; project-vercel-sensitive-env-pull-empty.md
- Local build + git gotchas: local-jest-build-environment.md; env-broken-git-autogc.md
- Dynamics sandbox (NOT drop-in usable): project-dynamics-sandbox-state.md
- Strategy / system model: project-system-model.md; project-strategy-direction.md
- Root instruction file / hooks / rules / instruction-adherence (Codex writing enforcement harnesses next): project-claude-instruction-architecture.md
- Roadmap (historical snapshots — cross-check current strategy): project-app-roadmap-2026-04-25.md; project-phase-i-summary-app-winddown.md
- Phasing / cycle scoping: project-grant-phasing-evolution.md; feedback-cycle-vs-executor-scope.md; feedback-concepts-vs-phase-i.md
- Planned: review pipeline + proposal extracts: project-staged-review-pipeline.md; project-proposal-context-extraction.md
- Planned: backend automation + interim reports: project-backend-automation.md; project-interim-report-automation.md
- Planned: post-award + new AI capabilities: project-awardee-onboarding.md; project-new-ai-capabilities.md
- IRS verify-EIN (code+data shipped, cron unfired, no consumer yet): project-irs-exempt-verification.md
- Decision log: decision-module-typeless-warning-accept.md
- Deferred code cleanup backlog (read at START of any cleanup/dead-code session; inert-but-not-yet-deleted code + safe-retirement preconditions; append here instead of deleting inline): project-deferred-code-cleanup.md

## User Context
- Power Automate familiarity (Justin none / Connor moderate): user-powerautomate.md

## Archive (closed/shipped — read only if the subject resurfaces)
- Closed & shipped work index: project-closed-work-archive.md
- (covers: Wave-1 migration, slice-0 status snapshots, superseded intake decisions, shipped Explorer features, D26 probe, identity-reconciliation history)
