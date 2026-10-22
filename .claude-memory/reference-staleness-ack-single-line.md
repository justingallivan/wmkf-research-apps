---
name: reference-staleness-ack-single-line
description: "For a still-relevant source mention, the Claude session hook recognizes a staleness acknowledgement only when its path and marker share one physical line; reconciling/removing the mention can also resolve the warning"
status: active
metadata: 
  node_type: memory
  type: reference
  originSessionId: 29a6b837-b641-4706-996e-0d56eb5d5029
  last_verified: 2026-10-22 via current CodeGraph review of document-guards and session-lifecycle; warning resolution includes source-mention removal
---

## Recall Rule

Read when the Claude session hook reports doc staleness. Reconcile the document
against the changed source first. The hook also stops reporting a genuinely
removed document or obsolete source mention; that is a description of its detector,
not authorization to retire a document or delete accurate prose. If a still-relevant mention remains and
you record an acknowledgement, the marker must be recognized by the current
parser; keep the source path and marker on one physical line and do not mistake
the marker alone for proof that the content was reconciled.

The session-lifecycle stop hook's `hasStalenessAck` (`.claude/hooks/lib/document-guards.js:359-366`)
recognizes an acknowledgement when a single physical line contains BOTH the changed
source path AND `[RECHECKED after ... change:` (or `[STALE-ACCEPTED:`). A line-wrapped
marker does not register. Separately, `detectStaleDocWarnings` and
`unresolvedStaleDocWarnings` (`.claude/hooks/session-lifecycle.js:168-205`) also stop
reporting when the document is missing or no longer mentions the changed source. Resolve
the underlying doc/source disagreement rather than deleting accurate prose merely to
silence a warning.

**How to apply:** after reconciling a still-relevant `[RECHECKED after <path> change: …]` or
`[STALE-ACCEPTED: <path> — …]` to a doc, keep `[RECHECKED after <full/repo/path> change:`
unbroken on one line, however long; wrap only after the colon. Inspect current parser and
session-lifecycle behavior if the warning still persists; do not alter or remove a doc only
to suppress the hook.
Related: [[feedback-dont-tune-against-hook-source]] — reading hook source to
learn marker mechanics after good-faith attempts is diagnosis, not gaming.
