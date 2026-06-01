# Document Processing Multi-App System

> **Agent-instruction file note.** This `CLAUDE.md` is the single canonical agent-instruction surface. `AGENTS.md` at repo root is a tracked **symlink to `CLAUDE.md`** so AGENTS.md-aware agents (Codex, etc.) load identical, current content with no second drift surface. Do **not** run the `migrate-to-codex` skill against this repo — it severs the symlink and writes a corrupted `s/Claude/Codex/` copy (false stack, unsafe `VRP_ALLOWED_PROVIDERS`). If `AGENTS.md` ever appears as a regular file in `git status`, it was clobbered: `git checkout AGENTS.md` to restore the symlink. Background: `docs/DOCS_GROUND_TRUTH_AUDIT_2026-05-19.md`.

## Git Commit Policy

**Commit working changes regularly.** This provides rollback points when debugging.

- Commit after completing a feature or fix that works
- Use descriptive commit messages
- Don't let multiple sessions accumulate without commits

## Carryover Hygiene

**Verify destructive carryover items before acting on them.** Any task carried over from a prior session that says **drop**, **remove**, **retire**, **archive**, **delete**, or **deprecate** infrastructure (table, column, endpoint, env var, file, dispatch wrapper, dependency, feature flag) must be grep-verified against live state first. Carryover lists in `SESSION_PROMPT.md`, memory, or user prompts go stale — a belief from a prior session can propagate forward through several handoffs without re-verification.

Quick pre-flight: grep for live callers, read the most likely ones to confirm they're not load-bearing. If anything looks live, **stop and report back** — don't proceed because the carryover said to. After a successful verification, update the originating memory entry so the wrong belief doesn't keep propagating.

This rule does NOT apply to additive work (new features, endpoints, tables) — only destructive work.

## Ground-truth requirement

**Probe live state before drafting plans.** Session 136 produced three rounds of plan corrections because state claims weren't being verified. Self-correction rules live in **`docs/CLAUDE_REMEDIATION_PLAN.md`** (read this before starting any migration / integration / data-layer work):

1. **Probe-before-plan** — every state claim labeled `[VERIFIED via X]` or `[ASSUMED — needs verification]`
2. **Memory hygiene** — read full memory entries that match the work, not just the index
3. **Adjacent-context survey** — when citing a file, `ls` its parent; when citing a doc, `ls docs/`; before claiming "X has no Y", grep for Y
4. **Active doubt on state claims** — "the convention is X" / "the design landed at Y" need three independent sources before stating

The **Application State Atlas** at `docs/APPLICATION_STATE_ATLAS.md` (with per-entity pages in `docs/atlas/`) is the canonical reference for live-state lookups. Read the relevant per-entity page before any plan claim about that entity's schema, source-of-truth, read paths, or write paths. Re-run the probe scripts (`scripts/audit-postgres-state.js`, `scripts/audit-dataverse-state.js`) if a page hasn't been touched in 60+ days and you're planning destructive work.

### CI gates

