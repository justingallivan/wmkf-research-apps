---
name: feedback-escalate-aggregate-scope-not-step-size
description: "When a not-in-plan task grows through many cycles, escalate the aggregate disproportion — don't keep framing each next step as 'small'"
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: 0a631ca0-29ca-4f6c-913a-f551fb1ced7d
---

## Recall Rule

Track cumulative detour cost against the original objective. After roughly
two-to-three review/fix cycles on unplanned work, surface the aggregate scope and
ask whether to continue, stop, or hand off.

Owner pushback (S339): "You said this was a small task. What's up?" — after the reviewer-finder
save-COI work ran ~6 adversarial-review cycles plus a structural reframe, each step I honestly
called "small / the tail," never owning that the **sum** had become a major unplanned effort.

**Why:** each individual fix genuinely was small and real, so "small" was true step-by-step. But
the aggregate had drifted far from the session's actual objective (which was not even reviewer-finder
— see the handoff), and per-step "one more" framing never surfaced that disproportion. Framing the
next step honestly is not the same as flagging that the whole detour is now oversized.

**How to apply:** track cumulative cost against the original objective, not just per-step size. When a
not-in-plan task crosses ~2-3 cycles or clearly exceeds what the user signed up for, STOP and escalate
the aggregate: "this has grown to N cycles / X commits and drifted from <objective> — keep going,
cut it here, or hand it off?" Give the user the disproportion explicitly so they can choose, rather
than deciding for them by continuing. Pairs with [[feedback-timebox-metawork]] and
[[feedback-dont-self-certify-convergence]] (the same COI episode).
