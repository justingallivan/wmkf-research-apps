---
name: feedback-green-requires-full-test-suite
description: "A test suite is not 'green' until a full `npm test` passes — targeted gates / subset runs miss stale suites"
metadata:
  node_type: memory
  type: feedback
  originSessionId: S261
  status: active
  scope: testing
---

## Recall Rule

Call only the executed subset green. Reserve “the test suite is green” for a
successful full `npm test`/Jest run, and report its suite/test totals.

Do not declare tests "green" (or a slice done) on the strength of targeted CI
gates or a subset `jest <path>` run. The full suite (`npm test` / `npx jest`) is
the only thing that proves it.

**Why:** S260 fixed one stale suite (`cycle-material`) after the S259 GUID guard
and declared it "the only stale suite among the 12" — a conclusion drawn from
running the targeted gates + that one suite, NOT a full `npm test`. Three more
integration suites (`send-emails-route`, `review-manager-token-routes`,
`cross-user-isolation`) had the same non-GUID-fixture breakage and sat red,
unnoticed, until S261 ran the whole suite (14 failures). The user flagged it:
"they happened yesterday too and your fix apparently didn't stick."

**How to apply:** Before saying tests pass / a change is safe to commit, run the
FULL `npx jest` and report the suite/test totals. When a cross-cutting change
(a new guard, a renamed export, a shared-helper edit) could touch fixtures
broadly, assume the blast radius is wider than the suite in front of you and let
the full run prove it. A subset pass is evidence about that subset only — never
generalize it to "green." See [[feedback-self-review-before-delegating-review]],
[[feedback-truncation-is-breakage-not-completion]].
