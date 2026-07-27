---
name: project-bill-com-integration-tests-known-red
description: Closed historical exception. The two suites once recorded as expected-red are now green; do not suppress future failures in either suite.
metadata:
  type: project
  status: closed
  scope: global
  last_verified: 2026-07-26 — exact suites passed, 78/78 tests
---

## Closed finding

This file preserves the reason an old test exception existed. It is no longer an
always-read guardrail and must not be used to dismiss a current failure.

## Current fact

- On 2026-07-26, the exact two suites named by the former exception passed:
  **2/2 suites and 78/78 tests**.
- There is now **no expected-red exemption** for
  `tests/unit/bill.test.js` or
  `tests/unit/discovery-verification-status.test.js`.
- Any future failure in either suite is a current regression signal and receives
  normal investigation.

The historical exception was valid for the S272 point-in-time state, but retaining
it after the suites recovered created a more dangerous failure mode: a real
regression could be mislabeled as accepted noise.

Related: [[feedback-green-requires-full-test-suite]], [[feedback-red-gates-are-p0]],
[[../docs/agent-wiki/topics/finance-honoraria]].
