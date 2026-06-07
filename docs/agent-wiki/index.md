---
agent_wiki: index
status: active
last_verified: 2026-06-07
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
| Reviewer identity, ORCID, affiliation, contact propagation, candidate persistence, ranking signals | [Reviewer Identity](topics/reviewer-identity.md) | `docs/APPLICATION_STATE_ATLAS.md`, `docs/atlas/dataverse-wmkf-potentialreviewers.md`, `docs/atlas/dataverse-wmkf-appreviewersuggestion.md` |

## Maintenance

Append operational discoveries to [log.md](log.md) only when they are useful for future routing. Promote repeated discoveries into a topic page once they recur or become load-bearing.
