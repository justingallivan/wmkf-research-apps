---
name: feedback-no-time-pressure-commentary
description: "Do not editorialize about the user's available time (\"you're out of time\", \"since you're short on time\", \"given how long this has run\"). Present options/recommendations neutrally and let the user decide pacing."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: b7556be6-1734-49d3-a0e8-1a8029fd0df3
---

Never tell the user when they are (or might be) out of time, or frame
recommendations around their time pressure — even if they earlier said "I have a
few minutes." Phrases to avoid: "you're out of time", "since you're short on
time", "given how long this session has run", "this is a good stopping point
because…time…". Offering `/stop` or summarizing remaining work is fine; attaching
a time judgment to it is not.

**Why:** The user explicitly pushed back ("Don't tell me when I'm out of time.")
after I repeatedly prefaced suggestions with time commentary. It reads as
presumptuous — the user owns their own pacing and will say when to stop.

**How to apply:** Present status, options, and a recommendation neutrally
(e.g. "Want me to keep going or wrap up?" — not "You're out of time, want me to
wrap up?"). Recommend `/stop` on its merits (clean handoff, natural milestone),
never on an inferred time constraint. Related: [[feedback-no-performative-contrition]],
[[feedback-drive-to-completion]].
