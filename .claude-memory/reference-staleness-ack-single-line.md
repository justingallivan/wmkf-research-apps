---
name: reference-staleness-ack-single-line
description: "Stop-hook doc-staleness acks only parse when path + \"[RECHECKED after ... change:\" share ONE physical line — don't line-wrap the marker"
status: active
metadata: 
  node_type: memory
  type: reference
  originSessionId: 29a6b837-b641-4706-996e-0d56eb5d5029
  last_verified: 2026-08-13 via .claude/hooks/lib/document-guards.js:359-366
---

## Recall Rule

Read when a stop hook reports doc staleness. **Reconciling the doc's prose does
NOT clear the warning** — only the literal marker does, so fixing the underlying
staleness without adding one makes the hook re-fire against work that was
actually done (S424 burned two stops this way). Keep the source path and marker
on one physical line, then run the current `hasStalenessAck` implementation
against it; do not assume the historical parser contract is unchanged.

The session-lifecycle stop hook's `hasStalenessAck`
(`.claude/hooks/lib/document-guards.js:359-366`, verified 2026-08-13) clears a
same-session doc-staleness warning only when a single physical line of the doc
contains BOTH the changed source path AND the pattern
`[RECHECKED after ... change:` (or `[STALE-ACCEPTED:`). A line-wrapped marker
(path on the next line) never registers, and the stop hook re-fires every stop
even though the marker looks complete to a human.

**How to apply:** when adding `[RECHECKED after <path> change: …]` or
`[STALE-ACCEPTED: <path> — …]` to a doc, keep `[RECHECKED after
<full/repo/path> change:` unbroken on one line, however long; wrap only after
the colon. Verify with:
`node -e "const{hasStalenessAck}=require('./.claude/hooks/lib/document-guards');…"`.
Related: [[feedback-dont-tune-against-hook-source]] — reading hook source to
learn marker mechanics after good-faith attempts is diagnosis, not gaming.
