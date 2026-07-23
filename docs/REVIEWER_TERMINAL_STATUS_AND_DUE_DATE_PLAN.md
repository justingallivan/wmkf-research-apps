---
title: Reviewer Terminal Status and Dispatch Evidence
domain: engineering-process
kind: plan
status: active
summary: "Ship terminal post-accept reviewer statuses independently; design durable deadline evidence around Dynamics email activities before adding schema."
canonical: false
cataloged: 2026-07-22
owner: product-engineering
related:
  - docs/CURRENT_WORK_QUEUE.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/dataverse-wmkf-appreviewersuggestion.md
  - docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md
  - docs/agent-wiki/topics/reviewer-workbench-lifecycle.md
---

# Reviewer Terminal Status and Dispatch Evidence

## Rework decision — 2026-07-23

The original S369 branch combined two business needs with recovery work across
Dataverse, email, and SharePoint. Four adversarial passes kept finding defects in
the materials-send repair protocol because its short-lived HMAC receipt did not
durably represent dispatch order or engagement generation.

The implementation is now split:

1. **Active slice:** terminal post-accept statuses `withdrew` and `released`.
2. **Deferred design:** deadline evidence based on a durable, ordered materials
   dispatch identity.
3. **Separate later feature:** completed-review payability disposition.

The HMAC materials-repair endpoint, due-date columns, and inline due-date stamp
are not part of the active slice. Git history preserves the discarded design;
this document owns the current boundary.

## Problem being solved now

[VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js`] A reviewer who
accepts and later does not deliver has no accurate terminal state. Marking that
row `complete` causes `updateLifecycle()` to stamp `wmkf_reviewreceivedat`.
`aggregateReviewHistory()` counts rows with that timestamp, so the workaround
records a false successful review.

The required semantics are:

- `withdrew`: reviewer ended the engagement after accepting.
- `released`: WMKF ended the engagement after accepting.
- neither status stamps `wmkf_reviewreceivedat` or `wmkf_completedat`;
- neither status is reopenable through ordinary UI or generic lifecycle APIs;
- terminal rows cannot submit a review, upload a review, or remain in outstanding
  work/reminder buckets.

## Active terminal-status contract

### Entry points

- `ReviewerManagePanel` offers confirmed, visually distinct actions only for
  eligible in-flight rows.
- `POST /api/review-manager/terminal-transition` is the only normal write seam
  for the terminal values.

### Persistence

- Extend the existing `wmkf_reviewstatus` picklist using
  `scripts/extend-reviewstatus-picklist-terminal.mjs`.
- The script must probe first, refuse collisions, assert the returned option
  value, publish, and verify. A schema wave cannot extend an existing picklist.
- No new Dataverse column is part of this slice.

### Server invariants

The transition service freshly reads each suggestion and requires:

- matching request ownership;
- `wmkf_accepted === true`;
- source status `accepted`, `materials_sent`, or `under_review`;
- no received/completed timestamp;
- a nonterminal source status;
- an ETag.

The conditional write sets the terminal status and revokes the external token
atomically. A concurrent review receipt wins by changing the ETag; the terminal
transition then reports `changed_skipped`.

`updateLifecycle()` separately refuses every status change out of a terminal
source and binds status-changing writes to its guard read's ETag. `softDelete()`
also refuses terminal rows so ordinary candidate removal cannot erase durable
engagement history.

### Review-receipt races

All physical review-receipt writers authorize from a fresh suggestion read and
carry that read's ETag into the parent PATCH/changeset:

- external structured submit;
- staff manual structured entry;
- mark received without a file;
- staff or reviewer file upload.

Uploads use a unique `attempt_<uuid>` SharePoint folder. A non-412 Dataverse
failure cleans up that attempt. A 412 means another lifecycle or receipt write
won, so the losing attempt is always orphaned and never deleted. Bounded storage
litter is the accepted fail-safe; winner-file inference is deliberately absent.

### Consumers

- Portal engagement derivation tests terminal values before numeric ordering.
- Upload and submit paths reject terminal rows explicitly.
- Track-mode maps include both values exactly once.
- Work-remaining and Outstanding exclude both.
- Reminder sweeps and completed rollups do not include either value.
- Thank-you sends never move a terminal row to `complete`.
- `check:status-enum-parity` enforces adapter ↔ service ↔ UI map parity.

## Deferred deadline-evidence design

[VERIFIED via `lib/services/dynamics/email.js`] Dynamics creates an email activity
before dispatch and `createAndSendEmail()` returns the durable `emailId`. The
discarded repair design invented a second proof channel and then tried to recover
ordering from mutable suggestion fields.

Before adding deadline schema, run a read-only metadata/source probe to determine
whether the Dynamics email activity can safely carry or expose:

- reviewer suggestion identity;
- engagement generation;
- communicated review due date;
- sent/failed state and durable send timestamp.

Preferred designs, in order:

1. Extend/query the existing Dynamics email activity as the append-only dispatch
   ledger.
2. If that cannot express the contract safely, add a small append-only review
   dispatch entity keyed to the email activity.

The future model must derive first/last communicated deadlines from ordered
dispatch records within one engagement generation. It must not rely on an
expiring repair receipt or two mutable fields as the source of truth.

This design requires a separate owner-reviewed schema plan and is not a blocker
for the terminal-status release.

## Verification and release boundary

Automated:

- terminal service/route predicate and partial-success tests;
- terminal → receipt race tests at every physical writer;
- portal, upload, status-map, reminder, rollup, and thank-you tests;
- upload 412 tests proving no delete is attempted;
- API matrix, Atlas, status parity, Dataverse boundary, docs, and type gates;
- production build.

Promotion:

- Tier 2 branch and deliberate promotion;
- provision terminal picklist values before deploying code that writes them;
- rehearse UI → route → service → Dataverse on an approved target;
- confirm the row has no review-received/completed timestamp and disappears from
  Outstanding;
- no due-date schema or repair endpoint is provisioned.

## Explicitly out of scope

- Deadline/reliability metric implementation.
- Historical correction of rows falsely marked complete.
- Payability disposition.
- Pre-accept reset.
- Any deletion of honorarium, review-answer, or historical engagement records.
