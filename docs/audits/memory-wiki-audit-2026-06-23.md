# Memory/Wiki Staleness Audit

Run timestamp: 2026-06-23 18:03 PDT (2026-06-24 UTC)  
Repo HEAD: `04611a3f55169bfcaf6853f7c0219d4d66cf8a7e`  
Scope: `.claude-memory/*.md` and `docs/agent-wiki/**/*.md`  
Edit scope honored: this report only.

## Method

- Read `CLAUDE.md`, `.claude/rules/durable-docs.md`, the audit prompt, and the relevant `sweep` / `contract-reconcile` workflow instructions first.
- Stage 0 calibrated on all 12 `docs/agent-wiki/topics/*.md` files.
- Stage 1 covered the remaining 179 files under `.claude-memory/*.md`, `docs/agent-wiki/index.md`, and `docs/agent-wiki/log.md`.
- Static verification used repo producers, call sites, path/symbol existence checks, gates, and line-numbered source reads.
- Live-only facts were not guessed. They are marked `NEEDS-PROBE` with the required probe.

Counts use one claim unit per concrete reference cluster, not every prose sentence. Historical lessons, routing advice, preferences, frontmatter, and wiki links were skipped unless they made a concrete current-state claim.

## Summary

| Verdict | Count |
|---|---:|
| VERIFIED | 1243 |
| STALE | 26 |
| UNVERIFIABLE | 0 |
| NEEDS-PROBE | 82 |

## Stage 0 Calibration

Stage 0 found one actionable stale topic claim:

| File:line | Claim | Evidence | Correction |
|---|---|---|---|
| `docs/agent-wiki/topics/prompt-executor.md:21` | Watch path includes `shared/prompts/**`. | `test -e shared/prompts` returned `MISSING`; `test -e shared/config/prompts` returned `EXISTS`; `shared/config/prompts/README.md:5,10` and `lib/services/reviewer-prompt-resolver.js:31` identify the current prompt path. | Replace `shared/prompts/**` with `shared/config/prompts/**`. |

Stage 0 also produced these `NEEDS-PROBE` items:

