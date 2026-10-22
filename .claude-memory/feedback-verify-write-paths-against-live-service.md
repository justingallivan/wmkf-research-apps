---
name: feedback-verify-write-paths-against-live-service
description: "Mocked-boundary tests can't catch real service write-contract bugs (property casing, payload shape). Before live verification, establish an authorized target and named read/write scope; start with isolated Mode A checks; choose Mode C sandbox or Mode D controlled production only as needed, with explicit production authorization for Mode D and named records, expected writes, readback, and cleanup."
metadata: 
  node_type: memory
  type: feedback
  status: active
  originSessionId: abec04f6-7e77-489e-b52b-e14e75677c96
  last_verified: 2026-10-22 source/mode guidance clarified; S304 remains a historical 2026-07-27 production incident
---

## Recall Rule

Before declaring a new Dataverse write path live, establish the approved target,
operator authorization, and record-level read/write scope. Name the records,
fields, expected effects, readback, and exact cleanup or restoration before any
write. Start with Mode A isolation, then choose Mode C sandbox or Mode D
controlled production as needed under the release strategy. Mode D requires
explicit production authorization and that same named scope;
production credentials or a successful metadata read do not authorize a write.
Read-only metadata can establish schema or option values, and parity with a
known-working payload can check property names, but neither alone proves runtime
acceptance. Mocked service-boundary tests remain insufficient evidence of the
live wire contract.

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

**How to apply:** choose a verification mode only after the operator approves
the target and scope under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.
Use isolated Mode A checks first. In Mode C, use a designated sandbox record and
record the expected changes and exact cleanup. A Mode D production check requires
explicit production authorization, named records and fields, expected writes,
readback, and an exact cleanup/restoration path; never self-authorize production
reads or writes from available credentials. For schema or option-set questions,
a read-only metadata probe is evidence within its scope; for property casing,
compare with a known-working payload (such as the seed). Neither substitutes
for authorization or a runtime write when live acceptance is the claim. Then add
a regression assertion pinning the exact wire keys (e.g. assert `wmkf_name`
present, `wmkf_Name` absent). Relates to
[[feedback-behavior-claims-cite-the-producer]] and [[feedback-idempotency-name-the-mechanism]].
