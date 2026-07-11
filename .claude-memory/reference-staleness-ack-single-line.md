---
name: reference-staleness-ack-single-line
description: "Stop-hook doc-staleness acks only parse when path + \"[RECHECKED after ... change:\" share ONE physical line — don't line-wrap the marker"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 29a6b837-b641-4706-996e-0d56eb5d5029
---

The session-lifecycle stop hook's `hasStalenessAck`
(`.claude/hooks/lib/document-guards.js:225-231`, verified S355) clears a
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
