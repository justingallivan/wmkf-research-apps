---
title: Reviewer Terminal Status and Dispatch Evidence
domain: engineering-process
kind: plan
status: active
summary: "Terminal post-accept reviewer statuses are live; design durable deadline evidence around Dynamics email activities before adding schema."
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

1. **Shipped slice:** terminal post-accept statuses `withdrew` and `released`.
2. **Deferred design:** deadline evidence based on a durable, ordered materials
   dispatch identity.
3. **Separate later feature:** completed-review payability disposition.

The HMAC materials-repair endpoint, due-date columns, and inline due-date stamp
are not part of the active slice. Git history preserves the discarded design;
this document owns the current boundary.

## Separate operational due-date override — production-live 2026-08-11

The later per-reviewer extension request is intentionally narrower than the
deferred reliability-evidence design below. Production Wave 18 implements one nullable DateOnly
`wmkf_appreviewersuggestion.wmkf_reviewduedateoverride`; null falls back to the
request date. The accepted-row Track Reviewers modal permits a non-null date
only when it is strictly after that request date (and current/future in the
Foundation-Pacific calendar), with no maximum. Its dedicated writer first
validates the admin body, Dynamics impersonation setting, assigned sender,
confirmed recipient, signature, and calendar. Confirmed engagement snapshot
name/email take precedence; legacy missing snapshot values fall back
field-by-field to the server-read linked reviewer person, while absence from
both sources still fails before the write. It then ETag-commits the change
and automatically dispatches the
fixed-subject message. Only an actual Dynamics dispatch failure leaves the date
saved without the notice. The open modal supports a server-fresh retry, and an
existing extension always offers Resend deadline email without another date
write. There is no durable notification-owed marker, so a failed restore send
still depends on the immediate retry affordance. The Invite surface and generic
candidate PATCH do not write the field. One shared resolver feeds staff
display, portal context, email/calendar copy, reminders, and token
mint/regeneration. Saving the override does not rotate a delivered token; the accepted-reviewer due + 90d window is
intentional through the Board meeting and exceeds ordinary roughly two-week
extensions. It is mutable operational state, not proof of the deadline
communicated in an ordered dispatch.

[VERIFIED via production create/publish/exact/runtime-select probes, the
non-clobbering `email.reviewer_extension.body` seed, main `8647af33`, Vercel
`dpl_AbTvWvMYb5inwPnYKTK2mkrkNXZz`, and live HTTP checks on 2026-08-11 /
2026-08-12 UTC] the field, setting, and runtime are production-live. This does
not change the deferred
append-only dispatch-evidence requirement in this plan.

[VERIFIED via the exact read-only production Request `1002788`/Test Homer row
probe, main `ccb7e0c8`, Vercel `dpl_DjRmd4axNpUUpHAo6ZmeoBgumxTe`, and live
HTTP checks] the legacy identity fallback is production-live. The first
signed-in attempt correctly made no deadline write. [VERIFIED via owner
production smoke on Request `1002788`] the retry saved the extension and
automatically delivered the deadline email. That received message exposed a
final copy defect (`Dear Test Homer,`). The admin body now requires
`{{greeting}}`, resolved through the shared reviewer honorific helper to
`Dear Dr. Homer,`; the live Dataverse setting was rebaselined to the same
source default. [VERIFIED via main `6526a934`, Vercel production deployment
`dpl_33KVRu3WmQhWBztd7RqDd2X6LBCr`, 610 suites / 7,717 tests, webpack build,
and live HTTP 200] the correction is production-live. The calendar update
contract remains test-covered; no second test email was sent for this
copy-only correction.

## Production release — 2026-07-24

[VERIFIED via the live metadata preflight and
`scripts/extend-reviewstatus-picklist-terminal.mjs`] Production Dataverse now
contains `withdrew=100000005` and `released=100000006`. Both insert operations
returned the exact requested `NewOptionValue`, `PublishAllXml` returned HTTP
204, and the post-publish metadata read returned both labels and values.

The schema prerequisite completed 2026-07-23. Runtime code shipped through PR
#78 plus the accepted/null-status repair in PR #79 / merge `fd610837` on
2026-07-24. A controlled production smoke reproduced
`wmkf_accepted=true` with persisted `wmkf_reviewstatus=null`, transitioned the
row to `Withdrew`, and read back token revoked with no received/completed stamp.
Workbench rendered `Withdrew` and `Revoked`.

## Problem solved by the shipped slice

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

## Shipped terminal-status contract

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

For `released`, the conditional write sets the terminal status and revokes the
external token atomically. For a PD-recorded `withdrew`, the same endpoint
performs the reviewer-withdrawal correction: one ETag-guarded Dataverse
changeset sets `accepted=false`, `declined=true`, the declined response type,
the `withdrew` audit status, and token revocation, while deleting the exact
server-read linked honorarium request. It then cancels unlocked acceptance jobs;
a leased worker re-reads declined state and compensates any honorarium it
created after the changeset. The ordinary staff flow does not request alternate
reviewer suggestions because the reviewer is not completing that form.

A concurrent review receipt wins by changing the ETag; the terminal transition
then reports `changed_skipped`.

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

This design requires a separate owner-reviewed schema plan and did not block the
terminal-status release.

## Verification and release record

Automated:

- terminal service/route predicate and partial-success tests;
- terminal → receipt race tests at every physical writer;
- portal, upload, status-map, reminder, rollup, and thank-you tests;
- upload 412 tests proving no delete is attempted;
- API matrix, Atlas, status parity, Dataverse boundary, docs, and type gates;
- production build.

Promotion:

- Tier 2 PRs #78 and #79 deliberately promoted to `main`;
- terminal picklist values were provisioned before runtime deployment;
- production deployment reached Ready at exact merge SHA `fd610837`;
- controlled invite/accept plus same-service production transition confirmed no
  review-received/completed timestamp and terminal exclusion from outstanding
  action state. That historical smoke preserved `accepted=true`; the subsequent
  staff-withdrawal cleanup deliberately corrects it to `accepted=false` /
  `declined=true` and shipped in merge `70f51f45`, production deployment
  `dpl_9r2FYkAXhRqSXiJVCwevrXFZ5SzH`, on 2026-07-24;
- Workbench showed `Withdrew` and `Revoked`;
- no due-date schema or repair endpoint was provisioned.

The browser controller could not resolve the native confirmation dialog, so the
signed-in production POST seam was not directly observed during the synthetic
smoke. Route integration tests passed. Prefer observing the next real staff
terminal action; do not create another synthetic reviewer solely for that
remaining route-level observation without an explicit owner request.

## Explicitly out of scope

- Deadline/reliability metric implementation.
- Historical correction of rows falsely marked complete.
- Payability disposition.
- Pre-accept reset.
- Any deletion of review-answer or historical engagement records. Exact linked
  honorarium deletion is now part of reviewer withdrawal because the reviewer
  will not complete the payable obligation.
