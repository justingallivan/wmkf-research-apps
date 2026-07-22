---
name: project-reviewer-reliability-data
description: "Owner goal (S369) — capture whether a reviewer is \"good\" (on time, reliable) across cycles; the terminal withdrew/released status and stamped due date are its prerequisites."
status: active
metadata: 
  node_type: memory
  type: project
  last_verified: 2026-07-22 via aggregateReviewHistory, updateLifecycle, campaign-config-service, reviewer-modes
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
- **No terminal state for a post-accept dropout.** `REVIEW_STATUS_MAP` is
  `accepted → materials_sent → under_review → review_received → complete`.
  `withdrawn_sufficient` is hard-guarded to still-pending rows by
  `isStillPending()` in `lib/services/review-manager/withdraw-sufficient-service.js`
  (`wmkf_accepted !== true`), so it cannot express an accepted reviewer bailing.
- **On-time is not measurable durably yet.** `wmkf_reviewduedate` lives on
  `akoya_request` and is writable via `campaign-config-service.js`, so it is a
  mutable current value. Extending a deadline retroactively rewrites every
  timeliness verdict on that proposal.
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
`MODE_STATUSES`, and the label map together (`reviewer-modes.js` "no
fallthrough" invariant, enforced by `reviewer-modes.test.js` and
`check:status-enum-parity`), excluded from `MODE_WORK_REMAINING`, and must NOT
stamp the completion timestamps. Cross-layer + new durable column → use
`/contract-reconcile` and Atlas coverage. See [[reviewer-workbench-lifecycle]].
