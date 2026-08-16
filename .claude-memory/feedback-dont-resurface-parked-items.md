---
name: feedback-dont-resurface-parked-items
description: Items flagged "parked / do NOT proactively resurface" must be omitted from proactive startup and next-step summaries, even when SESSION_PROMPT.md lists them under Potential Next Steps.
metadata:
  type: feedback
  status: active
  scope: process
  last_verified: 2026-08-15 (S442) — rule reaffirmed after a parked intake launch prerequisite was promoted into an active-looking backlog summary
---

## Recall Rule

When preparing proactive startup or next-step summaries, omit parked or
externally gated items unless their recorded un-park condition has demonstrably
fired or the user asks about them.

**Current named instance (owner reaffirmed 2026-08-15):** the cancelled/parked
applicant-intake product and its conditional proxy-routing + CSRF launch
prerequisite. Do not list either as a security backlog item or next step merely
because an audit calls the fix mandatory *if the product launches*. Existing
`/apply` and `/api/intake/*` foundation code does not reactivate the product; only
an explicit owner decision does. See [[project-intake-portal-parked]].

When a carryover item is flagged **parked / externally gated / do NOT proactively
resurface**, do not echo it into any output I generate unprompted — including the
`/start` summary's "Potential Next Steps" list. Surface it only when the user asks
about it, or when its recorded un-park trigger demonstrably fires.

[VERIFIED historically via S256 owner feedback.] Any named parked item below is
an example from that incident, not a current-status claim; consult its current
memory or plan before acting.

**Why:** the whole point of the flag is that the item stays invisible until the
user (not the agent) recalls it. On 2026-06-13 (S256) I listed "PubPeer migration —
parked, do not resurface" in my startup Potential Next Steps; Justin had to ask what
it meant, which is precisely the attention-pull the flag exists to prevent. Echoing
a "do-not-resurface" item *is* resurfacing it — the proactivity, not the depth of
explanation, is what's prohibited.

**How to apply:** when summarizing next steps from SESSION_PROMPT.md, filter out any
entry tagged parked / do-not-resurface. If acknowledging that parked work exists is
useful, state only that there are N parked-and-gated items, not their content. In
the S256 PubPeer example, the recorded trigger was a sanctioned-API reply; current
triggers must be read from the item's current durable record. Don't carry such items *under* a "Potential Next
Steps" heading in SESSION_PROMPT.md either — that structure guarantees the next
`/start` re-surfaces them. See [[project-serpapi-capability-erosion]] and the
integrity-screener wiki topic for the PubPeer case.
