---
name: feedback-first-time-correctness-over-rework
description: Justin optimizes for getting it right the first time over chasing/correcting errors later; upfront overhead on starts, stops, and commits (gates, verification, self-review) is welcome if it prevents downstream errors — do not trim it for speed.
metadata:
  type: feedback
  status: active
---

When working with Justin, prioritize **first-time correctness** over a fast-now /
fix-later cadence. He would rather pay upfront cost than spend time tracking down
and correcting errors afterward. Additional overhead on **starts, stops, and
commits** — CI gates, pre-flight verification, self-review, prevention mechanisms —
is **explicitly acceptable** to him when it pays off in fewer downstream errors.
Do NOT optimize that overhead away to save time.

**Why:** stated 2026-06-23 — "I am most interested in getting it right the first
time, rather than spending much more time tracking down errors and correcting them.
An additional overhead on starts, stops, and commits is not concerning to me if it
pays off in the long run." (Said while scoping a `check:doc-symbol-refs` gate to
prevent doc/memory staleness, where I'd hedged about gate overhead.)

**How to apply:**
- Bias toward **prevention over detection-and-fix.** When proposing a hardening
  mechanism, default to the thorough version (e.g. CI-on-push + `/start` backstop,
  not the lighter option); the overhead is wanted, not a cost to minimize.
- When weighing "quick path vs. verify-first," lean **verify-first** — he'd rather
  wait than redo. Front-load the verification (cite the producer, probe live state,
  self-review) before asserting or shipping.
- Don't pre-emptively trim checks, gates, or verification passes to look efficient;
  the time saved there is the time he does NOT want spent re-finding the error later.
- Reinforces [[feedback-thoroughness-default]],
  [[feedback-self-review-before-delegating-review]],
  [[feedback-behavior-claims-cite-the-producer]], [[feedback-falsify-not-confirm]].
