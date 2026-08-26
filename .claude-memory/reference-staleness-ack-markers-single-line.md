---
name: reference-staleness-ack-markers-single-line
description: "The stop-hook staleness ack only counts when the full changed path and \"[RECHECKED after ... change:\" (or \"[STALE-ACCEPTED:\") are on ONE line of the doc"
status: active
metadata: 
  node_type: memory
  type: reference
  originSessionId: 058baeb1-15b3-43e7-97e0-9584b4cb457a
  modified: 2026-08-26T20:21:07.017Z
---

`.claude/hooks/lib/document-guards.js` `hasStalenessAck` matches per-line: a
line must contain BOTH the full relative changed path AND
`[RECHECKED after ... change:` (or `[STALE-ACCEPTED:`). A marker wrapped
across lines (normal 76-col doc wrapping) is invisible to the guard and the
Stop hook keeps re-flagging. Write the whole marker on one long line, and
verify with:
`node -e "console.log(require('./.claude/hooks/lib/document-guards').hasStalenessAck(require('fs').readFileSync('<doc>','utf8'),'<changed-path>'))"`

Learned 2026-08-26 after three Stop-hook rounds on
`docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`.
