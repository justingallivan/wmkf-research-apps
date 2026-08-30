# Document Processing Multi-App System

This is a Next.js multi-application system for grant and document workflows, deployed on Vercel with Dataverse, Postgres, Blob storage, and multiple AI providers.

`CLAUDE.md` is the canonical cross-agent instruction file. Root `AGENTS.md` must remain a tracked symlink to it; `.agents/skills` must remain a symlink to `.claude/skills`. Never run `migrate-to-codex` here. Verify links with `npm run check:agent-invariants`; authority and enforcement ownership live in `docs/CLAUDE_INSTRUCTION_AUTHORITY.md`.

## Universal Operating Rules

1. **Probe before planning.** Verify live-state claims with source, Atlas, callers, and probes. Label material state claims `[VERIFIED via X]` or `[ASSUMED]`; never present plan intent as built state. Read `docs/CLAUDE_REMEDIATION_PLAN.md` before migration, integration, or data-layer planning.
2. **Verify destructive carryover.** Before drop/remove/retire/archive/delete/deprecate work inherited from a prompt, memory, or `SESSION_PROMPT.md`, grep live callers and read likely load-bearing paths. Stop and report if anything is live.
3. **Time-box support work.** Cleanup, reconciliation, documentation audits, and verification loops support the user's objective. Check in before they exceed approximately 30 minutes or two commits without advancing that objective.
4. **Relevant red gates block completion.** Run gates for surfaces you changed. A gate and its self-test run sequentially, never in parallel. Gate mechanics and scopes live in `docs/CI_GATES_REFERENCE.md`.
5. **Reconcile durable facts completely.** For docs, memory, instruction files, and `SESSION_PROMPT.md`, follow `.claude/rules/durable-docs.md`; use `/sweep` for fact-level reconciliation.
6. **Commit working changes regularly.** Commit completed, working features/fixes with descriptive messages; preserve unrelated user changes. `main` auto-deploys to production: follow `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` — Tier 0 work may land directly, while Tier 1–3 runtime work uses a branch and deliberate promotion.
7. **Ask, don't assume.** If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements.
8. **Simplest solution first.** Always implement the simplest thing that could work. Do not add abstractions or flexibility that weren't explicitly requested.
9. **Don't touch unrelated code.** If a file or function is not directly part of the current task, do not modify it, even if you think it could be improved.
10. **Flag uncertainty explicitly.** If you are not confident about an approach or technical detail, say so before proceeding. Confidence without certainty causes more damage than admitting a gap.
11. **Use OAuth for agent sessions.** Run Claude Code and Codex sessions, including delegated or subprocess review sessions, only through their interactive OAuth/subscription authentication. Never use, remap, export, or pass project/provider API keys (for example `CLAUDE_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`) to authenticate an agent CLI or simulate an agent review. On macOS, Codex must run Claude authentication checks and delegated Claude CLI processes outside the Codex sandbox so Claude can access the user's Keychain-backed OAuth session. A sandboxed `claude auth status` result of `loggedIn: false` / `authMethod: none` is inconclusive; re-check outside the sandbox before asking the user to authenticate, and never fall back to a direct model API. This host-execution requirement grants no permission to read, export, or repurpose OAuth tokens. This governs development-agent sessions only and does not change the application's server-side provider credential contracts.
12. **Require explicit authorization for metered tools.** OAuth authentication, an available trial, or an account entitlement does not authorize spending or consuming credits. Never invoke Ultrareview or any other paid, metered, credit-consuming, or complimentary-entitlement product unless the user explicitly authorizes that named product after being told it may consume money or credits. A request for an ordinary model review does not authorize substituting Ultrareview or another metered review product. If the requested review mechanism fails, stop and report the failure instead of switching products.

## Universal Safety Invariants

