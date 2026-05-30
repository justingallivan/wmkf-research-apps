# Project Memory

## Operational
- [rtk grep output corruption](project-rtk-grep-output-corruption.md) — rtk's grep filter fabricated tool output mid-session (placeholder lines, dup headers, backwards line numbers), masking a failed Edit. Now disabled. Suspect rtk if grep/cat output looks off; verify with git diff / Read / node markers.
- [Verify before destructive carryover](feedback-verify-before-destructive-carryover.md) — drop/remove/retire/archive items from carryover lists must be grep-verified first. Carryover lists go stale; one nearly broke Reviewer Finder on 2026-05-03.
- [List and confirm before bulk deletes](feedback-list-and-confirm-before-bulk-deletes.md) — narrow cleanup directive ≠ implicit authorization to delete adjacent items. S193: deleted 4 files in a folder when user asked about 1; one was a restorable-but-real reviewer-form fixture.
- [Check memory before asking the user](feedback-check-memory-before-asking-user.md) — pre-send "has X happened" items are lookup tasks, not user-confirm tasks. Scan MEMORY.md + recent commits first; rewrite stale doc framing without asking.
- [Red CI gates are P0 blockers, not side-notes](feedback-red-gates-are-p0.md) — run `check:atlas` + `check:api-routes` manually at session start. A red gate means the rubric is being violated right now — fix before any data-layer commits.
- [Surface every finding from external reviewers, don't filter](feedback-surface-full-review-findings.md) — when Codex / code-reviewer / similar raises issues, list ALL findings using the reviewer's own labels. My recommendations come after the full set, not instead of it.
- [Reconcile docs, don't append-patch](feedback-reconcile-dont-append-docs.md) — recurring failure (S157/S158/S166, ≥3× in one session): fixing a fact in one place, stale restatements rot elsewhere. Edit the whole doc to one consistent state; grep all restatements; top-says-X/tail-says-not-X is a P0. **S166: `check:fact-consistency` is a bounded backstop for registered code-derived scalars; emit no "DONE" for fact-level doc/memory edits until the fan-in (gate/grep/Codex) is green.**
- [Apply reconcile rules to fix-work, not just original drafts](feedback-apply-reconcile-to-fix-work.md) — S196 collapse-plan rounds 1→2→3: each Codex round caught fresh bugs in MY fix work. Internal contradictions, partial doc fixes, unverified claims smuggled by table structure, wrong premises. Fix-work is original work; verify-as-you-go, don't batch-then-review.
- [Memory store + propagation](memory-store-propagation.md) — ONE canonical store: git-tracked `.claude-memory/`, kebab-case, committed by `/stop`. The per-machine harness store is symlinked into it; the symlink is keyed to the repo's path-derived slug, so re-create it per machine and after any repo move. `/start` should flag if the harness path is a regular dir (= diverging). Never put `.git` in a cloud-synced folder.
- [Drive multi-part work to completion](feedback-drive-to-completion.md) — on a known multi-part initiative, keep building part after part; don't end turns with "should I keep going?" stop-menus. Stop only for genuine forks (destructive action, ambiguous requirement).
- [Thoroughness is the default, not optional](feedback-thoroughness-default.md) — skimming saves session time but costs the user Codex tokens + review attention. Banner-only edits, description-only memory edits, and same-frame re-reads are unacceptable shortcuts. Surface incompleteness explicitly when it exists.
- [Relay Codex output verbatim](feedback-share-codex-verbatim.md) — every Codex round-trip: paste stdout exactly, as the ENTIRE response. No commentary before or after (S155 tightening supersedes the old "after is OK"); raise decisions in a separate turn. Acting on findings afterward is fine.
- [Real fix, not a design-note](feedback-real-fix-not-design-note.md) — when external review surfaces a correctness issue, default is "fix it + here's the cost" not "acceptable for pilot / last-writer-wins / submit-strict catches it." S184 chunk 5 race fix exemplifies: I framed a TOCTOU as tolerable; user pushed back; the SQL-level gate was 60-90 min of work and the only race-safe layer.
- [Verify external-platform claims](feedback-verify-external-platform-claims.md) — before stating Dataverse / PA / Azure / Vercel / etc. behavior, WebFetch the authoritative doc. Memory of platform shape is lossy on defaults, configurability, edge cases. Structure (matrices, tables) smuggles confidence regardless of whether claims are verified.
- [Cite ground truth — never pass through unsourced](feedback-cite-ground-truth.md) — every external-fact claim gets a source (URL, file:line, Codex round + their citation, "memory entry X", or explicit "unverified"). Pass-through citations from Codex must be retained. S188: user got bitten by an unsourced Neon-pricing claim I'd inherited from Codex without preserving the URL.
- [Falsify, don't confirm](feedback-falsify-not-confirm.md) — for any scope/quantity claim (only/all/none/N-of-M/source-of-truth), run the DISCONFIRMING query (complement/counter-instance), derive M independently of N, or hedge. Enforced by a PreToolUse hook (`.claude/hooks/scope-claim-reminder.js`). Self-review is blind to its own premises; this is a forcing function, not willpower.
- [No performative contrition when I make mistakes](feedback-no-performative-contrition.md) — when caught in a mistake, lead with the fix, not analysis of why I made it. No memory citations as receipts, no "I should have...", no "exactly the failure mode warns against." One-sentence ack max, then move.
- [Dataverse schema-deploy gotchas](project-dataverse-schema-deploy-gotchas.md) — 429 throttling between metadata writes (wrap in 30s-backoff retry), `@odata.bind` keys are PascalCase nav-properties, queryAllRecords caps at 5000.
- [Human-legibility schema principle](feedback-human-legibility-schema-principle.md) — prefer expanding enums on existing entities over proliferating obscure child tables; non-technical staff browse Dataverse, fewer tables wins.
- [Grep general terms not domain jargon](feedback-grep-general-codebase-terms.md) — when checking "does the codebase have X", grep terms the prior implementer would have used (untrusted/sentinel/boundary), not article-jargon (S182 burned half a session missing A7 this way).
- [Stakeholder email tone](feedback-stakeholder-email-tone.md) — drop insider jargon ("semantically load-bearing", subsystem names like "intake-portal drain") in Connor/Sarah/DFT emails; frame in their domain not the codebase's.

## Security Infrastructure
- [A7 prompt-injection hardening — SHIPPED S173-S177](project-a7-prompt-injection-hardening.md) — all 24 LLM input surfaces are CI-gated and hardened (wrapUntrustedContent + preamble + validateAiJson + multimodal). Do NOT build a parallel system. Read `docs/security-audit/A7_PROMPT_INJECTION_PLAN.md` before any injection-related design.
- [Virus scanning IT context (S190)](project-virus-scanning-it-context.md) — WMKF tenant has NO MDO / no Safe Attachments; workstation Defender + Huntress only. App-side Cloudmersive is the PRIMARY defense for reviewer + intake (external upload paths). DFT does NOT need per-detection emails (no quarantine to investigate). Internal alerts route to the PD on the related request/cycle. Sender UX preserves form text on detection.
- [Cloudmersive /advanced endpoint (S193)](project-cloudmersive-advanced-endpoint.md) — scan uses /virus/scan/file/advanced not /basic; /basic was a no-op for our threat model (can't see container contents). Contains* flags synthesized into foundViruses[0].virusName.

## Collaboration Notes
- [Concepts vs Phase I are different grant stages](feedback-concepts-vs-phase-i.md) — hard-exclude `/concept/i` files from Phase I prompt pipelines
- [Cycle gating vs. Executor scope](feedback-cycle-vs-executor-scope.md) — "cycle" only gates Connor-collaboration work; Executor is for backend-automation prompts; user-facing apps (Reviewer Finder) are independent of both
- [Codex as recurring code review surface](project-codex-recurring-review.md) — Justin runs Codex periodically; treat findings as input not to-do list, mirror the 2026-04-30 response doc shape
- [Codex design → pre-impl → impl → post-impl iteration](project-codex-design-pre-impl-iteration.md) — for multi-chunk builds: write a focused design doc per chunk, Codex pre-impl review (catches 3-5 architectural issues), fold catches, implement, commit, Codex post-impl review (catches 3-9 implementation drift / edge issues). S184's 13-commit 6-chunk intake-attach build was the canonical run of this loop.

## Wave 1 Prod Migration (CLOSED 2026-05-12)
- [Wave 1 closeout](project-wave1-pending.md) — Postgres tables dropped 2026-05-12; dispatcher defaults flipped to Dataverse. Only tail item: elevation revert on prod app user (deferred until pilot iteration settles).
- [Automated onboarding design](project-wave1-onboarding.md) — zero-touch first-login provisioning via NextAuth callback; design still relevant for future build

## Wave 2 Pending Tail Items
- [W6 Postgres table-drop pending (fire ≥ 2026-07-01)](project-w6-table-drop-pending.md) — drain-only reviewer tables (researchers / researcher_keywords / publications / proposal_searches) await one-shot DELETE + DROP. P0 start-of-session item if today ≥ 2026-07-01 and tables still exist.

## Planned Capabilities
- [IRS tax-exempt verification](project-irs-exempt-verification.md) — bulk CSVs in Postgres, PA→Vercel lookup endpoint, verified result written back to Dynamics `account`.

## Strategic Direction
- [Whole-system conceptual model](project-system-model.md) — canonical model at `docs/SYSTEM_MODEL.md`: rote/thinking principle, two orthogonal axes (automation vs record-maturity), app = prompt×adapter, backend-automation-is-a-PA-dependency-not-a-capability, two interaction modes, doc-resolution provenance tiers, reviewer state machine = backbone. Read before cross-capability planning. Intake "Phase II pilot" is DEFUNCT; drift sweep + sequencing pending.
- [Strategy direction + key decisions](project-strategy-direction.md) — AkoyaGO posture (minimize, not replace), Dynamics as ground truth, backend triggers, Connor collaboration. See `docs/STRATEGY.md` for full doc.
- [Backend Automation Vision](project-backend-automation.md) — PowerAutomate-triggered processing, configurable prompts, Dynamics write-back
- [Interim grant report auto-evaluation](project-interim-report-automation.md) — backend job to evaluate yearly interim reports + write to Dynamics. Unblocked; field/prompt/process design still needed.
- [Staged Review Pipeline](project-staged-review-pipeline.md) — 3-stage automated triage (fit screen → intelligence brief → virtual panel) for new cycle's higher volume
- [Proposal Context Extraction](project-proposal-context-extraction.md) — pre-extract structured fields so downstream calls use curated ~1.5K-token extracts instead of full ~7K-token proposals. Full plan at `docs/PROPOSAL_CONTEXT_EXTRACTION_PLAN.md`
- [Phase I summary app winddown](project-phase-i-summary-app-winddown.md) — strategic deprioritization, NOT a freeze. `/phase-i-dynamics` still actively iterated as a prompt-tuning surface.
- [Dynamics as staff-prompt ground truth](project-dynamics-as-prompt-ground-truth.md) — `wmkf_ai_prompt` should hold all staff-facing prompts; new prompts default there; migrate user-driven apps when touched.
- [App roadmap 2026-04-25](project-app-roadmap-2026-04-25.md) — Concept Evaluator deprecating; Grant Reporting + Integrity Screener growing PA triggers; Reviewer Finder is top post-cycle priority.
- [Grant phasing evolution](project-grant-phasing-evolution.md) — reviewer-finding only at Phase II; concepts going away; next cycle: one applicant-facing package, internal Phase I/II labels persist.

## Intake Portal (GOapply replacement)
- [External ID auth foundation SHIPPED (S129)](project-intake-portal-external-id-foundation.md) — tenant `04a1406b...`, NextAuth `entra-external` provider, `/apply` route auth round-trip verified.
- [Intake portal UI TODOs (deferred to UI-design session)](project-intake-portal-ui-todo.md) — S187 surfaced two UX bugs while smoke-testing DR8: (1) sign-out silently re-authenticates via Entra and (2) Entra sign-up flow collects irrelevant City/State/DisplayName fields. Both held for a dedicated UI session.
- [Intake portal virus-scan e2e — DEFERRED](project-intake-portal-virus-scan-e2e-deferred.md) — S193 verified reviewer path; intake path skipped (Entra sign-up rough). MUST run EICAR-style e2e through /apply before the next cycle's Phase I intake goes live.
- [Skinny pilot scope, not feature-for-feature](project-intake-portal-skinny-scope.md) — intake sized like external reviewer intake (skinny, not a GOapply rewrite); built for the next cycle's Phase I intake (the June 2026 Phase II Research pilot is superseded — see [[project-system-model]]); design doc at `docs/INTAKE_PORTAL_DESIGN.md`
- [Capture machine-legible structured data](project-machine-legible-form-capture.md) — split budgets/rosters/milestones into structured fields, not narrative; Sarah + Connor own form wishlists
- [Match institution against existing accounts at intake](project-intake-portal-institution-match.md) — match-first, create-as-last-resort against `accounts.{name, akoya_aka, wmkf_legalname, wmkf_abbreviation}`. Free-text input pollutes the canonical institution registry ("Stafnord" → "Stanford"). GOverify doesn't dedup.
- [Pilot decisions locked 2026-05-06](project-intake-portal-pilot-decisions-2026-05-06.md) — six-decision walkthrough w/ Connor. **Items 1C + 1D superseded by 2026-05-13 entry.**
- [Pilot Track 1 decisions 2026-05-13](project-intake-portal-pilot-decisions-2026-05-13.md) — 4 Track-1 items closed (1A membership Option A, 1B PA flows origin-agnostic, 1C reversed to PA-built packet, 1D narrowed to budget+roster)
- [Slice-0 deactivate-not-delete recalc](slice0-deactivate-not-delete-recalc.md) — Connor's ruling: roster rollup uses `statecode` deactivation, never hard delete. CLOSED: P1-Update verdict FAIL → Option A′ flow-body conditional fallback (zero schema rework). **Slice-0 schema DEPLOYED to prod Dataverse S178 (2026-05-22).** Remaining: Connor's prod A′ flow + P4 re-verify + drain/portal code (none block the deployed schema).
- [Reviewer migration plan locked S136](project-reviewer-postgres-to-dataverse-migration.md) — 1:1 model; most Postgres tables drain not migrate; auth doc `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md`
- [Reviewer identity fragmentation](reviewer-identity-fragmentation.md) — S158 *sample-based flag* (5/87 rows + architecture, Postgres not join-tested): a reviewer appears to span ≥4 disjoint stores (dirty auto-created `contact` + GOapply object + honorarium `akoya_request` + Postgres `researchers` (drain-only post-W6)) with no shared key; forward constraint on Reviewer Manager → Dataverse, not an exhaustive census
- [No banking/PII in Dataverse](project-no-banking-pii-in-dataverse.md) — firm S158 management constraint: remittance/banking PII stays at bill.com (SoR); Dataverse stores only onboarding-status + a join pointer, never the detail
- [Dataverse creator privileges delegated](project-dataverse-creator-privileges.md) — Connor 2026-05-06 OK'd direct entity creation for pilot scope; maintain `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` audit catalog
- [Slice-0 wmkf_role probe + extension — VERIFIED](project-slice0-role-probe.md) — `scripts/probe-apprequestperson-role-data.js` for live-data, `scripts/extend-apprequestperson-role-picklist.mjs` (idempotent) for extension. S179 re-verify: data CLEAR (5,561 rows, none in 100000002-4); picklist already fully expanded in prod (extender reports 0 inserted). Drain plan v7 P5 ✓.
- [Slice-0 scope is 4 items not 3](project-slice0-scope.md) — carryover C dropped `wmkf_portal_membership`; trust the 2026-05-14 SCHEMA_CHANGES catalog, wave dir = wave4
- [Slice-0 timeline posture](project-slice0-timeline-posture.md) — 2026-05-19/05-15 dates are SOFT with deliberate slack; Connor in good-faith progress on Item 6; report gating factually, NO "overdue/at-risk" urgency, no aggressive chasing

## Dynamics Explorer
- [Multi-library + subfolder document listing shipped](project-dynamics-explorer-archive-libs.md) — `list_documents` and `search_documents` walk archives + nested folders via `lib/utils/sharepoint-buckets.js`
- [Tool-result serializer SHIPPED](project-dynamics-explorer-serializer-deferred.md) — `lib/utils/dynamics-explorer-serializer.js` redacts sensitive fields + caps long strings
- [Dataverse Search API + perf optimizations](project-dynamics-explorer-details.md) — Search API enabled (77K+ docs), inline schemas, parallel execution, SSE streaming
- [Schema discovery: prefer the diff tool](project-dynamics-explorer-schema-diff.md) — `scripts/dynamics-schema-diff.js` enumerates ALL Dataverse attributes; older `dynamics-schema-map.js` silently drops sparsely-populated fields
- [Improve Explorer via Power Tools reuse](project-dynamics-explorer-reuse-power-tools.md) — Explorer fails on hand-transcribed schema (82/579 akoya_request fields) + trust-hardcoded-GUIDs heuristics; reuse live-taxonomy/fetch-client/schema-diff/encoded-ground-truth. Assessment only (S200), no build decided.
- [Thumbs feedback admin surface SHIPPED](project-dynamics-feedback-admin-shipped.md) — `DynamicsFeedbackSection` in `pages/admin.js` + `/api/dynamics-explorer/feedback` GET/PATCH already exists. S186 audit #10 "no admin page reads feedback" was stale-premise; don't rebuild.

## Dynamics CRM
- [CRM users + licensing](project-dynamics-crm-users.md) — 16 licensed staff (@wmkeck.org) + ~180 service accounts; OBO not recommended due to complexity
- [Identity reconciliation SHIPPED](project-dynamics-identity-reconciliation.md) — DB bridge + MSCRMCallerID + adapter chain + token lifecycle (S127–S129). Delegate role granted 2026-05-06; impersonation smoke PASS.
- [Email activities](project-dynamics-email.md) — `SendEmail` bound action; sender party must include `partyid_systemuser@odata.bind`; methods in `dynamics-service.js`
- [OData API limitations](project-dynamics-crm-limitations.md) — `$skip` unsupported; `$count` endpoint fails with complex filters; `_formatted` fields not in `$select`
- [AI fields — v3 canonical, all sets deployed](project-dynamics-ai-writeback.md) — 28 wmkf_ai_* fields on akoya_request deployed 2026-05-07; canonical field names in v3 spec
- [akoya_request PD fields](project-akoya-request-pd-fields.md) — `wmkf_programdirector` is lead PD; `wmkf_programdirector2` does NOT assign reviewers; `ownerid` is integration service account
- [Grant lifecycle states confirmed (2026-05-01)](project-grant-lifecycle-states-confirmed.md) — `akoya_requeststatus` string: 'Concept Pending' → 'Phase I Pending' → 'Phase II Pending'
- [Akoya temporal axis encodings](akoya-temporal-axis-encodings.md) — `wmkf_meetingdate` is the ONE canonical temporal field; fiscal year + grant cycle derive from it. `Jxx`/`Dxx` cycle is a June/Dec CONVENTION not an invariant — off-month meetings silently drop today; fail-loud required.

## SharePoint
- [SharePoint document integration](project-sharepoint-integration.md) — site URL, folder pattern, multi-library layout (akoya_request + 3 archives), Graph API service, Sites.Selected permissions

## Reviewer Lifecycle
- [Reviewer apps redesign direction (S194)](project-reviewer-apps-redesign-direction.md) — Finder + Manager slated to be replaced by request-scoped Reviewer Workbench + standalone Reviewer Pool. Architecture decisions locked; build deferred. Don't propose incremental Finder/Manager cleanup as the path forward.
- [Appresearcher collapse pending post-pilot](project-appresearcher-collapse-post-pilot.md) — `wmkf_appresearcher` 1:1 sidecar is structural redundancy; collapse bibliometric fields into `wmkf_potentialreviewer` post-pilot. Don't act mid-pilot.
- [Reviewer lifecycle automation plan](project-reviewer-lifecycle.md) — phased plan (A-D); Phase A (CRM send) is foundation
- [Lifecycle tracking → automation goal](project-reviewer-lifecycle-automation.md) — schema's manual timestamp/status fields designed for cron-driven reminders + state machine in Wave 2
- [Accept/decline magic links](project-reviewer-accept-decline-links.md) — HMAC primitive shipped; build atop existing token, don't add new secret
- [Reviewer Finder Dataverse-native entry path](project-reviewer-finder-dataverse-entry-path.md) — fully Dataverse-native (W3–W6 cutovers complete 2026-05-12); Postgres reviewer tables are drain-only, scheduled for deletion ≥ 2026-07-01 per W6 plan
- [Contact promotion verified working](project-contact-promotion-permission.md) — AppendTo on Contact (BU) granted 2026-05-01; send-emails fully links potentialreviewer → contact
- [Institution contact-role triad](project-institution-foundation-liaison.md) — WMKF domain fact (user-attested S159): `akoya_primarycontactid` = foundation liaison/steward (NOT PI), `wmkf_projectleader` = the PI/scientific lead (program-conditional), `wmkf_researchleader` = institutional research officer (NOT PI); disclose accordingly anywhere they surface
- [External reviewer file access architecture](project-external-reviewer-file-access.md) — SHIPPED 2026-05-03. Token primitive, /external/* endpoints, SharePoint upload, event-driven token expiry all live.
- [Reviewer count invariant](project-reviewer-count-invariant.md) — need 3 confirmed reviewers per proposal; 5 wmkf_potentialreviewer slots are over-invite buffer
- [Reviewer history data quality](project-reviewer-history-data-quality.md) — pre-J26 proposals have no Postgres rows; zeros are "unknown", not "0 invited"
- [Match reviewer affiliation against existing accounts](project-reviewer-institution-match.md) — `wmkf_appresearcher.wmkf_primaryaffiliation` is uncurated free text today; promotion to `contact.parentcustomerid` is the load-bearing join. Reuse the intake-portal fuzzy-match primitive at save-candidates, contact promotion, and any future reviewer self-edit.

## Honoraria / BILL.com
- [Reviewer honorarium onboarding (portal-integrated)](project-bill-honorarium-integration.md) — extends already-shipped Stage 2a accept endpoint to capture address + create honorarium akoya_request + trigger BILL.com inline. Target ready 2026-06-10; reviewers ≥ 2026-06-17. Design doc at `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`, 6 Connor questions + 1 informational.
- [Grant request vs honorarium request nomenclature](akoya-request-honorarium-nomenclature.md) — both stored as `akoya_request` rows but mean very different things; no data link between them by default; use precise terms always.
- [akoya_request/payment field-gating semantics](akoya-payment-field-semantics.md) — `wmkf_vendorverified` is NOT a payment gate (empirical, S188); `akoya_paymentsent` misleading — use `akoya_folio="PAID"` instead.
- [Reviewer address collection is provisional](project-reviewer-address-collection-provisional.md) — Stage 2a payment-address may be a relic of manual BILL onboarding; required-when-honorarium/hidden-on-opt-out for now; server treats it OPTIONAL so removal is cheap if office says BILL registration suffices.

## App Infrastructure
- [App-level access control](project-app-access-control.md) — Dataverse `wmkf_appuserappaccesses`; appRegistry.js source of truth; `requireAppAccess()` coverage is checked by `check:fact-consistency`
- [Admin dashboard + API keys](project-admin-dashboard.md) — centralized server-side keys; usage logged to `api_usage_log`; Justin (id=2) is superuser
- [Virtual Review Panel](project-virtual-review-panel.md) — Multi-LLM panel (Claude, GPT, Gemini, Perplexity); app key `virtual-review-panel`; stays Postgres permanently
- [Tone calibration](feedback-review-panel-tone.md) — CSO feedback: don't mimic conservative study sections; balance critique with upside
- [API Credit Monitoring](project-api-credit-monitoring.md) — admin dashboard widget + low-balance email alerts
- [Dataverse Power Tools](project-dataverse-power-tools.md) — two separate apps (Find&fix edits + Bulk export) for the gaps Dynamics Explorer can't fill; design at `docs/DATAVERSE_POWER_TOOLS_DESIGN.md` (its "Residuals — AUTHORITATIVE LIST" is the single source of truth). S159: v1-core gates CLOSED + BUILD PLAN WRITTEN (`docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md`) — residual (i) default column contract closed & user-confirmed + Codex-audited (open non-v1-core: 121-view preset library + 4-RDL de-nest), (ii) user-authority-closed, (iii) artifact-backed closed, decline segmentation probe-resolved. **S160: Phase 1 deterministic spine IMPLEMENTED + Codex-converged** (`lib/services/dataverse-export/`, 43/43 headless tests); next = Phase 2 (API + builder UI + Blob). Track A write path still on 3 policy decisions; Puzzle 2c still open
- [Dataverse Export floor scoping](dataverse-export-floor-scoping.md) — Track B's headline vision is the NL AI on-ramp; the filter "floor" is the bulk-selective SUBSET of the export-column contract, not 1:1. PI / primary-contact / donor are per-program disjunctions and AI-grounding footguns.
- [Living-taxonomy principle](project-living-taxonomy-principle.md) — taxonomies are living; read-live/fail-loud at runtime, no doc cadence; durable record = invariants/patterns/hazards + a staff orientation guide, NOT hardcoded value lists; probe only with a structural hypothesis

## Prompt + Execution
- [Prompt storage strategy + Executor Contract](project-prompt-storage-strategy.md) — Path B (declarative wrappers). Spec: `docs/EXECUTOR_CONTRACT.md`. Table: `wmkf_ai_prompt`. Implementation: `lib/services/execute-prompt.js`.
- [PDF Processing Tiers](project-pdf-processing-tiers.md) — text-only for auto/bulk, full PDF vision for selective/detailed

## New AI Capabilities
- [Compliance + Staff Matching](project-new-ai-capabilities.md) — batch eval on historical data → auto-deploy via PowerAutomate

## Dev Environment
- [Dev environment](project-dev-environment.md) — `npm run dev` port 3000; auth off in dev; `.env.local` values are quoted; WAVE1 flags mirror prod since 2026-05-11
- [Local jest/build environment](local-jest-build-environment.md) — S173 FIXED: Rosetta off, Node 26 arm64 via Homebrew, clean `node_modules`. `npx jest` + `npm run build` both work locally now; don't re-litigate.
- [git traversal commands hang](env-broken-git-autogc.md) — `gc`/`fsck`/`repack`/`prune` hang in `mmap()` on `.git` loose objects. CONFIRMED S175: a cloud File Provider offloaded loose objects to `dataless` placeholders. Fix = repo on a plain local path off any cloud sync. `gc.auto 0` is an interim workaround.
- [Accept MODULE_TYPELESS warning](decision-module-typeless-warning-accept.md) — S164 Codex-reviewed decision: the Node `MODULE_TYPELESS_PACKAGE_JSON` reparse warning is ACCEPTED as-is. Never do a broad `.js`→`.mjs` rename. Do not re-litigate.

## User Context
- [PA Experience](user-powerautomate.md) — Justin: no experience; Connor: moderate. Write flow specs at middle detail.
