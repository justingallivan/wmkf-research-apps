---
name: project-memory-router-trap-prevention
description: Why MEMORY.md kept bloating and the write-time guard + wiki valve that prevent it
metadata:
  type: project
  status: active
---

The memory router (`.claude-memory/MEMORY.md`) is auto-loaded every session and has a
hard size budget. It crept back over budget in under a week after the reorg because
enforcement was **warn-only and at session start** — the session that bloated it never
felt the cost; a later session got the red gate. With this project's high durable-fact
write-rate, periodic big-bang cleanups always lose the race.

**Prevention (installed 2026-06-10), three layers:**

1. **Write-time enforcement.** `.claude/hooks/memory-router-guard.js` (PreToolUse
   Write|Edit) blocks an edit to MEMORY.md that introduces a *net-new* budget breach
   (>12KB, >150 lines, or a `- ` line whose prose — `.md` refs stripped — exceeds 200
   chars). Net-neutral/shrinking edits always pass, so compaction is never trapped.
   Thresholds single-sourced from `scripts/check-memory-router.js`. The gate was also
   hardened: 12KB warn→hard-fail + the 200-char prose cap (file-ref lists exempt, so a
   line may route to many files).

2. **Signal.** Gate emits an 11KB early-warning band (warns, doesn't fail); the
   SessionStart hook surfaces router pressure when within ~1KB of the cap.

3. **Incentive / discoverability — the load-bearing one.** Detail defaulted to the
   router because the wiki was a one-page trial nobody read. The
   [[project-agent-wiki-retrieval-layer]] is now the cheap home for domain detail
   (growth there is free; router growth costs context every session). SessionStart
   routes domain work to `docs/agent-wiki/index.md`; `agent-wiki-reminder.js` nudges on
   memory writes; the router carries inline `→ wiki:<topic>` pointers.

**Rule of thumb:** router line = terse trigger + slugs + `→ wiki:<topic>`; domain
detail (hazards, source maps, mechanisms) → a `docs/agent-wiki/topics/*.md` page;
memory file = intent/lessons/hazard. Canonical: `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`
Phase 5 + `docs/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md`. Related:
[[memory-store-propagation]].
