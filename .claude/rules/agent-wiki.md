---
paths:
  - "docs/agent-wiki/**"
  - "scripts/check-agent-wiki*.js"
  - ".claude/hooks/agent-wiki-reminder.js"
---

# Agent Wiki

The agent wiki is a retrieval and hazard-routing layer, not a source of truth. Keep every durable claim subordinate to source files, Atlas pages, canonical docs, and probes. Pages need current frontmatter, existing source/canonical paths, watch paths for reminder hooks, and update triggers. Run `npm run check:agent-wiki` after wiki structure changes; run `/sweep` when a changed fact appears in multiple durable docs.
