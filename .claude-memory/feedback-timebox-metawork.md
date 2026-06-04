---
name: feedback-timebox-metawork
description: Cleanup / reconciliation / audit / verification loops are support work, not the goal — time-box them (~30 min or 2 commits) and check in with the user before they balloon, rather than spiraling for hours with no project progress.
metadata:
  type: feedback
  status: active
  scope: process
  last_verified: 2026-06-04 (S219) — the session this lesson came from
---

## Recall Rule

Read this when: you're doing (or about to start) cleanup, doc/memory reconciliation, a staleness/consistency audit, or a multi-round verification loop — anything that isn't directly advancing the user's stated project objective.

Do:
- Treat meta-work as **support work, not the goal.** Before it exceeds **~30 min or 2 commits** without project progress, STOP and check in: name what's left, roughly what it costs, and ask continue-or-return.
- Prefer surfacing the trade-off ("this could go N more rounds; want me to keep going or get back to X?") over silently grinding it out.
- Bound verification loops up front — decide "one Codex pass, then ship unless it finds a P0," not open-ended.

Do not:
- Let a "quick cleanup" snowball into a multi-hour session because each step spawned another step.
- Assume a perfectly-tidy memory store / fully-reconciled docs is worth unbounded user time — it usually isn't; forward progress is.
- Wait for the user to notice and complain before raising the time/cost trade-off — that's on you to surface.

Ground truth: this file; `CLAUDE.md` "Scope discipline — time-box meta-work". Related: [[feedback-reconcile-dont-append-docs]], [[feedback-drive-to-completion]], [[feedback-thoroughness-default]].

**Why:** S219 spent ~6 hours on cleanup (a table drop → ORCID backfill → a full doc/memory reconciliation → three Codex verification rounds → a start-gate fix) with **zero feature progress on the actual project**. Each step was individually reasonable, but no one time-boxed the whole and no check-in happened, so a "let's clean it up now" turned into the user's entire day. The user said so directly. The tension with [[feedback-drive-to-completion]] / [[feedback-thoroughness-default]] is real but resolvable: drive sub-tasks to completion, but the SCOPE of meta-work itself is the user's call — give them the checkpoint to make it.

**How to apply:** (1) When meta-work starts, set a rough budget out loud (time or commit count). (2) At the budget, summarize state + remaining cost and ask whether to continue. (3) If a verification loop keeps finding small residuals, that's a signal to either change approach (read whole files, not lines — [[feedback-reconcile-dont-append-docs]]) or stop and accept "good enough," not to keep looping. (4) Distinguish "must-fix now" (a red gate, a prod-write hazard) from "tidy-nice-to-have" (a stale memory line) — the former justifies interrupting project work, the latter can be batched or deferred.
