---
agent_wiki: index
status: active
last_verified: 2026-06-10
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

This wiki is a compact retrieval layer for recurring agent work. It routes agents to the right source files, Atlas pages, rules, and prior hazards before they start editing or reviewing. It is not canonical authority; when a wiki page conflicts with source, Atlas, or a probe, the wiki is stale.

## Operating Contract

- Use this after `CLAUDE.md` and before broad repo exploration when a task matches a trigger below.
- Treat topic pages as launch pads: follow their source files and canonical docs before making claims.
- Update a topic when a task changes durable behavior covered by its `watch_paths`.
- Mark a topic `status: stale` if you discover drift but cannot reconcile it in the current task.
- Run `npm run check:agent-wiki` after wiki edits.

## Router

| Task trigger | Read first | Canonical follow-up |
|---|---|---|
| Reviewer identity, ORCID, affiliation, contact propagation, candidate persistence, ranking signals, **COI / PI identity** | [Reviewer Identity](topics/reviewer-identity.md) | `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/dataverse-wmkf-potentialreviewers.md`, `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` |
| Reviewer origination / retrieval lanes, provenance, ranking posture, recall-vs-precision, web-discovery-abandoned | [Reviewer Origination](topics/reviewer-origination.md) | `docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md`, `docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md` |
| External reviewer portal, accept/decline, review tokens, E2E harness, prod-automation hazard, SharePoint files | [External Reviewer Portal](topics/external-reviewer-portal.md) | `docs/EXTERNAL_REVIEWER_INTAKE_PLAN.md`, `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md`, `tests/e2e/README.md` |
| Intake portal: draft capture, submit, attachments, intake blob token, virus-scan, institution match | [Intake Portal](topics/intake-portal.md) | `docs/INTAKE_PORTAL_DESIGN.md`, `docs/atlas/dataverse-akoya-request.md` |
| Dataverse / Dynamics: schema deploy, OData, probes, Dynamics Explorer, Power Tools, identity reconciliation | [Dataverse & Dynamics](topics/dataverse-dynamics.md) | `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/dataverse-akoya-request.md`, `docs/DYNAMICS_SCHEMA_ANNOTATION.md` |

## Maintenance

Append operational discoveries to [log.md](log.md) only when they are useful for future routing. Promote repeated discoveries into a topic page once they recur or become load-bearing.
