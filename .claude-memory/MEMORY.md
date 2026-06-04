# Project Memory

## Operational
- [rtk grep output corruption](project-rtk-grep-output-corruption.md) — rtk's grep filter fabricates tool output (placeholder/dup/backwards lines), masking failed Edits. Disabled; verify suspicious grep/cat with git diff / Read.
- [Verify before destructive actions](feedback-verify-before-destructive-carryover.md) — grep-verify drop/remove/retire/archive carryover before acting (lists go stale, nearly broke Reviewer Finder 2026-05-03); a narrow cleanup directive ≠ license to delete adjacent files ([[feedback-list-and-confirm-before-bulk-deletes]]; S193 deleted 4 for 1).
- [Check memory before asking the user](feedback-check-memory-before-asking-user.md) — "has X happened" is a lookup: scan MEMORY.md + recent commits first; rewrite stale doc framing without asking.
- [Red CI gates are P0 blockers, not side-notes](feedback-red-gates-are-p0.md) — run the CI gates at session start; a red gate = rubric violated now, fix before any data-layer commit.
- [Relay Codex/reviewer output faithfully](feedback-share-codex-verbatim.md) — paste stdout as the ENTIRE response, no pre/post commentary; surface ALL findings in their own labels, my recommendations come after not instead ([[feedback-surface-full-review-findings]]); raise decisions in a separate turn.
- [Reconcile docs, don't append-patch](feedback-reconcile-dont-append-docs.md) — fix a fact everywhere (top-X/tail-not-X is P0); fix-work is original work, verify-as-you-go ([[feedback-apply-reconcile-to-fix-work]]; S196 each Codex round caught fresh bugs). No "DONE" until `check:fact-consistency` + grep + Codex green.
- [Memory store + propagation](memory-store-propagation.md) — ONE canonical store: git-tracked `.claude-memory/`; harness store symlinked in, keyed to the path-slug → recreate per machine / after repo move. Never put `.git` in cloud sync.
- [Thoroughness + completion are the default](feedback-thoroughness-default.md) — skimming costs the user Codex tokens + review; surface incompleteness explicitly, no banner-only shortcuts. Keep building part after part, don't end turns with "keep going?" menus — stop only for genuine forks ([[feedback-drive-to-completion]]).
- [Real fix, not a design-note](feedback-real-fix-not-design-note.md) — when review surfaces a correctness bug, default is "fix it + here's the cost," not "acceptable for pilot" (S184 TOCTOU).
- [Source every external-fact claim](feedback-verify-external-platform-claims.md) — WebFetch the authoritative doc before stating Dataverse/PA/Azure/Vercel behavior (memory lossy on defaults/edge cases); cite URL/file:line/Codex round, retain Codex citations ([[feedback-cite-ground-truth]]; S188 Neon burn).
- [Falsify, don't confirm](feedback-falsify-not-confirm.md) — for any scope/quantity claim run the DISCONFIRMING query / derive M independent of N / hedge. Enforced by a PreToolUse hook.
- [No performative contrition when I make mistakes](feedback-no-performative-contrition.md) — lead with the fix, not why; one-sentence ack max, no receipts.
- [Dataverse schema-deploy gotchas](project-dataverse-schema-deploy-gotchas.md) — 429 throttling between metadata writes (30s-backoff retry); `@odata.bind` keys are PascalCase nav-props; queryAllRecords caps at 5000.
- [Dataverse OData null-filter trap](project-dataverse-odata-null-filter.md) — `field ne X` silently excludes null rows; use `(field eq null or field ne X)` for any nullable field. Bit S208.
- [Human-legibility schema principle](feedback-human-legibility-schema-principle.md) — expand enums on existing entities over new obscure child tables; staff browse Dataverse, fewer tables wins.
- [Grep general terms not domain jargon](feedback-grep-general-codebase-terms.md) — grep terms the prior implementer used (untrusted/sentinel/boundary), not article-jargon (S182 burn).
- [Stakeholder email tone](feedback-stakeholder-email-tone.md) — drop insider jargon in Connor/Sarah/DFT emails; frame in their domain, not the codebase's.
- [ProfileContext refactor runtime bugs (S203)](feedback-profile-context-runtime-bugs.md) — async/effect traps: useRef for stable callback identity (vs infinite loops); check `response.ok` before irreversible acts (fetch doesn't throw on 500/403). CI missed both → smoke.

## Security Infrastructure
- [A7 prompt-injection hardening — SHIPPED S173-S177](project-a7-prompt-injection-hardening.md) — all 24 LLM input surfaces CI-gated + hardened. Don't build a parallel system; read `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` first.
- [Virus scanning IT context (S190)](project-virus-scanning-it-context.md) — WMKF tenant has NO MDO; app-side Cloudmersive is PRIMARY defense for reviewer+intake uploads. No per-detection DFT emails; alerts route to the PD; sender UX preserves form text.
- [Cloudmersive /advanced endpoint (S193)](project-cloudmersive-advanced-endpoint.md) — scan uses /virus/scan/file/advanced not /basic (/basic can't see container contents); Contains* flags → foundViruses[0].virusName.

## Collaboration Notes
- [Concepts vs Phase I are different grant stages](feedback-concepts-vs-phase-i.md) — hard-exclude `/concept/i` files from Phase I prompt pipelines.
- [Cycle gating vs. Executor scope](feedback-cycle-vs-executor-scope.md) — "cycle" only gates Connor-collaboration work; Executor is backend-automation prompts; user-facing apps independent of both.
- [Codex as recurring code review surface](project-codex-recurring-review.md) — Justin runs Codex periodically; treat findings as input not a to-do list; mirror the 2026-04-30 response doc shape.
- [Codex design → pre-impl → impl → post-impl iteration](project-codex-design-pre-impl-iteration.md) — per-chunk design doc → Codex pre-impl (arch catches) → implement → Codex post-impl (impl-drift catches). S184 was the canonical run.

## Wave 1 Prod Migration (CLOSED 2026-05-12)
- [Wave 1 closeout + onboarding design](project-wave1-pending.md) — PG tables dropped, dispatcher → Dataverse. Live tail: prod app-user elevation-revert still deferred. Zero-touch first-login onboarding design (not built) [[project-wave1-onboarding]]. Full history → [[project-closed-work-archive]].

## Wave 2 Pending Tail Items
- [W6 Postgres table-drop pending (fire ≥ 2026-07-01)](project-w6-table-drop-pending.md) — drain-only reviewer tables (researchers/researcher_keywords/publications/proposal_searches) await one-shot DELETE+DROP. P0 if today ≥ 2026-07-01 and still present.

## Planned Capabilities
- [IRS tax-exempt verification](project-irs-exempt-verification.md) — bulk CSVs in Postgres, PA→Vercel lookup endpoint, verified result written back to Dynamics `account`.

## Strategic Direction
- [Whole-system conceptual model](project-system-model.md) — canonical model at `docs/SYSTEM_MODEL.md` (rote/thinking, two axes, app=prompt×adapter, two interaction modes, reviewer state machine = backbone). Read before cross-capability planning. Intake "Phase II pilot" DEFUNCT.
- [Strategy direction + key decisions](project-strategy-direction.md) — AkoyaGO minimize-not-replace, Dynamics as ground truth, backend triggers, Connor collaboration. Full doc `docs/STRATEGY.md`.
- [Backend Automation Vision](project-backend-automation.md) — PowerAutomate-triggered processing, configurable prompts, Dynamics write-back.
- [Interim grant report auto-evaluation](project-interim-report-automation.md) — backend job to evaluate yearly interim reports → Dynamics. Unblocked; field/prompt/process design still needed.
- [Awardee onboarding (post-award)](project-awardee-onboarding.md) — after fund decision + GAL flip, automate abstract approval + artwork + release form; reuses external reviewer-flow primitive. Extends Workbench past Status. Not built.
- [Staged Review Pipeline](project-staged-review-pipeline.md) — 3-stage automated triage (fit screen → intelligence brief → virtual panel) for the new cycle's higher volume.
- [Proposal Context Extraction](project-proposal-context-extraction.md) — pre-extract structured fields so downstream calls use ~1.5K-token extracts not full ~7K proposals. Plan `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`.
- [Phase I summary app winddown](project-phase-i-summary-app-winddown.md) — strategic deprioritization, NOT a freeze; `/phase-i-dynamics` still iterated as a prompt-tuning surface.
- [Dynamics as staff-prompt ground truth](project-dynamics-as-prompt-ground-truth.md) — `wmkf_ai_prompt` holds all staff-facing prompts; new prompts default there; migrate user-driven apps when touched.
- [App roadmap 2026-04-25](project-app-roadmap-2026-04-25.md) — Concept Evaluator deprecating; Grant Reporting + Integrity Screener growing PA triggers; Reviewer Finder top post-cycle priority.
- [Grant phasing evolution](project-grant-phasing-evolution.md) — reviewer-finding only at Phase II; concepts going away; next cycle one applicant package, internal Phase I/II labels persist.

## Intake Portal (GOapply replacement)
- [Reviewer capture → appreviewersuggestion + disposition flag](project-intake-portal-reviewer-capture.md) — intake writes applicant rec/excluded reviewers to `wmkf_appreviewersuggestion` via `wmkf_applicantdisposition`; per-request, NOT legacy slots.
- [External ID auth foundation SHIPPED (S129)](project-intake-portal-external-id-foundation.md) — tenant `04a1406b...`, NextAuth `entra-external` provider, `/apply` round-trip verified.
- [Intake portal UI TODOs (deferred to UI-design session)](project-intake-portal-ui-todo.md) — S187: (1) sign-out silently re-auths via Entra, (2) Entra sign-up collects irrelevant City/State/DisplayName. Held for a UI session.
- [Intake portal virus-scan e2e — DEFERRED](project-intake-portal-virus-scan-e2e-deferred.md) — reviewer path verified (S193); intake path skipped. MUST run EICAR e2e through /apply before the next cycle's Phase I intake goes live.
- [Skinny pilot scope, not feature-for-feature](project-intake-portal-skinny-scope.md) — intake sized like external reviewer intake (not a GOapply rewrite); for next cycle's Phase I. June-2026 Phase II pilot superseded ([[project-system-model]]). Doc `docs/INTAKE_PORTAL_DESIGN.md`.
- [Capture machine-legible structured data](project-machine-legible-form-capture.md) — split budgets/rosters/milestones into structured fields, not narrative; Sarah + Connor own form wishlists.
- [Match institution against existing accounts at intake](project-intake-portal-institution-match.md) — match-first, create-last against `accounts.{name,akoya_aka,wmkf_legalname,wmkf_abbreviation}`; free text pollutes the registry. GOverify doesn't dedup.
- [Pilot Track 1 decisions 2026-05-13](project-intake-portal-pilot-decisions-2026-05-13.md) — 4 Track-1 items closed (1A membership Option A, 1B PA flows origin-agnostic, 1C PA-built packet, 1D budget+roster). Supersedes the 2026-05-06 walkthrough [[project-intake-portal-pilot-decisions-2026-05-06]].
- [Slice-0 deactivate-not-delete recalc](slice0-deactivate-not-delete-recalc.md) — roster rollup uses `statecode` deactivation, never hard delete (Option A′ flow-body fallback). Schema DEPLOYED to prod S178; remaining = Connor's prod A′ flow + P4 re-verify + drain/portal code. (Slice-0 status snapshots → [[project-closed-work-archive]].)
- [Reviewer migration plan locked S136](project-reviewer-postgres-to-dataverse-migration.md) — 1:1 model; most Postgres tables drain not migrate; doc `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`.
- [Reviewer identity fragmentation](reviewer-identity-fragmentation.md) — S158 sample-based flag (5/87, not join-tested): a reviewer spans ≥4 disjoint stores with no shared key; forward constraint on Reviewer Manager → Dataverse, not a census.
- [No banking/PII in Dataverse](project-no-banking-pii-in-dataverse.md) — firm S158 constraint: remittance/banking PII stays at bill.com (SoR); Dataverse stores only onboarding-status + a join pointer.
- [Dataverse creator privileges delegated](project-dataverse-creator-privileges.md) — Connor 2026-05-06 OK'd direct entity creation for pilot scope; maintain `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` catalog.

## Dynamics Explorer
- [Explorer shipped features](project-dynamics-explorer-details.md) — multi-lib/subfolder doc listing [[project-dynamics-explorer-archive-libs]] + tool-result serializer [[project-dynamics-explorer-serializer-deferred]] + Search API/perf (77K docs, SSE) all SHIPPED → don't rebuild. Detail → [[project-closed-work-archive]].
- [Schema discovery: prefer the diff tool](project-dynamics-explorer-schema-diff.md) — `scripts/dynamics-schema-diff.js` enumerates ALL attributes; older `dynamics-schema-map.js` drops sparse fields.
- [Improve Explorer via Power Tools reuse](project-dynamics-explorer-reuse-power-tools.md) — Explorer fails on hand-transcribed schema (82/579 fields) + hardcoded GUIDs; reuse live-taxonomy/fetch-client/schema-diff. Assessment only (S200).
- [Thumbs feedback admin surface SHIPPED](project-dynamics-feedback-admin-shipped.md) — `DynamicsFeedbackSection` in admin.js + feedback GET/PATCH exist; S186 "no admin reads feedback" was stale — don't rebuild.

## Dynamics CRM
- [CRM users + licensing](project-dynamics-crm-users.md) — 16 licensed staff (@wmkeck.org) + ~180 service accounts; OBO not recommended (complexity).
- [Identity reconciliation SHIPPED](project-dynamics-identity-reconciliation.md) — DB bridge + MSCRMCallerID + adapter chain + token lifecycle (S127-129); delegate role granted, impersonation smoke PASS. Don't rebuild.
- [Email activities](project-dynamics-email.md) — `SendEmail` bound action; sender party needs `partyid_systemuser@odata.bind`; methods in `dynamics-service.js`.
- [OData API limitations](project-dynamics-crm-limitations.md) — `$skip` unsupported; `$count` fails with complex filters; `_formatted` fields not in `$select`.
- [AI fields — v3 canonical, all sets deployed](project-dynamics-ai-writeback.md) — 39 wmkf_ai_* fields on akoya_request (sets A–D; S209 re-probe); field names in v3 spec; `wmkf__ai_summary` cruft still present.
- [akoya_request PD fields](project-akoya-request-pd-fields.md) — `wmkf_programdirector` = lead PD; `wmkf_programdirector2` does NOT assign reviewers; `ownerid` = integration service account.
- [Grant lifecycle states confirmed (2026-05-01)](project-grant-lifecycle-states-confirmed.md) — `akoya_requeststatus` string: 'Concept Pending' → 'Phase I Pending' → 'Phase II Pending'.
- [Akoya temporal axis encodings](akoya-temporal-axis-encodings.md) — `wmkf_meetingdate` is the ONE canonical temporal field; FY + cycle derive from it. `Jxx`/`Dxx` is a June/Dec CONVENTION; off-month meetings drop today → fail-loud required.

## SharePoint
- [SharePoint document integration](project-sharepoint-integration.md) — site URL, folder pattern, multi-library layout (akoya_request + 3 archives), Graph API service, Sites.Selected perms.

## Reviewer Lifecycle
- [Reviewer apps redesign direction (S194)](project-reviewer-apps-redesign-direction.md) — Finder + Manager → request-scoped Reviewer Workbench + standalone Reviewer Pool. Decisions locked; don't propose incremental Finder/Manager cleanup.
- [Reviewer identity resolution (false-match redesign)](project-reviewer-identity-resolution.md) — Finder false-matches people (discovery ≠ identity); Tsai→lab-member Nakano via institution-only guard. Codex plan `docs/REVIEWER_IDENTITY_RESOLUTION_PLAN.md`: Phase 1 name-guard + confidence-gated persist; Phase 2 identity resolver. Principle: unresolved OK, wrong-and-confident not.
- [Reviewer identity resolution Phase 1 + Phase 2 PR1 SHIPPED S214](project-reviewer-identity-resolution-phase1.md) — Scholar name-guard + ORCID scoring + persistence gate (Phase 1); deterministic `resolveIdentity` classifier + 6 `wmkf_identity*` fields on prod gating all 3 write paths (Phase 2 PR1). ⚠ manual Workbench smoke still pending. Design: `docs/REVIEWER_IDENTITY_RESOLVER_PHASE2_DESIGN.md`.
- [Self-report ORCID sticky `confirmed` (PR4 SHIPPED S218)](project-reviewer-self-report-orcid-sticky-confirmed.md) — `confirmed` = reserved human-attestation sentinel; resolver must never emit it; `writeIdentityDecision`/`clearIdentityFields` fail-closed-skip on it or reviewer-attested ORCIDs get silently wiped.
- [Workbench invite workflow (S211-212)](project-reviewer-workbench-invite-workflow.md) — 5 sub-tabs Find→Candidates→Invite→Track→Completed; Candidates=invite (pre-accept), Invite=materials (post-accept); search results ephemeral until saved; send-safety server-authoritative on wmkf_accepted; enrichment disambiguates by affiliation.
- [Excluded reviewers often already in our pool](project-excluded-reviewers-often-in-pool.md) — applicant-excluded = competitors = domain experts; exclusion is per-request/case-by-case, NOT person-level "unfit". Disposition lives only on the junction row. S210 pilot chose soft-block-only (option B).
- [Appresearcher collapse — ✅ SHIPPED 2026-06-02](project-appresearcher-collapse-post-pilot.md) — sidecar folded onto `wmkf_potentialreviewers` (17 fields); `wmkf_appresearcher`/`apppublication`/`apppublicationauthor` DROPPED. Deferred tail: OPTIONAL removal of the `wmkf_organizationname` compat-shadow fallback (~15 readers). Doc `docs/APPRESEARCHER_COLLAPSE_PLAN_V2.md`.
- [Reviewer lifecycle automation plan](project-reviewer-lifecycle.md) — phased plan (A-D); Phase A (CRM send) is the foundation. Manual timestamp/status fields designed for cron-driven reminders + state machine in Wave 2 ([[project-reviewer-lifecycle-automation]]).
- [Accept/decline magic links](project-reviewer-accept-decline-links.md) — HMAC primitive shipped; build atop the existing token, don't add a new secret.
- [Reviewer Finder Dataverse-native entry path](project-reviewer-finder-dataverse-entry-path.md) — fully Dataverse-native (W3-W6 done 2026-05-12); Postgres reviewer tables drain-only, deletion ≥ 2026-07-01.
- [Contact promotion verified working](project-contact-promotion-permission.md) — AppendTo on Contact (BU) granted; send-emails links potentialreviewer → contact. App user has Create+AppendTo but NO DeleteAccess (S213): smoke cleanup orphans the contact; findByEmail ignores statecode → re-smoke needs a new email.
- [Institution contact-role triad](project-institution-foundation-liaison.md) — user-attested S159: `akoya_primarycontactid` = foundation liaison (NOT PI), `wmkf_projectleader` = the PI, `wmkf_researchleader` = institutional research officer (NOT PI).
- [External reviewer file access architecture](project-external-reviewer-file-access.md) — SHIPPED 2026-05-03. Token primitive, /external/* endpoints, SharePoint upload, event-driven token expiry. Don't rebuild.
- [Reviewer count invariant](project-reviewer-count-invariant.md) — need 3 confirmed reviewers per proposal; 5 wmkf_potentialreviewer slots are over-invite buffer.
- [Reviewer history data quality](project-reviewer-history-data-quality.md) — pre-J26 proposals have no Postgres rows; zeros are "unknown" not "0 invited".
- [Match reviewer affiliation against existing accounts](project-reviewer-institution-match.md) — `wmkf_potentialreviewer.wmkf_primaryaffiliation` is uncurated free text (S213: on the person); promotion to `contact.parentcustomerid` is the load-bearing join. Reuse intake fuzzy-match.

## Honoraria / BILL.com
- [Reviewer honorarium onboarding (portal-integrated)](project-bill-honorarium-integration.md) — extends Stage 2a accept: capture address + create honorarium akoya_request + trigger BILL inline. Reviewers ≥ 2026-06-17. Doc `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.
- [Grant request vs honorarium request nomenclature](akoya-request-honorarium-nomenclature.md) — both are `akoya_request` rows but mean different things; no data link by default; use precise terms.
- [akoya_request/payment field-gating semantics](akoya-payment-field-semantics.md) — `wmkf_vendorverified` is NOT a payment gate (S188); `akoya_paymentsent` misleading — use `akoya_folio="PAID"`.
- [Reviewer address collection is provisional](project-reviewer-address-collection-provisional.md) — Stage 2a payment-address may be a relic of manual BILL onboarding; server treats it OPTIONAL so removal is cheap.

## App Infrastructure
- [App-level access control](project-app-access-control.md) — Dataverse `wmkf_appuserappaccesses`; appRegistry.js source of truth; `requireAppAccess()` coverage checked by `check:fact-consistency`.
- [Admin dashboard + API keys](project-admin-dashboard.md) — centralized server-side keys; usage logged to `api_usage_log`; Justin (id=2) is superuser.
- [Virtual Review Panel](project-virtual-review-panel.md) — multi-LLM panel (Claude/GPT/Gemini/Perplexity); app key `virtual-review-panel`; stays Postgres permanently.
- [Tone calibration](feedback-review-panel-tone.md) — CSO feedback: don't mimic conservative study sections; balance critique with upside.
- [API Credit Monitoring](project-api-credit-monitoring.md) — admin dashboard widget + low-balance email alerts.
- [Dataverse Power Tools](project-dataverse-power-tools.md) — two apps (Find&fix + Bulk export) for gaps Explorer can't fill; design `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` ("Residuals" = SoT). S160: Phase 1 spine done; next = Phase 2 (API+UI+Blob).
- [Dataverse Export floor scoping](dataverse-export-floor-scoping.md) — Track B's headline is the NL AI on-ramp; the filter "floor" is the bulk-selective SUBSET of the export-column contract, not 1:1. PI/primary-contact/donor are per-program disjunctions.
- [Living-taxonomy principle](project-living-taxonomy-principle.md) — taxonomies are living: read-live/fail-loud at runtime, no doc cadence; durable record = invariants/hazards + staff guide, not value lists; probe only with a structural hypothesis.

## Prompt + Execution
- [Prompt storage strategy + Executor Contract](project-prompt-storage-strategy.md) — Path B (declarative wrappers). Spec `docs/EXECUTOR_CONTRACT.md`; table `wmkf_ai_prompt`; impl `lib/services/execute-prompt.js`.
- [PDF Processing Tiers](project-pdf-processing-tiers.md) — text-only for auto/bulk, full PDF vision for selective/detailed.

## New AI Capabilities
- [Compliance + Staff Matching](project-new-ai-capabilities.md) — Staff-matching SHIPPED as Expertise Finder (with UI); Compliance Screening still unbuilt (batch-eval → PowerAutomate plan).

## Dev Environment
- [Dev environment](project-dev-environment.md) — `npm run dev` port 3000; auth off in dev; `.env.local` values quoted; WAVE1 flags mirror prod since 2026-05-11.
- [Vercel "Sensitive" env vars pull EMPTY](project-vercel-sensitive-env-pull-empty.md) — `vercel env pull` returns recently-added secrets (ORCID/NCBI/blob tokens) blank (write-only); paste by hand. Don't copy VERCEL_*/TURBO_*/AUTH_* into `.env.local`. eslint NOT installed locally (lint is CI-only).
- [Dynamics sandbox state](project-dynamics-sandbox-state.md) — a reachable prod-clone sandbox exists (`orgd9e66399`) but is schema-stale → NOT drop-in usable for reviewer testing without a schema deploy + email check. Corrects "no test store".
- [Local jest/build environment](local-jest-build-environment.md) — S173 FIXED: Rosetta off, Node 26 arm64 via Homebrew, clean node_modules; `npx jest` + `npm run build` work locally. Don't re-litigate.
- [git traversal commands hang](env-broken-git-autogc.md) — `gc`/`fsck`/`repack`/`prune` hang in mmap() on `.git` loose objects (cloud File Provider offloaded them). Fix = repo on a plain local path; `gc.auto 0` interim.
- [Accept MODULE_TYPELESS warning](decision-module-typeless-warning-accept.md) — S164 Codex-reviewed: the Node `MODULE_TYPELESS_PACKAGE_JSON` reparse warning is ACCEPTED; never a broad `.js`→`.mjs` rename. Don't re-litigate.

## User Context
- [PA Experience](user-powerautomate.md) — Justin: no experience; Connor: moderate. Write flow specs at middle detail.

## Closed / Archived (reference only)
- [Closed & shipped work archive](project-closed-work-archive.md) — point-in-time status + closed migrations pulled out of the live index (Wave 1 history, slice-0 status snapshots, superseded intake decisions, shipped-feature detail). Recall when a subject resurfaces.
