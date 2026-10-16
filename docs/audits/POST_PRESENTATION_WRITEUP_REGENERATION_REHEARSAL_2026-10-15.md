---
title: Post-presentation writeup regeneration rehearsal
kind: audit
domain: workbench
status: hosted-proof-blocked
summary: Isolated browser rehearsal and read-only sandbox schema checks; hosted write-path proof remains blocked on a complete isolated fixture.
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
This receipt adds Mode A browser evidence and read-only sandbox metadata evidence;
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
alone does not isolate file operations. No dedicated email ledger/delivery capture
was verified.

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
Document writer gates and their self-tests passed sequentially. Full CI reruns on
push; this receipt does not claim a pending run passed.
