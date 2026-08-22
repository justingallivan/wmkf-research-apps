#!/usr/bin/env node
'use strict';
/**
 * scripts/lib/memory-router-thresholds.js
 *
 * The ONE place the memory-router budget numbers exist as literals
 * (docs/MEMORY_ROUTER_EARLY_WARNING_PLAN.md Phase 1). Dependency-free by
 * contract so both the gate and the hooks can require it without pulling in
 * anything else. Consumers: scripts/check-memory-router.js (re-exports these
 * names for API stability), .claude/hooks/memory-router-guard.js, and
 * .claude/hooks/session-lifecycle.js — none of which may carry their own
 * numeric copies or fallback literals.
 */

module.exports = {
  MAX_LINES: 150,          // hard cap on MEMORY.md line count
  MAX_BYTES: 18 * 1024,    // legacy ceiling (unreachable — TARGET_BYTES fails first; kept for API stability)
  TARGET_BYTES: 12 * 1024, // hard cap (hardened 2026-06-10; was warn-only)
  WARN_BYTES: 11 * 1024,   // near-cap warning band (warns, does not fail)
  NOTICE_BYTES: 8 * 1024,  // routine-audit trigger notice (docs/MEMORY_HYGIENE_RUNBOOK.md §5)
  MAX_PROSE_LEN: 200,      // per `- ` router entry, after stripping `.md` refs + separators
};
