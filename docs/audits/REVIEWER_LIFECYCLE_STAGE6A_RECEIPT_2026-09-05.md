---
title: Reviewer Lifecycle Stage 6A — Explicit Status Mutation Outcomes
kind: audit
domain: reviewer-workbench
status: in-progress
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Stage 6A implementation receipt

Branch: `codex/reviewer-lifecycle-approved-policies`. Implementation is pending
Stage 1E's exit. The owner approved sequential stop on first failure and explicit
saved, failed and unattempted identities. A fresh planning review traced the
existing route/service/adapter/consumer and returned READY WITH NAMED CHANGES;
this is planning authority, not a completed implementation review.

## Surface and preimplementation invariants

Change: additive outcome arrays on the existing reviewer-status PATCH and its
single-reviewer UI consumer. Entry: `ReviewerManagePanel.updateStatus` and
`pages/api/review-manager/reviewers.js`. Persistence: existing Dataverse reviewer
suggestions via `patchReviewers` and `updateLifecycle`. Consumers: the existing
row action, parent refresh callbacks, service/route/rendered/composed tests and
source contracts. Prior finding: F5. No batch status-edit screen currently
exists in the inspected application callers; materials selection is separate.

| Invariant | Files likely touched | Verification |
|---|---|---|
| Entire raw batch validates and authorizes before any write | Existing reviewers route and authorization composition | Invalid/foreign later ID yields zero writes; existing error envelopes retained |
| Canonical unique batch targets retain first-occurrence order | Reviewers service | Trim/case duplicates, unique count and failure after duplicates |
| One nonempty-batch discriminator controls precheck and execution | Reviewers service | Empty-array single fallback still enforces dedicated closeout/terminal endpoint policy |
| Sequential awaited writes stop at first rejection | Reviewers service and real adapter composition | Suspended first write, first/middle/last failure, no later read/write/replay |
| Outcomes describe the exact confirmed prefix, uncertain attempt and untouched suffix | Service error carrier and route | Exact arrays and persisted rows, including commit-then-response-loss |
| Pre-write errors and sanitized 200/500 behavior remain intact | Route | Auth/validation errors have no outcomes; raw 412 still maps to existing 500; development-only details |
| Any outcome key requires the complete protocol and matching submitted identities | Actual ManagePanel handler | Missing keys, malformed/duplicate/foreign IDs, ordering and HTTP/body contradictions fail unconfirmed |
| Confirmed saves and uncertain outcomes are visible without automatic replay | Existing row action | Returned identity, refresh only on confirmed save, distinct refresh failure and no second PATCH |
| All Stage 1E operation ownership and stale-feedback guards survive | ManagePanel and rendered tests | Duplicate calls, deferred JSON, context away/back, row removal, unmount and callback failure |

## Planned contract

Success retains HTTP 200 and `success:true`, adding `savedIds`, `failedIds:[]`
and `notAttemptedIds:[]`. An attempted adapter failure retains sanitized HTTP
500 and adds `success:false` with the resolved prefix in `savedIds`, exactly
one attempted but unconfirmed `failedIds` element, and the remaining suffix in
`notAttemptedIds`. A narrow internal error carrier preserves the original cause.
Existing pre-write typed errors remain outside this attempted-write envelope.

The consumer must distinguish legacy responses with no outcome keys from the
new protocol. Any present key requires all three arrays, strict success/HTTP
consistency and an exact ordered partition of submitted GUID identities.
Malformed responses never establish saved outcomes. The current single-item
action rejects other-row results; no new batch screen or selection contract is
introduced. Confirmed save and refresh failure remain separate.

## Limits and validation status

Implementation, red/green regressions, full tests, sequential gates, webpack
build and fresh frozen-code review are pending. Planning probes used extracted
current source with in-memory stubs, not live persistence or integration proof.

Failed means attempted and unconfirmed: a write may have committed before its
response was lost. Complete response loss reveals no server partition. No
rollback, automatic replay, durable idempotency or enforced cross-tab reload
lock is claimed. Whole-batch authorization does not lock later Request ownership.
The existing status-only adapter's missing-version behavior is unchanged by
this scope. Host callbacks do not certify successful fresh reads. No live
Dataverse/email/cron/schema operation, public push, main merge or deployment is
authorized by this local implementation.
