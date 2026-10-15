---
title: Post-presentation writeup regeneration rehearsal
kind: audit
domain: workbench
status: hosted-proof-blocked
summary: Sandbox rollups recalculated during the failed Factory check; missing pre-create evidence prevents validating the run. No application model calls occurred.
owner: product-engineering
last_verified: 2026-10-15
related:
  - docs/plans/POST_PRESENTATION_WRITEUP_REGENERATION_PLAN_2026-10-15.md
  - docs/audits/POST_PRESENTATION_WRITEUP_REGENERATION_IMPLEMENTATION_REVIEW_2026-10-15.md
---

# Scope and release boundary

Draft PR [486](https://github.com/justingallivan/wmkf-research-apps/pull/486),
`codex/writeup-regenerate`. No production data operations, schema changes, merge or
production promotion. The earlier Opus receipt remains source-review evidence.
This receipt records Mode A browser evidence, sandbox metadata, and partial authorized sandbox setup;
it does not establish hosted Dataverse/SharePoint replacement correctness.

## Isolated browser rehearsal

`node scripts/rehearse-writeup-regeneration-browser.js` bundles the actual
`StaffDeliberationsTab` with synthetic API responses and stubbed neighboring panels.
It loads no environment file, serves only loopback assets, and aborts non-loopback
browser requests before dispatch. The local component checks cover confirmation
copy, group-review sign-off/notice warnings, preserved previous-version URLs,
successor current URL, stable UUID on upload-failure retry, pending disablement,
and absence of regeneration in leadership review.

No real Word file, model, Dataverse changeset, Postgres ledger or email is exercised.
The browser fixture cannot prove refreshed Reviews prose, coauthoring retention,
atomic activation, delivery, or actual sign-off invalidation. Those still require
hosted proof; unit tests cover the corresponding service contracts.

## Read-only sandbox metadata

[VERIFIED via Luna's 2026-10-15 preflight output, summarized in
`/tmp/writeup-regeneration-sandbox-preflight.json`.] Registry-pinned sandbox host:
`orgd9e66399.crm.dynamics.com`; target interlock enabled; no writes.

| Command (with `--target=sandbox`) | Result |
|---|---|
| `node scripts/preflight-request-document-table.js` | 42 exact, 0 absent, 1 divergent: artifacttype options 100000010–100000012 differ from the branch specification; not an exact schema pass |
| `node scripts/preflight-pre-site-draft-schema.js` | 14 exact, 0 absent/divergent |
| `node scripts/preflight-final-writeup-schema.js` | 4 exact, 0 absent/divergent |
| `node scripts/preflight-final-writeup-review-acknowledgement-schema.mjs` | 11 exact, 0 absent/divergent; key Active |
| `node scripts/preflight-request-document-explicit-actor-schema.js` | 3 exact, 0 absent/divergent |

These checks establish metadata only, not write permissions or successful activation.
No schema repair was attempted.

## Hosted rehearsal prerequisite

[VERIFIED via source] `createPresiteSandboxDeps` is a copy-only Factory recipe:
model generation is a throwing sentinel, and the cloned Request lacks a real linked
project-leader Contact. Its injected seed identity cannot satisfy the actual route's
regeneration inputs. The staff-deliberations Factory runner is production-only and
was not run. The registered akoyaGO SharePoint site is shared, so sandbox Dataverse
alone does not isolate file operations. The initial preflight had no dedicated email
ledger; the later setup below provisioned one locally, without exercising delivery.

Before Mode C hosted rehearsal: establish a dedicated sandbox Request with linked
PI, complete inputs/narrative/reviews, authorized linked staff actor, exact current
Pre-Site/Final pointers for the selected stage, a distinct test folder/items, and
isolated durable email handling with controlled recipients. Verify deployment
resource targeting and permissions before mutations. Exercise drafting and group
replacement, submitted-review refresh, retained old file, fresh sign-offs, failed
upload/retry, and competing handoff/leadership activation. Keep this PR draft until
those results support deliberate owner promotion; never substitute production data.

## CI follow-up

The first full CI run at `0922265ffa232d77de560724923faed4b05b750c`
passed 1,379 suites and found four contract failures. Follow-up changes:

- Declare every generator dependency in the copy-only sandbox recipe, using a
  local clock, disabled actor readiness and throwing regeneration sentinels.
- Remove the unused public Pre-Site key re-export; retain its model-level test.
  Record the intentional live Final successor-preparation API in the facade contract.
- Permit only the two exact Final-service imports at the Pre-Site dependency
  composition point, preserving other domain fences and negative fixtures.
- Record regeneration's indirect email sender and the regarding-Request delivery
  isolation guard in the sender census.

Luna implemented; Sol and parent reviewed. Five affected suites / 161 tests pass;
scoped lint has zero errors (one existing unused-disable warning). DAL and Request
Document writer gates and their self-tests passed sequentially. Full CI subsequently
passed at `270269f625710c54047d28423d0dafee23fed9fd`: 1,383 suites / 23,822 tests,
plus 10 Postgres integration suites / 130 tests. That result predates the sandbox
harness additions below. A later `gh pr checks 486` read confirmed every reported
check passed at `8f6bdd6fc`, including Jest, Postgres integration, security scans
and Preview deployment; this does not establish live service correctness.


## Authorized sandbox setup and stop condition

[VERIFIED via private execution receipts and readbacks, 2026-10-15.] The owner
selected Justin Gallivan as lead Program Director and John Sader as reviewing
colleague, authorized sandbox role/audience setup, and allowed at most three
application provider attempts. No second human login was needed for the planned
service-level rehearsal. Agent reviews remain OAuth-only.

The existing `wave23-final-writeup-reviewer` role specification was applied to
those two enabled sandbox identities, with its six privileges verified. Missing
Research-program matrix and canonical handoff subject/body settings were seeded
and read back. These sandbox configuration changes remain in place. A separate
local Postgres 16 container, `wmkf-writeup-regen-pg`, on loopback port 55439 holds
the dedicated rehearsal database and local actor profile; existing application
and Factory databases were not used. No schema changes were made to Dataverse.

The first Factory create failed with the documented GoVerify remote-500 error;
readback confirmed no Request, folder, location, or email. A fresh manifest then
used the existing sandbox-only guarded GoVerify create-and-restore procedure.
The sole Request POST returned 201, and Request **1000365**, its unique empty
SharePoint folder, and its exact document location were created. The receipt
verified GoVerify restored and active. No payment or email rows were created.

The Factory nevertheless exited unsuccessfully: its final verification detected
a Foundation account version-number change, with an unchanged modification
timestamp and unchanged child Contacts. The Factory payload contains no account
or contact write. A bounded read-only audit query returned no account audit rows
in the window. Follow-up read-only Sandbox metadata/readback found eight
`SourceType=2` account rollups referencing `akoya_request`, all with recalculation
timestamps `2026-10-15T22:30:48Z` and healthy Calculated states. That is inside the
Factory observation window (`22:30:07.512Z`–`22:31:08.158Z`), after the Request
create and date-correction writes. Recalculation during verification is
**verified**; its being the only cause of the version change remains **unproven**.
No full pre-create account snapshot or digest was retained, so unrelated changes
cannot be excluded retrospectively. Sol reviewed this distinction against the
Sandbox comparison and the existing production transition contract. The guard
was not relaxed or rebased. Fixture completion and
all model-bearing service operations stopped. Request 1000365 and its empty
folder remain for inspection; no cleanup deletion occurred.

**Application provider attempts: 0 of 3.** No generated Word document, synthetic
PI/reviewer/schedule completion, group-review handoff, sign-off, or real email send
occurred in this service rehearsal. The prepared runner captures notices and
notifications, fences writes to the isolated fixture, records provider attempts
before dispatch, and refuses automatic replay after an interrupted run. These
are reviewed safeguards, not evidence that the live scenario passed.

Luna built the helpers and runner; Sol reviewed them, and parent reviewed the
final guards. The opt-in test was verified skipped by default; scoped lint and
DAL, reviewer-engagement, and Request Document writer gates plus their sequential
self-tests passed. The fixture helper requires a successful Factory verification
and verified restoration before any dependent write. See the
[setup record](../plans/WRITEUP_REGENERATION_SANDBOX_SETUP_2026-10-15.md) for scope.
The PR stays draft. The failed receipt cannot be promoted by taking a new
baseline after creation. The next proposed tooling change is to persist a full
pre-create account/Contacts baseline and evaluate a reviewed, narrow Sandbox
rollup transition alongside all existing checks. The current rollup count is 28
versus 33 total Foundation-applicant Requests; its filter must be understood
before proposing a count allowance. Do not import production GoVerify exemptions
or rerun either create merely to evade the failed guard. This investigation made
no external writes or provider calls; implementing and exercising that revised
verification remains outstanding.