| File:line | Claim cluster | Probe needed |
|---|---|---|
| `docs/agent-wiki/topics/finance-honoraria.md:38-40` | Production honorarium/BILL deferral and discriminator env posture. | Vercel production env/runtime check for `HONORARIUM_ONBOARDING_DEFERRED`, `HONORARIUM_PROGRAM_ID`, `HONORARIUM_GRANTPROGRAM_ID`, `HONORARIUM_TYPE_ID`, and BILL flags. |
| `docs/agent-wiki/topics/security-auth.md:58-82` | Branded domains, Azure redirect, runtime health, authenticated write, and legacy-host behavior. | Vercel domain/env/deployment inspection, Azure redirect URI check, and authenticated browser/API smoke. |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md:49` | Nine reviewer-engagement Dataverse fields are provisioned in production. | Dataverse metadata query or `apply-dataverse-schema --target=prod --wave=7-reviewer-engagement --dry-run`. |
| `docs/agent-wiki/topics/integrity-screener.md:64-75` | PubPeer external/API access status and sanctioned contact path. | PubPeer official docs/contact confirmation; do not treat undocumented endpoint behavior as verified. |

## Actionable Stale Findings

| File:line | Claim | Evidence | Correction |
|---|---|---|---|
| `.claude-memory/akoya-request-honorarium-nomenclature.md:31-32` | Honorarium discriminator is only `akoya_program` + `wmkf_grantprogram` + `wmkf_type`. | `rg -n "wmkf_request_type\|HONORARIUM_REQUEST_TYPE_INDIVIDUAL" lib/bill docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md` found the fourth discriminator in `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md:29,144`, `lib/bill/honorarium-discriminators.js:8,27`, and `lib/bill/honorarium-onboard-orchestrator.js:150`. | Include `wmkf_request_type = Individual` / `HONORARIUM_REQUEST_TYPE_INDIVIDUAL`. |
| `.claude-memory/akoya-request-honorarium-nomenclature.md:49` | Provenance via proposed future `wmkf_honorariumforrequest` lookup. | `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md:249,301` and `lib/dataverse/adapters/reviewer-suggestion.js:916-920` show shipped provenance is `wmkf_HonorariumRequest@odata.bind`. | Say shipped provenance is `wmkf_HonorariumRequest` on `wmkf_appreviewersuggestion`, targeting `akoya_request`. |
| `.claude-memory/decision-module-typeless-warning-accept.md:27` | `37 of 174 scripts/*.js are ESM; 136 CJS`. | Node inventory over top-level `scripts/*.js` returned `{ topLevelScriptsJs: 243, esm: 61, cjs: 182 }`; recursive inventory returned `{ scriptsJs: 252, esm: 61, cjs: 191 }`. | Update the inventory or remove exact counts. |
| `.claude-memory/env-broken-git-autogc.md:27` | Loose-object count is about `3K`. | `git count-objects -v` returned `count: 6287`; direct loose-object `find` also returned `6287`. | Current loose-object count is 6,287. |
| `.claude-memory/env-broken-git-autogc.md:68-69` | `gc.auto 0` remains set as an interim workaround. | `git config --get gc.auto` exited `1` with empty output. | Say `gc.auto` is currently unset, or remove the old workaround note. |
| `.claude-memory/feedback-behavior-claims-cite-the-producer.md:33` | Producer path `lib/external/proposal-readiness.js::isProposalReadyForReviewers()` exists and `HoldView` is dormant. | `test -e lib/external/proposal-readiness.js` and `test -e shared/components/external/HoldView.js` both failed; `docs/REVIEWER_ENGAGEMENT_SPEC.md:13-21` says the hold/readiness path was removed; `pages/api/external/review/[token]/context.js:260-290` now falls through to `stage2a`. | Say the hold/readiness path was removed; current producer is `computeEngagementState()` in `pages/api/external/review/[token]/context.js`. |
| `.claude-memory/feedback-reconcile-dont-append-docs.md:24,33` | Fact consistency registry is in `scripts/check-fact-consistency.js` and currently has app-definition count plus requireAppAccess endpoint count. | `scripts/check-fact-consistency.js:15,34` imports the live registry from `scripts/lib/canonical-facts.js`; `scripts/lib/canonical-facts.js:216,218,274,304,353`, `docs/CI_GATES_REFERENCE.md:32`, and `docs/CANONICAL_COUNTS.md:4` show the current facts include `api-route-file-count`. | Registry is `scripts/lib/canonical-facts.js`; current fact IDs include `app-definition-count`, `requireappaccess-endpoint-count`, and `api-route-file-count`. |
| `.claude-memory/project-a7-prompt-injection-hardening.md:3,7,20,29,35` | A7 covers/reports 24 LLM-input surfaces. | `npm run check:prompt-injection-tagging` returned `Prompt-injection tagging OK - 27 migrated surface(s) carry their markers, 0 pending`. | Replace 24 with 27, or avoid hard-coding and point to the gate. |
| `.claude-memory/project-admin-dashboard.md:26` | Ground-truth path is `pages/admin`. | `test -e pages/admin` returned missing; `test -e pages/admin.js` returned exists; admin APIs are under `pages/api/admin/*`. | Use `pages/admin.js` for `/admin`, plus `pages/api/admin/*` for APIs. |
| `.claude-memory/project-api-credit-monitoring.md:22,46` | Latest numbered migration is `018`. | `find lib/db/migrations -name '[0-9][0-9][0-9]_*.sql' | sort | tail` and `lib/db/migrations-manifest.json` show the manifest now runs through `020_reviewer_find_roster.sql`. | Keep the `model_pricing_audit` setup-database note, but update the latest numbered migration to `020`. |
| `.claude-memory/project-awardee-onboarding.md:3,24,26,37,42-46,49` | Awardee onboarding is not built yet / design-only / placeholder. | `pages/workbench/[requestId].js:29,44,160-161` imports, tabs, and renders `AwardeeTab`; `shared/components/workbench/AwardeeTab.js` calls grantee-deliverables endpoints; `pages/api/workbench/grantee-deliverables/*.js` contains 8 route files. | Awardee/grantee-deliverables workflow is built; narrow remaining unknowns to GAL-trigger/status-field discovery or separate automation. |
| `.claude-memory/project-bill-honorarium-integration.md:3,27-30` | Current-cycle automated BILL onboarding deferral is enforced by `BILL_ONBOARDING_DEFERRED`; honorarium `akoya_request` row and mailing-address/phone capture still run. | `lib/bill/honorarium-onboard-orchestrator.js:46-54,109-126` defers before minting `akoya_request` when `HONORARIUM_ONBOARDING_DEFERRED` or discriminator GUIDs are absent; `lib/bill/onboard-reviewer-service.js:86-87` applies `BILL_ONBOARDING_DEFERRED` one step later. | Say current-cycle capture-only deferral is enforced by `HONORARIUM_ONBOARDING_DEFERRED` or unset discriminator GUIDs before honorarium request creation; `BILL_ONBOARDING_DEFERRED` gates later onboarding if the request exists. |
| `.claude-memory/project-bill-honorarium-integration.md:23` | Webhook event-dispatch is built. | `pages/api/webhooks/bill.js:16-20,126-144` says event-type dispatch and Dataverse PATCH are not in this slice; `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md:308-309` keeps 7a scaffold shipped and 7b pending. | Webhook scaffold/dedup/log shipped; event dispatch plus Dataverse PATCH remain pending. |
| `.claude-memory/project-bill-honorarium-integration.md:44` | Webhook handles `vendor.updated` and flips `wmkf_exisitngbillcomaccount`. | Same producer evidence: `pages/api/webhooks/bill.js` has no event-type dispatch or Dataverse PATCH yet. | Treat `vendor.updated` to "Recently Confirmed" as pending 7b work. |
| `.claude-memory/project-dev-environment.md:18,28` | Local dev expects `AUTH_REQUIRED=false`. | `rg -n "^(AUTH_REQUIRED|WAVE1_BACKEND_SETTINGS|WAVE1_BACKEND_APP_ACCESS|WAVE1_BACKEND_PREFS)=" .env.local` returned `AUTH_REQUIRED=true`. | Say local `.env.local` currently has auth enabled; do not tell agents to expect auth disabled. |
| `.claude-memory/project-dev-environment.md:20,30` | `.env.local` has all three `WAVE1_BACKEND_*` flags set to `dataverse`. | The same env grep returned no `WAVE1_BACKEND_SETTINGS`, `WAVE1_BACKEND_APP_ACCESS`, or `WAVE1_BACKEND_PREFS` lines. | Say the flags are absent locally and services default to Dataverse unless explicitly set to `postgres`. |
| `.claude-memory/project-dev-environment.md:20,30` | Missing Wave 1 flags fail loudly. | `lib/services/app-access-service.js:35-44`, `lib/services/settings-service.js:40-49`, and `lib/services/database-service.js:50-59` throw only when the flag equals `postgres`; absence does not throw. | Replace with: "`postgres` misconfiguration fails loudly; missing flags default to Dataverse." |
| `.claude-memory/project-dynamics-ai-writeback.md:84` | `DynamicsService.updateIfEmpty(...)` is still a future TODO. | `rg -n "updateIfEmpty\(" lib pages tests scripts` found `lib/services/dynamics-service.js:872`; the helper is defined at `lib/services/dynamics-service.js:872-912`. | Say the helper exists; any remaining TODO is production route adoption. |
| `.claude-memory/project-dynamics-sandbox-state.md:24` | Sandbox lacks `appgrantcycle`. | `rg -n "appgrantcycle\|wmkf_appgrantcycle"` shows the authoritative logical name is `wmkf_appgrantcycle` in `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md:1,21,24` and `scripts/audit-dataverse-state.js:180`; the same memory uses `wmkf_appgrantcycle` at line 33. | Change `appgrantcycle` to `wmkf_appgrantcycle`. |
| `.claude-memory/project-dynamics-sandbox-state.md:39` | Four Wave 1 services are `dataverse-{settings,identity-map,app-access,prefs}-service.js`. | `rg --files lib/services | rg 'dataverse-(settings|identity|app-access|prefs).*service\.js|identity-map'` returns `dataverse-identity-map.js`, not `dataverse-identity-map-service.js`. | Name `lib/services/dataverse-identity-map.js` separately. |
| `.claude-memory/project-external-reviewer-file-access.md:29` | Review uploads land under `Reviewer_Downloads/Reviews/`. | `lib/services/review-upload.js:189-191` builds `akoya_request/{requestFolder}/Reviewer_Uploads/{reviewerSubfolder}`. | Current upload path is `akoya_request/{requestFolder}/Reviewer_Uploads/{reviewerSubfolder}`. |
| `.claude-memory/project-grant-lifecycle-states-confirmed.md:43` | Exact line refs: `docs/atlas/dataverse-akoya-request.md:36` lists reviewer slots; `my-proposals.js:179` is reviewer slot display/count. | `docs/atlas/dataverse-akoya-request.md:40` lists `wmkf_potentialreviewer1..5`; `pages/api/reviewer-finder/my-proposals.js:143-147,180-181` contains selection and slot counts. | Update line refs to `docs/atlas/dataverse-akoya-request.md:40` and `pages/api/reviewer-finder/my-proposals.js:143-147,180-181`. |
| `.claude-memory/project-grantee-deliverable-email-voice.md:14,57` | `AwardeeTab` owns `DEFAULT_SUBJECT` / `DEFAULT_BODY`. | `rg -n "DEFAULT_SUBJECT|DEFAULT_BODY" shared/components/workbench/AwardeeTab.js` found no constants; current flow uses `pages/api/email-defaults/grantee-invite.js`, `lib/seed/email-defaults/grantee-invite.js`, and `AwardeeTab` template fill. | Replace with email-default settings/seed path: `email.grantee_invite.*`, `lib/seed/email-defaults/grantee-invite.js`, `pages/api/email-defaults/grantee-invite.js`, and `AwardeeTab` fill behavior. |
| `.claude-memory/project-reviewer-hold-step-decouple.md:41-42` | Accept branch sends no reviewer email today; acceptance confirmation is net-new. | `pages/api/external/review/[token]/respond.js:49,55-56,201-242,592-600` imports defaults/calendar and sends acceptance confirmation on fresh accept; `lib/external/calendar-invite.js:129-130` names `keck-review-due.ics`. | Mark acceptance confirmation email plus review-due `.ics` as shipped. |
| `.claude-memory/project-reviewer-hold-step-decouple.md:52-56` | Remove button does not clear accepted/response/review flags; must be enhanced. | `pages/api/reviewer-finder/my-candidates.js:576` calls `suggestionAdapter.softDelete(...)`; `lib/dataverse/adapters/reviewer-suggestion.js:924-947` clears selected, accepted, declined, response type, review status, held-at, and optionally revokes token. | Mark accepted-state reset on removal as shipped. |

## Needs-Probe Register

These claims are plausibly important but depend on live Dataverse, Postgres, Vercel, Azure, provider, BILL, or external-service state.

| File | Claim cluster | Probe needed |
|---|---|---|
| `.claude-memory/MEMORY.md`; `.claude-memory/feedback-deployment-monitoring-use-inspect.md` | Current Vercel deploy monitoring behavior, `vercel inspect` output, deploy timing, sensitive env readback behavior, branded domain runtime, and sandbox build failure signature. | Inspect a real deployment URL, Vercel env behavior, runtime `/api/health`, authenticated write probe, and a current Codex sandbox build. |
| `.claude-memory/akoya-payment-field-semantics.md` | Live payment field semantics and population counts for `akoya_request` / `akoya_requestpayment`. | Dataverse query over request/payment rows and payment fields. |
| `.claude-memory/akoya-request-honorarium-nomenclature.md` | Current honorarium linkage examples, discriminator populations, and reviewer-honorarium counts. | Live Dataverse probe for named request numbers and honorarium cohort counts. |
| `.claude-memory/akoya-temporal-axis-encodings.md` | `wmkf_meetingdate` / `akoya_fiscalyear` live population and discretionary coverage. | Rerun `scripts/probe-akoya-meetingdate-by-type.js`. |
| `.claude-memory/dataverse-export-floor-scoping.md` | Program/person-role, SoCal contact divergence, donor target/population, and field-floor claims. | Rerun the cited `scripts/probe-akoya-*` scripts plus donor/entity-shape probe. |
| `.claude-memory/feedback-human-legibility-schema-principle.md` | Live no-`wmkf_proposalcostshare` schema and `wmkf_proposalbudgetline.wmkf_category` cost-share options. | Dataverse metadata query for both entity and picklist. |
| `.claude-memory/feedback-no-fabricated-placeholder-values.md` | `OPENALEX_POLITE_MAILTO=alerts@wmkeck.org` in Vercel. | Vercel environment probe. |
| `.claude-memory/feedback-profile-context-runtime-bugs.md` | Azure localhost redirect absence and local auth-bypass `PATCH /api/user-profiles` behavior. | Azure redirect URI inspection and local dev smoke with `AUTH_REQUIRED=false`. |
| `.claude-memory/project-admin-dashboard.md` | Justin `id=2` superuser role. | Live Postgres role/profile query. |
| `.claude-memory/project-akoya-request-pd-fields.md` | Dataverse PD/secondary PD/coordinator/meeting-date fields and request `1002379`. | Dataverse metadata plus request GET. |
| `.claude-memory/project-api-credit-monitoring.md` | Anthropic auto-reload/org/spend-limit state and historical usage reconciliation rows. | Anthropic console/admin probe plus Vercel env and Postgres `api_usage_log` query. |
| `.claude-memory/project-app-access-control.md` | Live Dataverse app access grants/table state. | Dataverse metadata/query probe for `wmkf_appuserappaccesses`. |
| `.claude-memory/project-applicant-exclusion-policy-pending.md` | Request `1002852` exclusion and reviewer-yield specifics. | Dataverse request plus reviewer-finder session/results probe. |
| `.claude-memory/project-appresearcher-collapse-post-pilot.md` | Sidecar/publication entity 404s, folded field counts, and publication entity deployment/empty status. | Dataverse `EntityDefinitions` and `wmkf_potentialreviewers` metadata/count probes. |
| `.claude-memory/project-awardee-onboarding.md` | GAL-sent status field/value. | Dataverse plus Power Automate/status-history probe. |
| `.claude-memory/project-backend-automation.md` | v3 AI fields and `wmkf_ai_run` child table deployed. | Dataverse metadata probe. |
| `.claude-memory/project-bill-com-integration-tests-known-red.md` | Known-red BILL suites fire nightly on Vercel. | Vercel CI/nightly run inspection. |
| `.claude-memory/project-bill-honorarium-integration.md` | BILL/HONORARIUM production deferral env posture and sandbox readiness. | Vercel env/runtime probe plus external BILL/Ops status. |
| `.claude-memory/project-branded-domains.md` | Domain/env/deployment health, Azure redirect, smoke rows/uploads, and legacy-host behavior. | Vercel/Azure/runtime/browser/API probes. |
| `.claude-memory/project-closed-work-archive.md` | Live Wave 1/Wave 6 table drops, Blob backup existence, delegate role, impersonation smoke, and external reviewer file access. | Postgres schema, Blob listing, Dataverse role, and live smoke probes. |
| `.claude-memory/project-cloudmersive-advanced-endpoint.md` | Live Cloudmersive basic/advanced/EICAR/executable behavior. | External Cloudmersive API smoke with known fixtures. |
| `.claude-memory/project-codex-recurring-review.md` | Broker-driven `codex:codex-rescue` current availability. | Broker/tool availability probe. |
| `.claude-memory/project-contact-promotion-permission.md` | Live create/append/delete contact permissions and cleanup behavior. | Dataverse permission/test-send probe. |
| `.claude-memory/project-d26-reviewer-inputs-probe.md` | D26 reviewer input counts, excluded-text counts, and status distribution. | Rerun `scripts/probe-d26-reviewer-inputs.js`. |
| `.claude-memory/project-dataverse-creator-privileges.md` | Current creator privileges and listed entity/field/choice deployment. | Dataverse permission and metadata probes. |
| `.claude-memory/project-dataverse-power-tools.md` | Live request counts, era/status/program/test-row semantics, report counts, audit/change-history privilege facts, and private Blob export access. | Rerun cited Dataverse probes and smoke `/api/dataverse-export/*`. |
| `.claude-memory/project-dataverse-schema-deploy-gotchas.md` | 429 timing, Web API error shapes, wave2 duplicate hazard, typed-cast `$select` behavior. | Prod dry-run and minimal live OData probes. |
| `.claude-memory/project-download-proxy-parked.md` | Cycle-material proxy promotion and production flag posture. | Vercel env/deployment config plus authenticated cycle-material curl. |
| `.claude-memory/project-dynamics-ai-writeback.md` | Live privileges, AI fields/Choice values, SharePoint write grant, duplicate cruft field, memo caps, and field sets. | Run `scripts/inspect-ai-fields.js`, `scripts/test-dynamics-write.js`, `scripts/test-dynamics-email.js --send`, and `scripts/probe-sharepoint-write.js`. |
| `.claude-memory/project-dynamics-as-prompt-ground-truth.md` | `wmkf_ai_prompt` as current Dataverse prompt ground truth. | Query live `wmkf_ai_prompt` rows/current prompt state. |
| `.claude-memory/project-dynamics-crm-limitations.md` | `$skip`, `$count`, and `_formatted` `$select` Dataverse behavior. | Minimal live OData requests. |
| `.claude-memory/project-dynamics-crm-users.md` | Licensed staff/service-account counts. | Query live `systemuser`/license metadata. |
| `.claude-memory/project-dynamics-email.md` | Email sending and tracking-token behavior. | Run `scripts/test-dynamics-email.js --send` and inspect CRM sync/org setting. |
| `.claude-memory/project-dynamics-explorer-archive-libs.md` | Specific SharePoint file counts and direct download curl behavior. | Dynamics Explorer list/download probes. |
| `.claude-memory/project-dynamics-explorer-details.md` | Search API/index size/search expansion and `wmkf_abstract` live field. | Probe `/api/search/v1.0/query` and schema metadata. |
| `.claude-memory/project-dynamics-explorer-reuse-power-tools.md` | Prod telemetry counts, restrictions, count values, and soak data. | Run `scripts/analyze-dynamics-explorer-failures.js` and targeted live count probes. |
| `.claude-memory/project-dynamics-explorer-schema-diff.md` | Current Dataverse schema gaps. | Run `node scripts/dynamics-schema-diff.js [table]` live. |
| `.claude-memory/project-dynamics-explorer-serializer-deferred.md` | Staff CRM access premise and usage/cost watch items. | Confirm Dataverse role/access model and inspect recent tool-result sizes. |
| `.claude-memory/project-dynamics-feedback-admin-shipped.md` | Live `dynamics_feedback` retention/run state. | Query Postgres table/migrations and latest maintenance runs. |
| `.claude-memory/project-dynamics-identity-reconciliation.md` | Prod migration, seven linked profiles, maintenance cron, delegate role, impersonation smoke, and Vercel flag state. | Query Postgres, Dataverse app-user roles, and Vercel env. |
| `.claude-memory/project-dynamics-sandbox-state.md` | Sandbox reachability, sandbox schema/counts/email capability, and prod request allowlist. | `scripts/discover-dynamics-envs.js`, sandbox Dataverse metadata/count probes, and safe SendEmail test only if approved. |
| `.claude-memory/project-excluded-reviewers-often-in-pool.md` | Applicant-excluded names often already in `wmkf_potentialreviewers`. | Parse recent exclusion text and search normalized names/emails in Dataverse. |
| `.claude-memory/project-external-reviewer-file-access.md` | SharePoint write plus Dataverse writeback verified end-to-end. | Safe upload through review-manager/token path, then confirm SharePoint item and Dataverse fields. |
| `.claude-memory/project-grant-lifecycle-states-confirmed.md` | Current lifecycle value distribution, request status metadata, D26 picker counts, and slot correlation. | Dataverse metadata and request distribution query. |
| `.claude-memory/project-grantee-deliverable-email-voice.md` | Actual send-from PD mailbox behavior. | Safe grantee invite/reminder send or dry-run and inspect Graph/CRM metadata. |
| `.claude-memory/project-institution-foundation-liaison.md` | Primary contact/project leader/research leader semantics and fill rates. | Rerun focused Dataverse probes behind the cited evidence files. |
| `.claude-memory/project-intake-portal-external-id-foundation.md` | Tenant/user-flow/app-registration facts and `/apply` auth round-trip. | Browser smoke with External ID test user and Azure portal verification. |
| `.claude-memory/project-intake-portal-institution-match.md` | Dataverse Search API enabled and accounts name/AKA search behavior. | Dataverse Search API query and account metadata probe. |
| `.claude-memory/project-intake-portal-pilot-decisions-2026-05-06.md`; `.claude-memory/project-intake-portal-pilot-decisions-2026-05-13.md` | Deployed S178 shape and PA flow behavior on `Phase II Pending`. | Dataverse metadata probe plus Power Automate dry-run/status-flip smoke. |
| `.claude-memory/project-intake-portal-reviewer-capture.md` | Applicant-disposition picklist and ORCID back-prop behavior. | Dataverse picklist probe plus safe reviewer enrichment/back-prop smoke. |
| `.claude-memory/project-intake-portal-skinny-scope.md` | Reviewer pipeline kickoff on `Phase II Pending`. | Safe throwaway request status-flip dry-run. |
| `.claude-memory/project-intake-portal-ui-todo.md` | Azure user-flow attribute collection and federated logout. | Azure portal inspection plus browser smoke. |
| `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md` | Deployed `/apply` EICAR integration and Cloudmersive `/advanced` behavior. | EICAR fixture upload smoke in safe deployed env. |
| `.claude-memory/project-interim-report-automation.md` | Dynamics/SharePoint write access and interim-evaluation field existence. | Dataverse metadata plus safe SharePoint write/read smoke. |
| `.claude-memory/project-irs-exempt-verification.md` | Live row count, `maintenance_runs` IRS history, Vercel cron, and production traffic. | Postgres `irs_exempt_orgs`/`maintenance_runs` queries and Vercel logs/analytics. |

## Coverage Table

| File | VERIFIED | STALE | UNVERIFIABLE | NEEDS-PROBE |
|---|---:|---:|---:|---:|
| `.claude-memory/MEMORY.md` | 20 | 0 | 0 | 4 |
| `.claude-memory/akoya-payment-field-semantics.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/akoya-request-honorarium-nomenclature.md` | 0 | 2 | 0 | 1 |
| `.claude-memory/akoya-temporal-axis-encodings.md` | 6 | 0 | 0 | 1 |
| `.claude-memory/claude-config-git-sync.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/dataverse-export-floor-scoping.md` | 5 | 0 | 0 | 1 |
| `.claude-memory/decision-module-typeless-warning-accept.md` | 8 | 1 | 0 | 0 |
| `.claude-memory/env-broken-git-autogc.md` | 2 | 2 | 0 | 0 |
| `.claude-memory/feedback-apply-reconcile-to-fix-work.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-behavior-claims-cite-the-producer.md` | 1 | 1 | 0 | 0 |
| `.claude-memory/feedback-check-memory-before-asking-user.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/feedback-cite-ground-truth.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/feedback-codex-build-gate-turbopack-sandbox.md` | 1 | 0 | 0 | 1 |
| `.claude-memory/feedback-commit-before-delegating-to-worktree-agent.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-concepts-vs-phase-i.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-cycle-vs-executor-scope.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-deployment-monitoring-use-inspect.md` | 0 | 0 | 0 | 1 |
| `.claude-memory/feedback-dont-resurface-parked-items.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/feedback-drive-to-completion.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-falsify-not-confirm.md` | 9 | 0 | 0 | 0 |
| `.claude-memory/feedback-green-requires-full-test-suite.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-grep-general-codebase-terms.md` | 9 | 0 | 0 | 0 |
| `.claude-memory/feedback-human-legibility-schema-principle.md` | 4 | 0 | 0 | 1 |
| `.claude-memory/feedback-idempotency-name-the-mechanism.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-list-and-confirm-before-bulk-deletes.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-manual-affiliation-edit-no-coi-recheck.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-no-fabricated-placeholder-values.md` | 0 | 0 | 0 | 1 |
| `.claude-memory/feedback-no-performative-contrition.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-no-time-pressure-commentary.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-prioritize-contact-recall-over-identity-precision.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-profile-context-runtime-bugs.md` | 6 | 0 | 0 | 2 |
| `.claude-memory/feedback-real-fix-not-design-note.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-reconcile-dont-append-docs.md` | 14 | 1 | 0 | 0 |
| `.claude-memory/feedback-red-gates-are-p0.md` | 11 | 0 | 0 | 0 |
| `.claude-memory/feedback-rename-code-not-just-docs.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-review-panel-tone.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-scrutinize-exemptions-and-fallthrough.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/feedback-self-review-before-delegating-review.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/feedback-share-codex-verbatim.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/feedback-stakeholder-email-tone.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-surface-full-review-findings.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-symbol-consumer-fanout.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-thoroughness-default.md` | 4 | 0 | 0 | 0 |
| `.claude-memory/feedback-timebox-metawork.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/feedback-truncation-is-breakage-not-completion.md` | 9 | 0 | 0 | 0 |
| `.claude-memory/feedback-verify-before-destructive-carryover.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/feedback-verify-branch-before-git-action.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/feedback-verify-external-platform-claims.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/local-jest-build-environment.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/memory-store-propagation.md` | 8 | 0 | 0 | 0 |
| `.claude-memory/project-a7-prompt-injection-hardening.md` | 15 | 1 | 0 | 0 |
| `.claude-memory/project-admin-dashboard.md` | 0 | 1 | 0 | 1 |
| `.claude-memory/project-akoya-request-pd-fields.md` | 1 | 0 | 0 | 1 |
| `.claude-memory/project-api-credit-monitoring.md` | 9 | 1 | 0 | 3 |
| `.claude-memory/project-app-access-control.md` | 9 | 0 | 0 | 1 |
| `.claude-memory/project-app-roadmap-2026-04-25.md` | 5 | 0 | 0 | 0 |
| `.claude-memory/project-applicant-exclusion-policy-pending.md` | 0 | 0 | 0 | 1 |
| `.claude-memory/project-appresearcher-collapse-post-pilot.md` | 9 | 0 | 0 | 3 |
| `.claude-memory/project-awardee-onboarding.md` | 2 | 1 | 0 | 1 |
| `.claude-memory/project-backend-automation.md` | 1 | 0 | 0 | 1 |
| `.claude-memory/project-bill-com-integration-tests-known-red.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/project-bill-honorarium-integration.md` | 15 | 3 | 0 | 2 |
| `.claude-memory/project-branded-domains.md` | 3 | 0 | 0 | 4 |
| `.claude-memory/project-claude-instruction-architecture.md` | 19 | 0 | 0 | 0 |
| `.claude-memory/project-closed-work-archive.md` | 4 | 0 | 0 | 3 |
| `.claude-memory/project-cloudmersive-advanced-endpoint.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/project-codex-design-pre-impl-iteration.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-codex-recurring-review.md` | 8 | 0 | 0 | 1 |
| `.claude-memory/project-commit-directly-to-main.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-contact-promotion-permission.md` | 7 | 0 | 0 | 2 |
| `.claude-memory/project-d26-reviewer-inputs-probe.md` | 5 | 0 | 0 | 4 |
| `.claude-memory/project-dataverse-creator-privileges.md` | 3 | 0 | 0 | 2 |
| `.claude-memory/project-dataverse-odata-null-filter.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/project-dataverse-power-tools.md` | 18 | 0 | 0 | 2 |
| `.claude-memory/project-dataverse-schema-deploy-gotchas.md` | 12 | 0 | 0 | 1 |
| `.claude-memory/project-deferred-code-cleanup.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-dev-environment.md` | 1 | 3 | 0 | 0 |
| `.claude-memory/project-download-proxy-parked.md` | 4 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-ai-writeback.md` | 15 | 1 | 0 | 1 |
| `.claude-memory/project-dynamics-as-prompt-ground-truth.md` | 3 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-crm-limitations.md` | 0 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-crm-users.md` | 0 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-email.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-explorer-archive-libs.md` | 7 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-explorer-details.md` | 3 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-explorer-reuse-power-tools.md` | 20 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-explorer-schema-diff.md` | 9 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-explorer-serializer-deferred.md` | 9 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-feedback-admin-shipped.md` | 7 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-identity-reconciliation.md` | 15 | 0 | 0 | 1 |
| `.claude-memory/project-dynamics-sandbox-state.md` | 4 | 2 | 0 | 1 |
| `.claude-memory/project-e2e-playwright-harness.md` | 7 | 0 | 0 | 0 |
| `.claude-memory/project-excluded-reviewers-often-in-pool.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/project-external-reviewer-file-access.md` | 4 | 1 | 0 | 1 |
| `.claude-memory/project-grant-lifecycle-states-confirmed.md` | 5 | 1 | 0 | 1 |
| `.claude-memory/project-grant-phasing-evolution.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-grantee-deliverable-email-voice.md` | 0 | 1 | 0 | 1 |
| `.claude-memory/project-institution-foundation-liaison.md` | 4 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-external-id-foundation.md` | 6 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-institution-match.md` | 0 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-pilot-decisions-2026-05-06.md` | 12 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-pilot-decisions-2026-05-13.md` | 6 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-reviewer-capture.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-skinny-scope.md` | 2 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-ui-todo.md` | 5 | 0 | 0 | 1 |
| `.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md` | 8 | 0 | 0 | 1 |
| `.claude-memory/project-interim-report-automation.md` | 6 | 0 | 0 | 1 |
| `.claude-memory/project-irs-exempt-verification.md` | 14 | 0 | 0 | 1 |
| `.claude-memory/project-j27-doc-capture-evolution.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-living-taxonomy-principle.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-machine-legible-form-capture.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-memory-router-trap-prevention.md` | 7 | 0 | 0 | 0 |
| `.claude-memory/project-new-ai-capabilities.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-no-banking-pii-in-dataverse.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-openalex-merge-use-orcid-works.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-pdf-processing-tiers.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-phase-i-summary-app-winddown.md` | 7 | 0 | 0 | 0 |
| `.claude-memory/project-phaseistatus-decision-lifecycle.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-prompt-governance.md` | 4 | 0 | 0 | 0 |
| `.claude-memory/project-prompt-storage-strategy.md` | 13 | 0 | 0 | 0 |
| `.claude-memory/project-proposal-context-extraction.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-accept-decline-links.md` | 12 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-accept-prod-automation.md` | 5 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-address-collection-provisional.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | 21 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-coi-concern-surfacing.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-coi-rely-on-self-disclosure.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-contact-enrichment-anchoring.md` | 7 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-count-invariant.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-field-aware-verification.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-find-roster.md` | 8 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-finder-dataverse-entry-path.md` | 10 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-finder-next-topics.md` | 5 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-finder-proposal-doc-context.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-finder-retrieval-redesign.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-history-data-quality.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-hold-step-decouple.md` | 8 | 2 | 0 | 0 |
| `.claude-memory/project-reviewer-identity-resolution-phase1.md` | 14 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-identity-resolution.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-institution-match.md` | 5 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-lifecycle-automation.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-lifecycle.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-origination-experiment-result.md` | 4 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-origination-multilane.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-pi-identity-structured.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-postgres-to-dataverse-migration.md` | 15 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-prompt-dataverse-migration.md` | 7 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-ranking-recency-over-citations.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-recall-over-precision.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-referral-capture.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-self-report-orcid-sticky-confirmed.md` | 11 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-verify-fail-dangerous.md` | 4 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-web-discovery-abandoned.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-reviewer-workbench-invite-workflow.md` | 9 | 0 | 0 | 0 |
| `.claude-memory/project-rtk-grep-output-corruption.md` | 4 | 0 | 0 | 0 |
| `.claude-memory/project-serpapi-budget-latency.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-serpapi-capability-erosion.md` | 3 | 0 | 0 | 0 |
| `.claude-memory/project-sharepoint-integration.md` | 11 | 0 | 0 | 0 |
| `.claude-memory/project-slice0-role-probe.md` | 8 | 0 | 0 | 0 |
| `.claude-memory/project-slice0-scope.md` | 11 | 0 | 0 | 0 |
| `.claude-memory/project-slice0-timeline-posture.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-staged-review-pipeline.md` | 6 | 0 | 0 | 0 |
| `.claude-memory/project-strategy-direction.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-system-model.md` | 8 | 0 | 0 | 0 |
| `.claude-memory/project-vercel-cli-deploy-preview-auth.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/project-vercel-sensitive-env-pull-empty.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/project-virtual-review-panel.md` | 15 | 0 | 0 | 0 |
| `.claude-memory/project-virus-scanning-it-context.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/project-w6-table-drop-closed.md` | 13 | 0 | 0 | 0 |
| `.claude-memory/project-wave1-onboarding.md` | 7 | 0 | 0 | 0 |
| `.claude-memory/project-wave1-closeout-role-tail.md` | 8 | 0 | 0 | 0 |
| `.claude-memory/project-workbench-consolidation-rollout.md` | 2 | 0 | 0 | 0 |
| `.claude-memory/reference-dataverse-audit-trail-actor-detection.md` | 1 | 0 | 0 | 0 |
| `.claude-memory/reference-vercel-sensitive-env-unreadable.md` | 0 | 0 | 0 | 0 |
| `.claude-memory/reviewer-identity-fragmentation.md` | 10 | 0 | 0 | 0 |
| `.claude-memory/slice0-deactivate-not-delete-recalc.md` | 4 | 0 | 0 | 0 |
| `.claude-memory/user-powerautomate.md` | 0 | 0 | 0 | 0 |
| `docs/agent-wiki/index.md` | 31 | 0 | 0 | 0 |
| `docs/agent-wiki/log.md` | 7 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/dataverse-dynamics.md` | 40 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/dev-environment.md` | 23 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/external-reviewer-portal.md` | 41 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/finance-honoraria.md` | 19 | 0 | 0 | 1 |
| `docs/agent-wiki/topics/intake-portal.md` | 32 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/integrity-screener.md` | 18 | 0 | 0 | 1 |
| `docs/agent-wiki/topics/prompt-executor.md` | 19 | 1 | 0 | 0 |
| `docs/agent-wiki/topics/reviewer-identity.md` | 54 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/reviewer-origination.md` | 47 | 0 | 0 | 0 |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | 51 | 0 | 0 | 1 |
| `docs/agent-wiki/topics/security-auth.md` | 30 | 0 | 0 | 1 |
| `docs/agent-wiki/topics/strategy-roadmap.md` | 29 | 0 | 0 | 0 |
