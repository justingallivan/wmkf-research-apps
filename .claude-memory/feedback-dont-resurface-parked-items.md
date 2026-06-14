---
name: feedback-dont-resurface-parked-items
description: Items flagged "parked / do NOT proactively resurface" must be omitted from proactive startup and next-step summaries, even when SESSION_PROMPT.md lists them under Potential Next Steps.
metadata:
  type: feedback
  status: active
  scope: process
  last_verified: 2026-06-13 (S256) — the session this lesson came from
---

When a carryover item is flagged **parked / externally gated / do NOT proactively
resurface**, do not echo it into any output I generate unprompted — including the
`/start` summary's "Potential Next Steps" list. Surface it only when the user asks
about it, or when its recorded un-park trigger demonstrably fires.

**Why:** the whole point of the flag is that the item stays invisible until the
user (not the agent) recalls it. On 2026-06-13 (S256) I listed "PubPeer migration —
parked, do not resurface" in my startup Potential Next Steps; Justin had to ask what
it meant, which is precisely the attention-pull the flag exists to prevent. Echoing
a "do-not-resurface" item *is* resurfacing it — the proactivity, not the depth of
explanation, is what's prohibited.

**How to apply:** when summarizing next steps from SESSION_PROMPT.md, filter out any
entry tagged parked / do-not-resurface. If acknowledging that parked work exists is
useful, state only that there are N parked-and-gated items, not their content. The
matching un-park trigger lives with the item (e.g. PubPeer = a sanctioned-API reply);
act only when that trigger is real. Don't carry such items *under* a "Potential Next
Steps" heading in SESSION_PROMPT.md either — that structure guarantees the next
`/start` re-surfaces them. See [[project-serpapi-capability-erosion]] and the
integrity-screener wiki topic for the PubPeer case.