- Existing databases use `node scripts/apply-migrations.js`; `scripts/setup-database.js` is fresh-install-only and refuses populated databases.
- Never accept user/profile identity from request input when authenticated context supplies it.
- API keys and secrets stay server-side. Environment contracts live in `docs/CREDENTIALS_RUNBOOK.md`; tracked secret names live in `lib/utils/tracked-secrets.js`.
- Use `lib/services/llm-client.js` for provider calls and `lib/services/execute-prompt.js` for the shared Executor contract.
- Use explicit Dynamics restriction context; preserve fail-closed auth and restriction behavior. Post-auth entry points establish it via `lib/dataverse/core/context.js` `withDalContext`; entity writes fail closed outside a trusted context under `DATAVERSE_DAL_ENFORCEMENT` (on in ALL environments — prod flipped to explicit `on` 2026-07-04/S330; unset would still mean on outside production). **Unlike the target interlock below, this flag fails OPEN in production**: only the literal `'on'` enables it, and any other value falls through to `NODE_ENV !== 'production'` = `false` (`lib/services/dynamics-context.js:124-129`). Stored non-sensitive since S414 so the value is auditable — keep it readable. Closed (Session 330, 2026-07-04): `DynamicsService.createEmailActivity`/`addEmailAttachment`/`sendEmail` now call `assertTrustedDalContext` first, matching entity-write enforcement — see `docs/agent-wiki/topics/dataverse-dynamics.md` and `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` stage log.
- Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token.
- Large grantee-image and staff replacement uploads use actor-bound `portal_upload_staging` rows and the private `UPLOADS_BLOB_RW_TOKEN` store. Mint and finalize routes reauthorize independently; clients never choose Blob pathnames; cleanup deletes only exact persisted pathnames. Do not route these bytes back through multipart Function bodies or use the intake token.
- The Dataverse target/write interlock (`lib/dataverse/core/interlock.js`, wired at all runtime Dataverse HTTP seams since S355) classifies deployment × target-hostname × operation and fails closed on unknowns. `DATAVERSE_TARGET_INTERLOCK=on` is live in local, Preview, and Production (production enforced 2026-07-22 after positive warn-mode observation and a signed-in Workbench smoke); **unset/empty resolves to `off`**, while an invalid set value fails closed to `on`, so explicit per-environment configuration is required. Never bypass it via a client-supplied flag; hostname classification lives in the tracked `target-registry.js` — extending it is a reviewed commit, not an env edit. See `docs/DATAVERSE_TARGET_WRITE_INTERLOCK_PLAN.md`.

## High-Risk Workflows

Invoke `/contract-reconcile` explicitly for plan review, finding verification, migrations/new tables/routes, cross-layer changes, durable state, partial batch success, deduplication, streaming/await/background work, or shared-helper extraction. It traces caller → persistence → consumer and audits partial success, stale async state, helper semantics, durable surfaces, and docs.

Use:

| Workflow | Required source |
|---|---|
| Session startup / handoff | `/start` / `/stop` |
| Whole-repo fact reconciliation | `/sweep` |
| Data/schema planning | `docs/APPLICATION_STATE_ATLAS.md` + relevant `docs/atlas/` page |
| Cross-capability architecture | `docs/SYSTEM_MODEL.md` |
| Prompt execution | `docs/EXECUTOR_CONTRACT.md` |
| API route security | `docs/API_ROUTE_SECURITY_MATRIX.md` |

Task-specific conventions load from `.claude/rules/` when matching files are read. Rules that apply before a file is created remain covered by explicit skills, hooks, and CI gates.

## Source-Of-Truth Pointers

- Applications and app keys: `shared/config/appRegistry.js`
- Service/utility contracts: source headers + `docs/SERVICE_AND_UTILITY_CATALOG.md`
- Postgres fresh-install shape: `scripts/setup-database.js`
- Existing-DB migrations: `lib/db/migrations/*.sql`, `lib/db/migrations-manifest.json`, and `schema_migrations`
- Live data ownership/read/write paths: `docs/APPLICATION_STATE_ATLAS.md` and `docs/atlas/`
- Authentication architecture: `docs/AUTHENTICATION_SETUP.md`; route guards: `docs/API_ROUTE_SECURITY_MATRIX.md`; active security work: `docs/SECURITY_OPERATING_PLAN.md` (`docs/SECURITY_ARCHITECTURE.md` is a historical March 2026 review snapshot)
- Environment variables and rotation: `docs/CREDENTIALS_RUNBOOK.md`
- Operational gate details: `docs/CI_GATES_REFERENCE.md`
- Agent instruction framing and rationale sidecars: `docs/AGENT_HARNESS_STYLE_GUIDE.md`
- Agent retrieval wiki: `docs/agent-wiki/index.md` (subordinate routing aid; source/Atlas/probes remain authoritative)
- Task routing and historical rationale: `.claude-memory/MEMORY.md`
- Milestone history: `DEVELOPMENT_LOG.md`

Mutable catalogues do not belong in this root file. Inspect their authoritative source before making claims.

## Development

Run `npm run check:agent-invariants` after instruction, skill, or symlink work. Do not place the repository or `.git` in a cloud-synced folder.

<!-- Do NOT run `rtk init` in this repo: it overwrites the condensed block below
     with a ~139-line reference, pushing this file past the 200-line
     check:instruction-architecture gate. [VERIFIED 2026-07-04 via scratchpad test] -->
<!-- rtk-instructions v2 -->
## RTK (Rust Token Killer)

Prefix every shell command with `rtk`, including each command inside `&&` chains (`rtk git add . && rtk git commit …`). Commands without a dedicated filter pass through unchanged, so `rtk` is always safe; the Claude Code Bash hook also rewrites commands automatically. Meta commands: `rtk gain [--history]` (savings stats), `rtk discover` (missed opportunities), `rtk proxy <cmd>` (run unfiltered for debugging). Full per-command filter reference: `rtk --help`.
<!-- /rtk-instructions -->
