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

## Universal Safety Invariants

- Existing databases use `node scripts/apply-migrations.js`; `scripts/setup-database.js` is fresh-install-only and refuses populated databases.
- Never accept user/profile identity from request input when authenticated context supplies it.
- API keys and secrets stay server-side. Environment contracts live in `docs/CREDENTIALS_RUNBOOK.md`; tracked secret names live in `lib/utils/tracked-secrets.js`.
- Use `lib/services/llm-client.js` for provider calls and `lib/services/execute-prompt.js` for the shared Executor contract.
- Use explicit Dynamics restriction context; preserve fail-closed auth and restriction behavior. Post-auth entry points establish it via `lib/dataverse/core/context.js` `withDalContext`; entity writes fail closed outside a trusted context under `DATAVERSE_DAL_ENFORCEMENT` (on in ALL environments — prod flipped to explicit `on` 2026-07-04/S330; unset would still mean on outside production). Closed (Session 330, 2026-07-04): `DynamicsService.createEmailActivity`/`addEmailAttachment`/`sendEmail` now call `assertTrustedDalContext` first, matching entity-write enforcement — see `docs/agent-wiki/topics/dataverse-dynamics.md` and `docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md` stage log.
- Private intake Blob operations use `INTAKE_BLOB_RW_TOKEN`, never the shared Blob token.
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

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
node scripts/apply-migrations.js
```

Run `npm run check:agent-invariants` after instruction, skill, or symlink work. Do not place the repository or `.git` in a cloud-synced folder.

## Project Shape

```text
pages/             Next.js pages and API routes
shared/            Shared components, config, prompts, and utilities
lib/               Services, Dataverse adapters, database, and core utilities
scripts/           Setup, probes, gates, and operational utilities
docs/              Canonical architecture, plans, runbooks, Atlas, and guides
modules/           Self-contained sub-projects with their own local instructions
outputs/           Generated reports, decks, and analysis artifacts
_archived/         Retired apps/pages moved out of the live tree
.claude/rules/      Path-scoped conventions
.claude/skills/     Multi-step workflows shared with Codex through .agents/skills
.claude-memory/     Rationale, preferences, history, and task router
tests/              Unit and integration tests
```

<!-- Do NOT run `rtk init` in this repo: it overwrites the condensed block below
     with a ~139-line reference, pushing this file past the 200-line
     check:instruction-architecture gate. [VERIFIED 2026-07-04 via scratchpad test] -->
<!-- rtk-instructions v2 -->
## RTK (Rust Token Killer)

Prefix every shell command with `rtk`, including each command inside `&&` chains (`rtk git add . && rtk git commit …`). Commands without a dedicated filter pass through unchanged, so `rtk` is always safe; the Claude Code Bash hook also rewrites commands automatically. Meta commands: `rtk gain [--history]` (savings stats), `rtk discover` (missed opportunities), `rtk proxy <cmd>` (run unfiltered for debugging). Full per-command filter reference: `rtk --help`.
<!-- /rtk-instructions -->
