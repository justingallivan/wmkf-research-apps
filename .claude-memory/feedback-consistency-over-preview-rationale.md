---
name: feedback-consistency-over-preview-rationale
description: When an adversarial finding matches a class already fixed, recommend the fix; "the user previewed it" and rarity did not stop the earlier fix and do not justify accepting the next
status: active
metadata:
  type: feedback
---

Session 487 (2026-09-05): after fixing stale signature/deadline in the materials-modal
session key, I recommended recording the stale-recipient-name finding as an accepted
limit ("the PD previewed the body", "needs a concurrent Dataverse edit"). The owner
asked "Why do you think we shouldn't fix it?" and both arguments collapsed: they applied
equally to the case just fixed. The owner chose to fix that one and the next two
(proposal fields, refetch error, degraded mode).

**Why:** an accepted-limit recommendation that contradicts the reasoning of the previous
fix is an inconsistency Codex will name in the next round, and it costs a decision
round-trip. Consistency of the boundary matters more than the size of any one gap.

**How to apply:** before recommending "accept and record", check whether the same
argument was rejected for a sibling finding in this chain. If it was, recommend the fix
or state explicitly what is different. Set the stopping rule for an adversarial chain up
front (which boundary is defensible, e.g. "client observes only what it refetched;
server-side is a planned slice") rather than re-deciding each round. Related:
[[feedback-affordance-consistency-beats-deduplication]],
[[feedback-weigh-the-risks-you-name]].
