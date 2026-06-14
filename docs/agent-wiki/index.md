---
agent_wiki: index
status: active
last_verified: 2026-06-13
stale_after_days: 90
owner: agent-operations
source_files:
  - CLAUDE.md
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
canonical_docs:
  - CLAUDE.md
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
watch_paths:
  - docs/agent-wiki/**
update_triggers:
  - agent-wiki routing changes
---

# Agent Wiki

This wiki is the retrieval launchpad for recurring agent work. It routes agents
to source files, Atlas pages, rules, and durable memory files before editing or
reviewing. It is subordinate to source, Atlas, and live probes.

## Operating Contract

- Use this after `CLAUDE.md` and before broad repo exploration when a task matches a trigger below.
- Treat topic pages as hubs: read source files and canonical docs before making state claims.
- Keep `.claude-memory/MEMORY.md` as a startup router; put leaf memory lists here.
- Update a topic when durable behavior changes in its `watch_paths`.
- Mark a topic `status: stale` when drift is discovered but not reconciled.
- Run `npm run check:agent-wiki` after wiki edits.

## Router

| Task trigger | Read first | Canonical follow-up |
|---|---|---|
| Reviewer origination, retrieval lanes, provenance, ranking, recall-vs-precision | [Reviewer Origination](topics/reviewer-origination.md) | `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md`, `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` |
| Reviewer identity, ORCID, contact, candidate persistence, COI, PI identity, invite confidence | [Reviewer Identity](topics/reviewer-identity.md) | `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/dataverse-wmkf-potentialreviewers.md`, `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` |
| Reviewer workbench, roster, lifecycle, referral, address collection | [Reviewer Workbench & Lifecycle](topics/reviewer-workbench-lifecycle.md) | `docs/APPLICATION_STATE_ATLAS.md`, reviewer app routes/services |
| External reviewer portal, accept/decline, tokens, E2E harness, SharePoint files | [External Reviewer Portal](topics/external-reviewer-portal.md) | `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md`, `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, `tests/e2e/README.md` |
| Intake portal, draft capture, submit, attachments, blob token, virus scan, institution match | [Intake Portal](topics/intake-portal.md) | `docs/INTAKE_PORTAL_DESIGN.md`, `docs/atlas/dataverse-akoya-request.md` |
| Dataverse / Dynamics, schema deploy, OData, probes, Explorer, Power Tools, grant lifecycle fields | [Dataverse & Dynamics](topics/dataverse-dynamics.md) | `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/`, `docs/DYNAMICS_SCHEMA_ANNOTATION.md` |
| Prompt storage, shared Executor, PDF/document processing | [Prompt & Executor](topics/prompt-executor.md) | `docs/EXECUTOR_CONTRACT.md`, prompt resolver/composer/source files |
| BILL, honoraria, payment fields, no-banking constraints | [Finance & Honoraria](topics/finance-honoraria.md) | `docs/APPLICATION_STATE_ATLAS.md`, payment/honorarium docs |
| App access, admin, API credit/security, private Blob/file proxy | [Security & Auth](topics/security-auth.md) | `docs/API_ROUTE_SECURITY_MATRIX.md`, `docs/CREDENTIALS_RUNBOOK.md`, `docs/SECURITY_ARCHITECTURE.md` |
| Applicant integrity screening, Retraction Watch, PubPeer, News, SerpAPI residual | [Integrity Screener](topics/integrity-screener.md) | `docs/APPLICATION_STATE_ATLAS.md`, `docs/REVIEWER_FINDER_SERPAPI_MIGRATION_PLAN.md` |
| Dev environment, secrets, Vercel deploys, local Jest/build quirks, Claude config sync | [Dev Environment](topics/dev-environment.md) | `docs/CREDENTIALS_RUNBOOK.md`, deployment docs, local scripts |
| Strategy, system model, roadmap, phasing, planned automation | [Strategy & Roadmap](topics/strategy-roadmap.md) | `docs/SYSTEM_MODEL.md`, `DEVELOPMENT_LOG.md`, current handoff |

## Maintenance

Append operational discoveries to [log.md](log.md) only when they are useful for
future routing. Promote repeated discoveries into a topic page once they recur or
become load-bearing. Do not duplicate Atlas/source facts here as current truth.
