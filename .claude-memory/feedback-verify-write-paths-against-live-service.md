---
name: feedback-verify-write-paths-against-live-service
description: "Mocked-boundary tests can't catch real service write-contract bugs (property casing, payload shape) — verify a new Dataverse write path with a real write or a metadata probe, not just code review + green mocks."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: abec04f6-7e77-489e-b52b-e14e75677c96
  last_verified: 2026-07-27 as a historical S304 production incident; current write contracts require a live probe or metadata evidence
---

## Recall Rule

Before declaring a new Dataverse write path live, verify its wire payload through
a real reversible write or current metadata plus parity with a known-working
payload; mocked service-boundary tests are insufficient.

A new Dataverse write path is not "done" because the unit/integration tests are
green — if those tests mock the service boundary, they validate your *intent*,
not the *contract*.

**S304 incident:** the Phase C review-question editor passed all unit + route +
component tests (17 + 10 + 6), each mocking `DynamicsService.executeChangeset`.
First real prod save returned **502**. The Vercel runtime log showed
`0x80048d19 ... property 'wmkf_Name' does not exist`. The bug: `writeBody` used
the *schema* name `wmkf_Name`; the Web API write payload needs the *logical*
(lowercase) name `wmkf_name`. The working seed already used `wmkf_name` — the
fix was 1:1 parity with the seed payload. The mocks accepted any key, so no test
could have caught it.

**Why:** Dataverse write contracts (logical-name casing, lookup `_x_value` URL
forms, statecode/statuscode pairs, alt-key vs row-id URLs) live in the *service*,
not in our code. A mock asserts what we send; it can't assert what Dataverse
accepts. Code review + green mocks give false confidence on exactly the part that
fails.

**How to apply:** before declaring a Dataverse write path live, do ONE of:
(a) exercise it for real once (a live write, then revert if needed), or
(b) confirm the payload against ground truth — a read-only **metadata probe** for
state/option values, and **byte-for-byte parity with a known-working payload**
(the seed) for property names/casing. Then add a regression assertion pinning the
exact wire keys (e.g. assert `wmkf_name` present, `wmkf_Name` absent). Relates to
[[feedback-behavior-claims-cite-the-producer]] and [[feedback-idempotency-name-the-mechanism]].
