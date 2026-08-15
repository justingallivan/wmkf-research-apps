---
name: feedback-apply-measurement-artifacts-in-both-directions
description: When you identify an artifact in a measurement method, apply the correction to EVERY metric it touches — including the ones that make your thesis look worse — before publishing.
metadata:
  type: feedback
  status: active
---

## Recall Rule

Read before publishing benchmark, audit, safety, recall, or error-rate numbers
when any known artifact changes how outcomes are counted.

When you discover that a measurement method has a known weakness, correct for it
in **both** directions. Check specifically whether it also distorts the metric
that would *undercut* your conclusion — not only the one you noticed because it
depressed a number you wanted higher.

**Why:** S406, ROR comparator. `[VERIFIED via
benchmarks/fuzzy-matching-falsification/README.md and
benchmarks/fuzzy-matching-falsification/baseline/ror-chosen-2026-08-07.md]`
The falsification harness judges by exact string
match. I documented that weakness explicitly, then corrected for it only where it
understated ROR's *recall* ("27/47 as judged, 30/47 artifact-corrected"). I never
applied it to the *safety* count — where the identical artifact was hiding 6
unsafe resolutions, because ROR returned "University of California San Diego" and
the banned list held "University of California, San Diego". Published "40
attributable wrong-entity resolutions"; the true figure was 44 attributable / 64
end-to-end. A Codex adversarial review caught it. A one-directional artifact
correction is worse than no correction: it launders a known bias into an
apparently-rigorous number, and it reliably runs in the direction the author's
thesis prefers.

**How to apply:** after naming any measurement artifact, enumerate every metric
derived from that measurement and state, per metric, whether the artifact applies.
Prefer deriving metrics from **result semantics** over string/format matching
(here: "expected `review`, actual `resolved`" instead of counting VETO strings).
When a correction moves a number in your favor, treat that as the trigger to hunt
for the same artifact in the numbers that would move against you. Related:
[[feedback-vacuous-clean-results-print-the-denominator]],
[[feedback-author-adversarial-pass-first]],
[[feedback-dont-self-certify-convergence]].
