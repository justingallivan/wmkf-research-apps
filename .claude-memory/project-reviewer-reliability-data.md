---
name: project-reviewer-reliability-data
description: "Owner goal (S369) — capture whether a reviewer is \"good\" (on time, reliable) across cycles; the terminal withdrew/released status and stamped due date are its prerequisites."
status: active
metadata: 
  node_type: memory
  type: project
  last_verified: 2026-07-22 via terminal-transition-service, send-emails-service, reviewer-modes, status-enum-parity
  originSessionId: a7559eb5-34f5-41fd-b0cb-f1a84da8d8d0
---

## Recall Rule

Read before scoping reviewer lifecycle status, closeout, review-history display,
or any reviewer-quality metric. Design discussion is DEFERRED to its own session
(owner, 2026-07-22) — do not build the metric opportunistically alongside
unrelated reviewer work.

Owner goal (Justin, S369, 2026-07-22): WMKF wants durable data on reviewer
quality — **are they on time and reliable?** — not just participation counts.
This is a program, not a field; it was not previously recorded in any doc or
queue.

## Verified state, 2026-07-22

- **A person-level track record already exists but is numerator-only.**
  `aggregateReviewHistory()` (`lib/dataverse/adapters/reviewer-suggestion.js`,
  S308) counts rows per person across all requests with filter
  `wmkf_reviewreceivedat ne null`, returning `reviewCount` / `lastReviewAt`;
  surfaced as `priorReviewCount` / `lastReviewAt` by
  `lib/services/reviewer-finder/my-candidates-service.js` (its only consumer).
  A denominator IS derivable — `wmkf_accepted` sits on the engagement row — but
  **`accepted && reviewreceivedat == null` cannot distinguish a dropout from an
  engagement still legitimately in flight.** That disambiguation is what the
  terminal status supplies; it is not a missing count.
- **The current workaround corrupts the dataset.** `updateLifecycle()` stamps
  `wmkf_reviewreceivedat` (and `wmkf_completedat`) on any transition to
  `reviewStatus=complete` when empty. A PD clearing a dropout by marking it
  complete therefore writes a permanent false positive into that person's review
  count, in every future cycle. `complete` is not the only badge-clearing action
  (`review_received` also leaves `MODE_WORK_REMAINING` without stamping, and the
  row remove is a `softDelete` that adjudicates nothing) — but it is the only
  terminal-looking one, so it is the natural choice and the silent trap. Worst
  deliverers are the most likely to be misrecorded as reliable.
- **No LIVE terminal state for a post-accept dropout; implementation is authored but not provisioned.** The feature branch extends `REVIEW_STATUS_MAP` with
  `withdrew`/`released`, adds a dedicated fresh-read/ETag transition service, and
  excludes both from work-remaining. The live Dataverse option set still ends at
  `complete`; the owner-gated picklist script and both Wave 14 due-date columns have
  deliberately not been run.
  `withdrawn_sufficient` is hard-guarded to still-pending rows by
  `isStillPending()` in `lib/services/review-manager/withdraw-sufficient-service.js`
  (`wmkf_accepted !== true`), so it cannot express an accepted reviewer bailing.
- **On-time is not measurable durably in production yet.** `wmkf_reviewduedate` lives on
  `akoya_request` and is writable via `campaign-config-service.js`, so it is a
  mutable current value. The feature branch authors a DateOnly
  `wmkf_reviewduedateatsend` / `wmkf_reviewduedatelastsent` fields and inline
  ETag-guarded set-once/every-send writers, but the columns are not provisioned.
  Extending a deadline therefore still
  retroactively rewrites every live timeliness verdict on that proposal.
- Signals already captured per engagement that feed the metric:
  `wmkf_responsereceivedat` (invite responsiveness), `wmkf_remindercount`
  (chasing required), `wmkf_proposalfirstaccessed` (engagement),
  `wmkf_reviewreceivedat` (delivery).

## Owner decisions, 2026-07-22

1. **Split the terminal status: `withdrew` vs `released`.** Reviewer-initiated
   bail counts against reliability; PD standing them down post-accept (enough
   reviews arrived) must be neutral. Collapsing them would penalize reviewers for
   WMKF's own scheduling — worse than no data. Mirrors the pre-accept
   `withdrawn_sufficient` distinction.
2. **Stamp the effective due date onto the engagement row** (at materials-sent)
   so each engagement carries the deadline it was actually held to. Decided up
   front because the history is unrecoverable otherwise.

**Why:** the reliability metric is the point; the status change is its
prerequisite and also stops an active data-integrity leak. Neither the terminal
status nor the stamped due date can be retrofitted onto history.

**How to apply:** build the terminal status ahead of the payability flag in
[[project-reviewer-closeout-payability]] — it is smaller, unblocks the metric,
and halts the corruption. A new status must be added to `STATUS_PIPELINE`,
`MODE_STATUSES`, and the label map together, excluded from
`MODE_WORK_REMAINING`, and must NOT stamp the completion timestamps.
**[VERIFIED 2026-07-22 on the feature branch] The no-fallthrough invariant is
now gate-enforced:** `check:status-enum-parity` compares
`REVIEW_STATUS_MAP` ⇔ `STATUS_PIPELINE` and `REVIEW_STATUS_MAP` ⇔
`REVIEW_STATUS_BY_VALUE`; `reviewer-modes.test.js` points at the service that
owns the inverse map. **Both policy residuals were RESOLVED by the owner
2026-07-22 and implemented:** (1) terminal is irreversible — the source-state
guard lives in `updateLifecycle`, not the route, so the unguarded batch PATCH
path inherits it; a terminal row refuses any status change while non-status
writes still succeed. Correcting a mistaken terminal transition is a data-repair
operation, not a UI affordance. (2) Two DateOnly columns are provisioned rather
than one — `wmkf_ReviewDueDateAtSend` (set once, the deadline first committed
to) and `wmkf_ReviewDueDateLastSent` (overwritten each send, the deadline last
communicated) — because a set-once stamp alone marks a reviewer late whenever
WMKF extended the deadline and re-sent, which is the same principle that split
`withdrew` from `released`. The repair route's former different-date 409 is gone;
`atSend` is structurally immutable instead. Cross-layer + new durable column uses
`/contract-reconcile` and Atlas coverage. See [[reviewer-workbench-lifecycle]].

**[VERIFIED 2026-07-23 on the feature branch] Repair is idempotent per signed
dispatch, not per row version.** The exact key is the HMAC-verified
`(suggestionId, materialsSentAt, effectiveReviewDueDate)` tuple. A durable exact
match returns `already_recorded` (including a concurrent 412 loser after
re-read), an older receipt is rejected, and a newer signed dispatch advances
`lastSent` using the current ETag while preserving set-once `atSend`. The signed
nonce and pre-dispatch ETag remain receipt evidence; no new persistence was
added because the tuple is already represented by the suggestion id plus
`wmkf_materialssentat` and `wmkf_reviewduedatelastsent`.

**[VERIFIED 2026-07-23 on the feature branch] Review uploads are attempt-owned.**
Each attempt uses a unique SharePoint `attempt_<uuid>` subfolder and persists
that exact folder on the winning row. A 412 loser rolls back only its attempt
and excludes item ids visible in the winner's persisted folder, so Graph
replace/shared-identity behavior cannot delete the winner's downloadable file.