**P0 gates** (red blocks commits to the affected surface):
- `npm run check:atlas` — Postgres tables + Dataverse entity sets referenced in source must be in some Atlas page; gates `pages/api/**`, `lib/dataverse/**`, `lib/db/**`, `lib/services/{dynamics,database,execute-prompt}*`, `scripts/audit-*`, `docs/atlas/**`, `docs/APPLICATION_STATE_ATLAS.md`.
- `npm run check:atlas:self-test` — exercises every Atlas detection pattern against synthetic fixtures. Same gating scope as `:atlas`.
- `npm run check:api-routes` — API route security matrix coverage; gates `pages/api/**`.
- `npm run lint` — ESLint flat config (`eslint.config.mjs`, `eslint-config-next/core-web-vitals`); repo-wide. Blocks on **errors only** (warnings don't fail exit), so the calibrated warn-level rules (React-Compiler-eligibility, exhaustive-deps) surface without gating. `next lint` was removed in Next 16; this is its replacement. `npm run lint:fix` auto-fixes. Wired into `.github/workflows/test.yml`.

**Drift gates** (also fail-loud, lower scope):
- `:fact-consistency` — registered scalar drift across docs/memory; **run before any fact-level doc/memory fix is marked "done."**
- `:drain-table-mentions` — stale "data lives in PG" claims for the reviewer-domain drain tables.
- `:prompt-storage-mentions` — stale `wmkf_prompt_template` references (the entity is `wmkf_ai_prompt` / set `wmkf_ai_prompts`). <!-- prompt-storage:ignore reason=self-referential-gate-description -->

- `:canonical-pointers` — anchor rot in `[N](docs/CANONICAL_COUNTS.md#<fact-id>)` pointers.
- `:memory-drift` (advisory) — memory↔code drift.

**Operating rules** (full mechanics, exemption keyword lists, detection-shape catalogs, and the "lesson → fixture → fix → atlas page" 4-step commit order live in `docs/CI_GATES_REFERENCE.md`):
- Red on `main` is a rubric violation **right now**, regardless of which session caused it. "Not my regression" is not a valid reason. Established 2026-05-08 after a two-session gap let an Atlas miss propagate.
- The fix is always to make the gate green. Adding to `ALLOWED_UNDOCUMENTED_*` requires written justification — last resort, not default.
- Always run a gate and its self-test **sequentially, never in parallel** (the self-tests write synthetic fixtures into paths the main gate scans).
- Self-correction protocol when external review catches a missed structural pattern: update lessons doc → add self-test fixture → patch gate → commit all together.

---

## Project Overview

A multi-application document processing system using Claude AI for grant-related workflows. Built with Next.js and deployed on Vercel.

## Directory Structure

```
/
├── proxy.js                    # Server-side auth gate (Next 16 proxy convention, withAuth/jose)
├── instrumentation.js          # Next register() cold-start hook — EMERGENCY_AUTH_BYPASS monitor
├── pages/                     # Next.js pages and API routes
│   ├── api/                   # API endpoints
│   └── *.js                   # Frontend pages
├── shared/                    # Shared components and utilities
│   ├── components/            # React components
│   ├── config/prompts/        # Prompt templates
│   └── utils/                 # Utility functions
├── lib/                       # Core libraries
│   ├── services/              # Service classes
│   ├── db/                    # Database schema and migrations
│   └── utils/                 # Utility functions
├── scripts/                   # Setup and utility scripts
├── docs/                      # Extended documentation
├── styles/                    # Global styles
└── tests/                     # Test files
```

## Applications

| App | Page | API Endpoint | Description |
|-----|------|--------------|-------------|
| Multi-Perspective Evaluator | `multi-perspective-evaluator.js` | `/api/evaluate-multi-perspective` | 3-perspective evaluation with synthesis |
| Batch Phase I Summaries | `batch-phase-i-summaries.js` | `/api/process-phase-i` | Batch Phase I proposal processing |
| Batch Phase II Summaries | `batch-proposal-summaries.js` | `/api/process` | Batch Phase II proposal processing |
| Funding Analysis | `funding-gap-analyzer.js` | `/api/analyze-funding-gap` | NSF API integration for federal funding |
| Phase I Writeup | `phase-i-writeup.js` | `/api/process-phase-i-writeup` | Single Phase I writeup |
| Phase II Writeup | `phase-ii-writeup.js` | `/api/process` | Single Phase II writeup with Q&A |
| Reviewer Finder | `reviewer-finder.js` | `/api/reviewer-finder/*` | AI + database search for expert reviewers |
| Review Manager | `review-manager.js` | `/api/review-manager/*` | Post-acceptance review lifecycle management |
| Peer Review Summarizer | `peer-review-summarizer.js` | `/api/process-peer-reviews` | Analyze peer reviews |
| Expense Reporter | `expense-reporter.js` | `/api/process-expenses` | Receipt/invoice processing |
| Literature Analyzer | `literature-analyzer.js` | `/api/analyze-literature` | Research paper synthesis |
| Integrity Screener | `integrity-screener.js` | `/api/integrity-screener/*` | Screen applicants for research integrity |
| Dynamics Explorer | `dynamics-explorer.js` | `/api/dynamics-explorer/*` | Natural language CRM queries via agentic tool-use |
| Expertise Finder | `expertise-finder.js` | `/api/expertise-finder/*` | Match proposals to internal staff, consultants, and board members |
| Grant Reporting | `grant-reporting.js` | `/api/grant-reporting/*` | Interactive grant final report extraction with Dynamics auto-fill, goals assessment vs. original proposal, and Word export |
| Virtual Review Panel | `virtual-review-panel.js` | `/api/virtual-review-panel` | Multi-LLM proposal review with claim verification, structured review, and synthesis. Admin-assigned; not in default grants. See `docs/VIRTUAL_REVIEW_PANEL.md`. |
| Phase I Dynamics (Test) | `phase-i-dynamics.js` | `/api/phase-i-dynamics/summarize` | Direct-URL Phase I summarization/writeback test surface gated by `batch-phase-i-summaries`; v2 uses the Executor contract. See `docs/EXECUTOR_CONTRACT.md`. |
| Dataverse Bulk Export | `dataverse-bulk-export.js` | `/api/dataverse-export/{metadata,preview,run,download}` | Admin-assigned structured Dataverse export builder with preview-confirm-run-download flow. See `docs/DATAVERSE_POWER_TOOLS_TRACK_B_BUILD_PLAN.md` and `docs/guides/DATAVERSE_BULK_EXPORT.md`. |
| Request Workbench (Reviewers) | `workbench.js` + `workbench/[requestId].js` | `/api/workbench/{dashboard,resolve-request,applicant-reviewers,enrich-recommended}` | App key `reviewers`. Tier-2 cycle dashboard → tier-3 per-request shell; consolidating Reviewer Finder + Review Manager. Phases: S208 Phase 0 (grant + `wmkf_applicantdisposition`) + Phase 1 (dashboard + D26 allowlist); **S209 Phase 2** — Reviewers tab Manage panels (Invite/Track/Completed via shared `ReviewerManagePanel.js` + `ReviewersTab.js`; pure logic in `reviewer-modes.js`); **S210 Phase 3** — Find tab LIVE: applicant-reviewer ingestion (`/api/workbench/applicant-reviewers` → `disposition=recommended` rows + parsed excluded soft-block) + auto-loaded proposal + **in-panel reviewer search** (`ReviewerFindPanel.js` + `ReviewerSearchSection.js`: inline analyze→discover→enrich→save reusing the reviewer-finder endpoints); **S211** brought that search to full parity with the standalone Finder (source/count/diversity/notes inputs, rich COI/mismatch cards in Claude/Database/Unverified sections, all enrichment tiers on-by-default with real h-index/citations via the `google_scholar_author` engine, and a `rankByRelevance` field-name fix shared with the standalone), and added an **"Enrich recommended reviewers"** action (`/api/workbench/enrich-recommended`) that runs the applicant-recommended reviewers through the same verify→COI→enrich pipeline and writes metrics/COI back to their rows. **S211 also:** a Scholar-disambiguation fix (institution-aware lookup + keep-biased mismatch guard so enrichment stops matching the wrong same-named person) and a new **Candidates** sub-tab (`CandidatesPanel.js` — the saved-candidate roster from `my-candidates`) with **real invitation send** (`InviteEmailModal.js` → `render-emails`/`send-emails` `templateType:'invitation'`: Dynamics email + accept/decline magic link, sets `invited`, duplicate-send-guarded; accepted reviewers then flow into the Invite tab). Additive `reviewers` grant; the 18 reviewer-finder/review-manager routes accept it via variadic `requireAppAccess`. Not in default grants. See `docs/REQUEST_WORKBENCH_BUILD_PLAN.md`. |

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS 3.4
- **Backend**: Next.js API Routes
- **Authentication**: NextAuth.js with Azure AD + server-side middleware gate (see `docs/AUTHENTICATION_SETUP.md`)
- **AI**: Claude API (Anthropic)
- **Database**: Vercel Postgres
- **File Storage**: Vercel Blob
- **Deployment**: Vercel

## Environment Variables

Full list, defaults, rotation cadence, and diagnostics: **`docs/CREDENTIALS_RUNBOOK.md`**.

Required for any deployment:
- `CLAUDE_API_KEY`
- `POSTGRES_URL` (auto-set by Vercel Postgres)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`
- `AUTH_REQUIRED` (kill switch; production fails closed unless `EMERGENCY_AUTH_BYPASS=true`)

Required for production-only paths:
- `CRON_SECRET` — `/api/cron/*` authentication
- `EXTERNAL_LINK_SECRET` — 32+ char HMAC for external-reviewer JWTs (separate from `NEXTAUTH_SECRET`)
- `IRS_VERIFY_SECRET` — shared secret for `/api/irs/verify-ein` (PowerAutomate caller; separate from `CRON_SECRET`)
- `VRP_ALLOWED_PROVIDERS` — Virtual Review Panel allowlist (intersects with configured API keys; production fails closed if unset; must include `claude`)
- `EXTERNAL_AZURE_AD_*` (tenant/client/secret) — applicant intake portal; provider only registers when all three are set, so staff-only deployments don't need them
- `DVX_BLOB_RW_TOKEN` — Dataverse Bulk Export's dedicated PRIVATE Blob store (`dvx-export-private`). Must NOT be conflated with the shared `BLOB_READ_WRITE_TOKEN`. Provisioning + sender contract in `docs/CREDENTIALS_RUNBOOK.md` § "Private Blob store provisioning".
- `INTAKE_BLOB_RW_TOKEN` — Applicant intake drain's dedicated PRIVATE Blob store (`intake-applicant-private`). Same separation + provisioning shape as DVX; see same runbook section. Three-call attach dance in `docs/INTAKE_PORTAL_DRAIN_PLAN.md`.

Notable optional flags:
- `DYNAMICS_IMPERSONATION_ENABLED=true` — sends `MSCRMCallerID` on user-driven Dynamics writes; off by default for safe rollout (see `docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`)
- `PROMPT_RESOLVER_STRICT=true` — disables bundled-prompt fallback for prompt-dev loops
- `EXTERNAL_LINK_SECRET_PREVIOUS` — outgoing `EXTERNAL_LINK_SECRET` value, set only during a rotation window; `verifyToken` accepts it, `mintToken` never uses it (see `docs/CREDENTIALS_RUNBOOK.md` § "Rotating EXTERNAL_LINK_SECRET")
- `WAVE1_BACKEND_SETTINGS` / `WAVE1_BACKEND_APP_ACCESS` / `WAVE1_BACKEND_PREFS` — Wave 1 backend dispatch flags. **Default is now Dataverse**; the legacy Postgres tables (`system_settings`, `user_app_access`, `user_preferences`) were dropped 2026-05-12. Setting any of these to `postgres` will fail loudly — kept only as an explicit opt-out signal.
- `VIRUS_SCAN_ENABLED=true` — app-side Cloudmersive virus scanning across all upload surfaces (reviewer uploads via `lib/services/review-upload.js`; intake-portal attach via `pages/api/intake/draft/attach.js`). **Default off.** When on, fail-closed: scanner outage or missing `CLOUDMERSIVE_API_KEY` blocks the upload. Single source of truth is `lib/utils/virus-scan-config.js`. To bypass during an outage, set to `false` and redeploy — that's the emergency runbook. See `docs/CREDENTIALS_RUNBOOK.md` § "Virus scanning (VIRUS_SCAN_ENABLED + CLOUDMERSIVE_API_KEY)" for the free-tier limits + per-cycle projection.
- `CLOUDMERSIVE_API_KEY` — Cloudmersive virus-scan API key, required when `VIRUS_SCAN_ENABLED=true`. Missing with the flag on causes upload responses to surface as `scan_misconfigured` (HTTP 500).
- `HONORARIUM_PROGRAM_ID` / `HONORARIUM_GRANTPROGRAM_ID` / `HONORARIUM_TYPE_ID` — Dataverse lookup GUIDs for the honorarium `akoya_request` discriminators (`akoya_program`="Research Reviewer" / `wmkf_grantprogram`="Honorarium" / `wmkf_type`="Individual"). Env-driven like `BILLCOM_ACCOUNT_*_VALUE` (env-specific GUIDs; resolve once with `scripts/probe-honorarium-discriminators.js`). Fail-loud: the chunk-4 honorarium-create path throws + alerts + skips if any is unset (accept still succeeds). Only read when a reviewer accepts without opting out. See `docs/BILL_CHUNK_4_DESIGN.md`.
- **Honorarium amount** is NOT an env var — it's a single Dataverse setting `honorarium.default_amount` in `wmkf_appsystemsettings` (admin-editable at `/admin` → "Reviewer Honorarium Amount", documented fallback $250). Read live at portal honorarium-create + Review Manager email render; replaces the former per-user preference (S199). See `lib/services/honorarium-config.js`.

## Per-App Model Configuration

Defaults live in `shared/config/baseConfig.js` (`getModelForApp()`); admin can override per-app at runtime via `/admin` (persisted in Dataverse `wmkf_appsystemsettings`). Per-app `CLAUDE_MODEL_<APP>` env vars also work as a static override.

## Development

```bash
npm install              # Install dependencies
npm run dev              # Run development server
npm run build            # Build for production
node scripts/apply-migrations.js  # Apply DB migrations (existing env; setup-database.js is fresh-install only)
```

See `scripts/README.md` for database utility scripts.

For multi-Mac development, see `docs/MULTI_MAC_SETUP.md`.

---

## Authentication Architecture

Three-layer defense-in-depth:

1. **Server-side proxy** (`proxy.js`) — `withAuth`/`jose` validates JWT before any HTML/JS is served. (Formerly `middleware.js`; renamed to the Next 16 `proxy` file convention. Runs on the Node.js runtime.) Unauthenticated users never see the app. Respects `AUTH_REQUIRED` kill switch. Excludes `/api/auth/*`, `/api/cron/*` (`CRON_SECRET`), and `/api/irs/*` (`IRS_VERIFY_SECRET` shared-secret header for PowerAutomate).
2. **API route auth** (`lib/utils/auth.js`) — App-specific endpoints use `requireAppAccess(req, res, ...appKeys)` which combines CSRF origin check + auth + `is_active` check + app access in one call. Returns `{ profileId, session }` on success; sends 401/403 on failure. App grants are cached in-memory (2-min TTL); `is_active` and the superuser role are checked **fresh every request** (never cached), so a revoked/disabled account loses access immediately. Disabled accounts blocked before superuser bypass. Infrastructure endpoints (auth, admin, health) use `requireAuth()` or `requireAuthWithProfile()`.
3. **Client-side guards** (`RequireAuth`, `RequireAppAccess`) — Defense in depth for navigation/UI.

**Important:** When adding new app-specific API endpoints, use `requireAppAccess(req, res, 'app-key')` with the correct app key from `appRegistry.js`. For infrastructure endpoints, use `requireAuthWithProfile()` for user-scoped data. Superuser-only routes use `requireSuperuser(req, res)` (returns `{ profileId }` or null after sending 401/403); the lower-level `getUserRole(profileId)` is available when a route needs role beyond just superuser. Never accept `profileId` from query/body params — derive it from `access.profileId` or the session.

### Dual-provider NextAuth (staff + applicants)

`pages/api/auth/[...nextauth].js` registers two providers: `azure-ad` (staff; sessions carry `azureId` / `profileId` / `dynamicsSystemuserId`) and `entra-external` (applicants, separate Entra External ID tenant, OTP-only; sessions carry `contactOid` / `contactEmail`; env-gated on `EXTERNAL_AZURE_AD_*`).

Sessions self-identify with `session.user.userType: 'staff' | 'applicant'` — branch on this, never infer from populated fields. Middleware enforces non-crossing both directions: staff sessions can't hit `/apply/*`, applicant sessions can't hit non-`/apply` routes. `/auth/signin` auto-dispatches to External ID OAuth when `callbackUrl` resolves to `/apply*`.

---

## Key Conventions

### Data Structures

All APIs return consistent structures:
- `result.formatted` - Main content/summary text
- `result.structured` - Extracted structured data objects
- `result.metadata` - File processing metadata

### Shared Components

Located in `shared/components/`. Notable: `Layout.js` (nav filtered by app access), `FileUploaderSimple.js`, `ResultsDisplay.js`, `RequireAppAccess.js`, `WelcomeModal.js`. API keys are server-side only — UI consumes `/api/api-capabilities` for boolean availability.

### Shared Config

Located in `shared/config/`:
- `appRegistry.js` - Single source of truth for app definitions (keys, names, routes, icons, categories)
- `baseConfig.js` - Per-app model configuration, `loadModelOverrides()` cache, `getModelForApp()` with DB override support

### Service Classes

Catalog at **`docs/SERVICE_AND_UTILITY_CATALOG.md`** (one-line index per file across `lib/services/`, `lib/external/`, `lib/bill/`, `lib/utils/`). Source-file headers are authoritative for per-file contracts, safety posture, storage source-of-truth, and migration/drop history.

High-risk pointers:
- Anthropic API calls: use `lib/services/llm-client.js` (SSRF-safe transport, retry, redaction) — NOT ad-hoc `fetch` to `api.anthropic.com`.
- Prompt execution: `lib/services/execute-prompt.js` implements `docs/EXECUTOR_CONTRACT.md`; legacy `prompt-resolver.js` is script-only.
- Dynamics restriction context: `lib/services/dynamics-context.js` + `DynamicsService.checkRestriction()` fail closed unless callers enter an explicit context.
- External reviewer flow: `lib/external/` owns HMAC token lifecycle, token+row verification, reviewer-visible SharePoint materials, and review-form schema.
- BILL.com wrapper: `lib/bill/` owns vendor/network/webhook primitives; design details in `docs/BILL_LIB_DESIGN.md` and `docs/BILL_HONORARIUM_INTEGRATION_DESIGN.md`.

### Utility Classes

Catalog at same `docs/SERVICE_AND_UTILITY_CATALOG.md`.

Load-bearing utility gotchas:
- `auth-policy.js` is shared by `proxy.js` and Node auth helpers; must stay bundle-safe and production-fail-closed.
- `intake-blob.js` must use `INTAKE_BLOB_RW_TOKEN`, not shared `BLOB_READ_WRITE_TOKEN`, for intake private Blob calls.
- `tracked-secrets.js` is the canonical tracked-secret list; `docs/CREDENTIALS_RUNBOOK.md` mirrors it by hand.

---

## Database Schema

Vercel Postgres. Authoritative sources:

- `scripts/setup-database.js` — fresh-install schema (one-shot; see inline `submission_jobs` loud-failure comment for the existing-DB hazard). Live table count grows as migrations add tables — `lib/db/migrations-manifest.json` is the authoritative list.
- `lib/db/migrations/*.sql` — incremental migrations applied on top of fresh install.
- `lib/db/migrations-manifest.json` — committed file list, regenerated by `npm run prebuild`; CI gate `npm run check:migrations-manifest` + `git diff --exit-code` keeps it in sync.
- `schema_migrations` table — per-environment tracker of which migrations have been applied. Read by `scripts/apply-migrations.js` (the canonical apply path for existing environments) and by the startup-time drift check (`lib/utils/migration-drift.js`, wired into `instrumentation.js`).

Run `node scripts/apply-migrations.js` (NOT `setup-database.js`) on any existing environment. `setup-database.js` is fresh-install-only. `lib/db/schema.sql` is the legacy v1 schema (5 reviewer tables); kept for historical reference, not authoritative.

| Table | Purpose |
|-------|---------|
| `user_profiles` | Identity (azure_id, azure_email, is_active, dynamics_systemuser_id) |
| `researchers`, `publications` | Postgres drain-only (Reviewer Finder formerly read this pool; W6 retired the Database tab and `researchers.js` 2026-05-12). Active reviewer state now in Dataverse `wmkf_appresearcher` / `wmkf_potentialreviewer`. |
| `grant_cycles` | Postgres drain-only post-W3 cutover (2026-05-12); Dataverse `wmkf_appgrantcycle` is source of truth. See `docs/atlas/postgres-grant-cycles.md`. |
| `proposal_searches`, `reviewer_suggestions` | Postgres drain-only / script-only (Reviewer Finder per-user state migrated to Dataverse `wmkf_appreviewersuggestion`). |
| `retractions`, `integrity_screenings`, `screening_dismissals` | Integrity Screener (Retraction Watch + per-user history) |
| `dynamics_feedback` | Dynamics Explorer thumbs + auto-detected failures |
| `expertise_roster`, `expertise_matches` | Expertise Finder roster + match history |
| `panel_reviews`, `panel_review_items` | Virtual Review Panel persistence |
| `intake_drafts`, `intake_audit` | Applicant intake portal — drafts (Postgres-only, cleared on submit) + sha256-hashed audit. S184: added `pending_attachments JSONB` column (migration 013) for the three-call attach dance; server-managed, never overwritten by autosave; swept at 2h cutoff by daily maintenance cron. |
| `submission_jobs` | Applicant intake portal async submission queue, idempotency-keyed, drained by `/api/cron/drain-submissions` every 2 min. State machine + shipped vs. parked handlers (currently `dynamics_patched` writes budget-line children only; persons + parent aggregate + status-flip handlers all park) in `docs/INTAKE_PORTAL_DRAIN_PLAN.md` § "State machine". |
| `system_alerts`, `health_check_history`, `maintenance_runs` | Monitoring + cron job audit trail |
| `policy_publish_audit` | Append-only audit of `wmkf_policy` version publishes via `/api/admin/policies`. Pending row before mutation + final row after (paired by `request_id`). |
| `bill_webhook_events` | BILL.com webhook dedup gate. `UNIQUE(subscription_id, event_id)` backs atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING id` check-and-insert. 7-day TTL via `cleanupBillWebhookEvents` (daily maintenance step 4.6). Migration `015_bill_webhook_events.sql`. |
| `bill_onboarding_state` | BILL honorarium onboarding durable state (chunk-4), one row per honorarium `akoya_request` (PK `honorarium_request_id`). Reserve-before-create (PK race) + persist `vendor_id` before contact PATCH (no duplicate vendor on retry) + `dynamics_pending` torn-state marker resumed by `MaintenanceService.sweepBillOnboarding`. Written by `lib/bill/onboarding-state.js`. 30-day TTL via `cleanupBillOnboardingState`. Migration `017_bill_onboarding_state.sql`. See `docs/BILL_CHUNK_4_DESIGN.md`. |

User-scoping convention: shared tables for organization-wide reference data; per-user tables for "my X" surfaces. Wave 1 (`system_settings`, `user_app_access`, `user_preferences`) was fully migrated to Dataverse and dropped from Postgres on 2026-05-12 — see `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md` for the migration history.

---

## API Endpoints

The full route catalogue lives in **`docs/API_ROUTE_SECURITY_MATRIX.md`** ([100](docs/CANONICAL_COUNTS.md#api-route-file-count) route files, CI-gated via `npm run check:api-routes` — PRs touching `pages/api/**` fail without a matrix update). Source files in `pages/api/<app>/` are authoritative for behavior.

Conventions:
- App-specific routes use `requireAppAccess(req, res, 'app-key')`. App keys live in `shared/config/appRegistry.js`.
- Infrastructure routes use `requireAuth()` / `requireAuthWithProfile()` / `requireSuperuser()`.
- `/api/cron/*` authenticates via `CRON_SECRET`, not session JWT.
- `/api/external/*` token-authenticated (HMAC JWT); public, allowlisted in `proxy.js`. See `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md`.
- Streaming endpoints use SSE; convention is `text/event-stream` with `data: {...}` frames.

---

## Extended Documentation

Operational docs to know about (others in `docs/` are design backdrop, roadmaps, or point-in-time audits — find via grep when relevant):

- **`docs/SYSTEM_MODEL.md`** — the canonical conceptual model (rote-vs-thinking principle, the two orthogonal axes, capabilities vs. trunk vs. substrate, the two interaction modes, doc-resolution provenance tiers) and the **Glossary** defining load-bearing terms (Executor, Mode 1/Mode 2, drain, slice-0, thin adapter). Read before cross-capability planning.
- **`docs/EXECUTOR_CONTRACT.md`** — shared spec PA `ExecutePrompt` and Vercel `executePrompt()` both implement. Read before any prompt work.
- **`docs/API_ROUTE_SECURITY_MATRIX.md`** — [100](docs/CANONICAL_COUNTS.md#api-route-file-count)-route catalogue, CI-gated.
- **`docs/SECURITY_OPERATING_PLAN.md`** — weekly/monthly/quarterly security cadence + watch-item escalation thresholds.
- **`docs/CREDENTIALS_RUNBOOK.md`** — env vars, secret rotation, diagnostics.
- **`docs/AUTHENTICATION_SETUP.md`** — Azure AD configuration.
- **`docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md`** — `MSCRMCallerID` impersonation contract + privilege intersection.
- **`docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md`** — token primitive, magic-link landing, SharePoint upload flow.
- **`docs/REVIEWER_INTERACTION_DESIGN.md`** — full reviewer journey design (six stages from invitation through post-submit).
- **`docs/REVIEWER_STAGE_2A_BUILD_PLAN.md`** — Stage 2a invitation-landing slice. Read before touching `/external/review/[token]` or `/api/external/review/[token]/*`.
- **`docs/INTAKE_PORTAL_DESIGN.md`** — applicant intake portal, being built for the **next cycle's Phase I intake** (single applicant submission). Its body describes the now-superseded June 2026 Phase II Research pilot; live direction is `docs/SYSTEM_MODEL.md`.
- **`docs/INTAKE_ATTACH_BUILD_SCOPING.md`** + **chunk-3 / chunk-4 / chunk-5 / chunk-6 design docs** — S184's 6-chunk three-call attach build. Scoping doc has the locked A1-A7 contract amendments; per-chunk design docs capture Codex pre-impl + post-impl review outcomes. Read these before touching `/api/intake/draft/upload-token`, `/api/intake/draft/attach`, the `pending_attachments` column, or `MaintenanceService.sweepIntakePending`.
- **`docs/POSTGRES_TO_DATAVERSE_MIGRATION.md`** — Wave 1+ migration plan.
- **`docs/GRANT_CYCLE_LIFECYCLE.md`** — proposal lifecycle stages, statuses, triggers.
- **`DEVELOPMENT_LOG.md`** — session-by-session history.
- **`docs/guides/`** — user-facing guides (one per app).
- **`modules/expertise_matching/CLAUDE.md`** — Expertise Finder module rules + matching procedures.
