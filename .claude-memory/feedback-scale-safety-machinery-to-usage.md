---
name: feedback-scale-safety-machinery-to-usage
description: "Ask how often and by how many people a workflow runs before designing concurrency/fencing machinery; owner simplified the expertise roster cutover once told it runs ~twice a year by one operator."
metadata:
  type: feedback
  status: active
  last_verified: "2026-11-18 via the Production cutover simplification addendum on branch codex/expertise-roster-import-2026-11-10"
---

## Recall Rule
Read before planning a cutover, migration, lock, intent/fencing, admission/drain or
rollback-reconciliation design.

Do: establish usage volume and actor count first (how often, how many writers, any
automation). Size protections to that. For rare single-operator workflows prefer a
setting switch, a quiet-window one-shot script, a simple marker, and manual repair of the
few post-cutover edits.

Do not: carry multi-writer protections (session advisory locks, pending-intent fencing,
phase machines, deployment drain) into Production by default because a review asked
"what if two writers race"; that is the owner's call once volume is known.

**Why:** 2026-11-18 the owner said the expertise roster runs about once per cycle (twice a
year) by one person or flow and race protection was not wanted. Several Fable/Opus-reviewed
design rounds had built allocator/phase/drain machinery for concurrency that does not
occur. The simplification replaced it with a read switch, a cutover marker and a direct
bind. See [[feedback-latency-plan-scope-accretion-postmortem]] and
[[feedback-anchor-multisession-features-to-the-original-ask]].

**How to apply:** in plan review, flag protections whose threat requires concurrency the
usage does not have, and ask the owner before building them.
