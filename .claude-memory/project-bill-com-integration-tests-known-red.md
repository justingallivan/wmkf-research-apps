---
name: project-bill-com-integration-tests-known-red
description: tests/unit/bill.test.js and tests/unit/discovery-verification-status.test.js are EXPECTED-RED (~29 failures, ReferenceError-class) from an unfinished bill.com integration — known/accepted, fires nightly on Vercel, NOT a regression to chase and NOT a check:* gate. Any full-suite failure OUTSIDE these two suites is real.
metadata:
  type: project
  status: active
  scope: global
  last_verified: S272 (2026-06-20) — owner confirmed: unfinished bill.com integration, fires nightly on Vercel
---

## Recall Rule

Read when `npm test` (full suite) shows failures, or when triaging the nightly
Vercel test run, before flagging/chasing/blocking on them.

## The fact (owner, S272)

- **`tests/unit/bill.test.js`** (BILL/honoraria vendor + network) and
  **`tests/unit/discovery-verification-status.test.js`** are **expected-red**: ~29
  failures, `ReferenceError`-class, caused by an **unfinished bill.com integration**.
  The owner is aware; it fires every night on Vercel. It is annoying but accepted —
  **do not investigate, bisect, or "fix" it** as if it were a fresh regression.
- These are **unit-test** failures, NOT `check:*` CI gates. The P0 gate rule
  ([[feedback-red-gates-are-p0]]) is about `check:*` gates, which are independent and
  should be green — do not conflate the two.
- **Expected-red set:** exactly these two suites. **Any full-suite failure outside
  `bill.test.js` / `discovery-verification-status.test.js` is real** and must be
  treated as such — don't let the known noise mask a genuine new break.

**Why:** S272 burned repeated cycles re-confirming and re-dismissing this red as
"pre-existing, unrelated" because nothing recorded that it's a known, accepted state
— the dismissal-without-memory loop. **How to apply:** when the full suite is red,
diff the failing suites against this expected set; if it's only these two, note
"expected-red (bill.com integration, see project-bill-com-integration-tests-known-red)"
and move on; otherwise the delta is the real signal. Revisit/retire this memory if
the bill.com integration is finished (the suites should then go green).
Related: [[feedback-green-requires-full-test-suite]], [[feedback-red-gates-are-p0]],
[[../docs/agent-wiki/topics/finance-honoraria]].
