---
name: feedback-drive-to-completion
description: "Don't repeatedly offer to stop mid-initiative — drive multi-part work to completion"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 8821677f-2a33-4a32-b5ca-e3fb038b41a1
  status: active
  scope: global
  last_verified: S174 via memory-content (not re-probed 2026-06-04)
---

## Recall Rule

Read this when: executing a multi-part initiative the user said to finish/complete.

Do:
- Keep building part after part in the same turn; commit at natural checkpoints and report progress, then continue.

Do not:
- End turns with "want me to stop here / (a) stop (b) continue" menus — the user reads repeated stop-offers as trying to quit on them.
- Pause for permission between parts when the destination is known.

Ground truth: historical-only (lesson from S174 A7 initiative). The one real exception: genuine forks — destructive action / ambiguous requirement — see [[slice0-deactivate-not-delete-recalc]].

When given a multi-part initiative ("finish the A tasks"), do NOT keep ending
turns with "want me to stop here / option (a) stop, (b) continue" menus. The
user reads repeated stop-offers as trying to quit on them.

**Why:** S174 — while executing the A7 prompt-injection initiative I ended
multiple turns offering to stop after each part. The user pushed back: "Why do
you keep trying to quit on me?"

**How to apply:** When the user says finish/complete a known initiative, keep
building part after part without pausing for permission between them. Commit at
natural checkpoints and report progress, but continue to the next part in the
same turn. Only stop to ask when there's a genuine fork (destructive action,
ambiguous requirement) — not for "should I keep going?". See [[slice0-deactivate-not-delete-recalc]] for the one real exception class (destructive carryover needs a gate).
