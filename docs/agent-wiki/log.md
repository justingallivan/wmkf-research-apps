---
agent_wiki: log
status: active
last_verified: 2026-06-10
stale_after_days: 90
owner: agent-operations
source_files:
  - CLAUDE.md
  - docs/agent-wiki/index.md
canonical_docs:
  - CLAUDE.md
  - docs/CLAUDE_INSTRUCTION_AUTHORITY.md
watch_paths:
  - docs/agent-wiki/**
update_triggers:
  - agent-wiki trial updates
---

# Agent Wiki Log

## 2026-06-07

- Trial wiki created as a retrieval and hazard-routing layer. Scope is intentionally narrow: one topic page, deterministic structure checks, and an advisory freshness hook.

## 2026-06-10

- Promoted the wiki from trial to a real retrieval layer. Added four topic pages —
  reviewer-origination, external-reviewer-portal, intake-portal, dataverse-dynamics —
  and routed each from the index. Pages absorb the dense operational clusters that had
  accumulated in `.claude-memory/MEMORY.md`; the memory router lines were collapsed to
  terse triggers that point here. Per the Codex handoff brief
  `docs/archive/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md`.
