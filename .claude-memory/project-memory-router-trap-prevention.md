---
name: project-memory-router-trap-prevention
description: Why MEMORY.md kept bloating and the write-time guard + wiki valve that prevent it
metadata:
  type: project
  status: active
---

## Recall Rule

Read this when: editing `.claude-memory/MEMORY.md`, adding a routed memory, or
debugging memory-router budget failures.

Do:
- Keep router lines terse and move domain detail to a leaf memory or agent-wiki
  topic.
- Run `check:memory-router` and its self-test after routing changes.

Do not:
- Treat the write-time hook as complete coverage; harness writes can bypass it.
- Grow the router with historical narrative.

Ground truth: `.claude/hooks/memory-router-guard.js`,
`scripts/check-memory-router.js`, and
`docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`.

The memory router (`.claude-memory/MEMORY.md`) is auto-loaded every session and has a
hard size budget. It crept back over budget in under a week after the reorg because
enforcement was **warn-only and at session start** — the session that bloated it never
felt the cost; a later session got the red gate. With this project's high durable-fact
write-rate, periodic big-bang cleanups always lose the race.

**Prevention (installed 2026-06-10; early-warning ladder added 2026-08-21), three layers:**

1. **Write-time enforcement.** `.claude/hooks/memory-router-guard.js` (PreToolUse
   Write|Edit) blocks an edit to MEMORY.md that pushes a budget dimension *further past
   its cap* — bytes/lines that grow over cap, or a new/longer over-cap `- ` router line
   (prose measured with `.md` refs stripped, cap 200). The comparison is monotonic
   before/after, NOT exact-token, so a partial cleanup of an already-over-budget file —
   and any net-neutral/shrinking edit — always passes (it can never wedge a fix).
   Thresholds single-sourced from `scripts/lib/memory-router-thresholds.js` (since
   2026-08-21; the checker re-exports them, both hooks import them and skip fail-open
   if the module is unloadable — no fallback literals). The gate was also
   hardened: 12KB warn→hard-fail + the 200-char prose cap (file-ref lists exempt, so a
   line may route to many files). NOTE: harness/auto-memory writes don't go through the
   Write/Edit tools, so they bypass this PreToolUse hook — `check:memory-router` stays
   the backstop (at session start / CI) for anything the hook can't see.

2. **Signal (ladder since 2026-08-21).** Gate: notice at >=8KiB (routine-audit
   trigger -> `docs/MEMORY_HYGIENE_RUNBOOK.md` s10 diet), warn band >11KiB, hard fail
   over the 12KiB cap. SessionStart surfaces the same >=8KiB notice plus near-cap
   pressure; the Stop hook adds a crossing/growth advisory when the session's own
   edits moved the router to/past the trigger (participation, not sole causation).
   Canonical: `docs/MEMORY_HYGIENE_RUNBOOK.md` + `docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md`.

3. **Incentive / discoverability — the load-bearing one.** Detail defaulted to the
   router because the wiki was a one-page trial nobody read. The
   [[project-agent-wiki-retrieval-layer]] is now the cheap home for domain detail
   (growth there is free; router growth costs context every session). SessionStart
   routes domain work to `docs/agent-wiki/index.md`; `agent-wiki-reminder.js` nudges on
   memory writes; the router carries inline `→ wiki:<topic>` pointers.

**Rule of thumb:** router line = terse trigger + slugs + `→ wiki:<topic>`; domain
detail (hazards, source maps, mechanisms) → a `docs/agent-wiki/topics/*.md` page;
memory file = intent/lessons/hazard. Canonical: `docs/CLAUDE_MEMORY_REORGANIZATION_PLAN.md`
Phase 5 + `docs/archive/MEMORY_ROUTER_WIKI_RECOMMENDATIONS_2026-06-11.md`. Related:
[[memory-store-propagation]].
