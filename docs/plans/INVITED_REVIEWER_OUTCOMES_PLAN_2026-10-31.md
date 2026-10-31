---
title: Invited reviewer outcomes plan
status: draft — owner review
created: 2026-10-31
owner: Justin (decisions); Claude (Session 655)
---

# Invited reviewer outcomes

## Goal (owner, 2026-10-31)

Every reviewer we actually invited ends with a recorded outcome, for tracking
and reliability. Candidates who were identified but never invited need no
outcome.

Owner-named outcomes:

1. Invited, never responded.
2. Accepted, then bowed out themselves (a reliability signal).
3. Recused because we have enough reviews.
4. Accepted but never submitted a review (ghosted).
5. Conflict of interest, including one discovered after accepting.
6. Other, as a catch-all.

## What exists today

[VERIFIED via `shared/config/reviewerLifecycle.js:11-42`, `lib/dataverse/adapters/reviewer-suggestion.js:104-110` (decline-reason picklist), `:2236-2258` (`applyStaffReviewerWithdrawal`), `:2453-2490` (`softDelete`)]

| Outcome | Recorded today as |
|---|---|
| 1 Never responded | `wmkf_responsetype` = No Response (daily stale sweep, or staff release) |
| 2 Accepted, bowed out | `wmkf_reviewstatus` = Withdrew, via "Record reviewer withdrawal" (`applyStaffReviewerWithdrawal`). The reason is hard-coded to `other` with fixed text, so staff cannot say why |
| 3 Enough reviews, before answering | `wmkf_responsetype` = Withdrawn – sufficient ("no longer needed" email) |
| 3 Enough reviews, after accepting | `wmkf_reviewstatus` = Released |
| 4 Ghosted | **No value.** The only option is Withdrew, which merges it with outcome 2 |
| 5 Conflict of interest | Only when the reviewer declines through the portal and picks it (`wmkf_declinereasonpicklist` = conflict-of-interest). No staff path sets it [VERIFIED: the picklist's only writers are `applyStage2aResponse`, called only from `lib/services/external-review/respond-service.js:320,449`, and the hard-coded `other` in `applyStaffReviewerWithdrawal`] |
| 6 Other | Same picklist (`other`) plus free text in `wmkf_declinereason`, reviewer-entered only |

**The gap behind the 29 removed D26 rows:** "Remove candidate" (`softDelete`)
works on invited reviewers and clears `wmkf_accepted`, `wmkf_declined`,
`wmkf_responsetype`, `wmkf_reviewstatus` and `wmkf_heldat`. The row then reads
as "invited, no answer". Its confirm text says review history is preserved
(`shared/components/reviewers/ReviewerManagePanel.js:669`), which is false for
the response. `softDelete`'s only caller is `deleteMyCandidates`
(`lib/services/reviewer-finder/my-candidates-service.js:913`).

## Proposal

1. **Remove is for candidates only.** `softDelete` refuses a row that was
   invited (`wmkf_invited` or `wmkf_emailsentat` set). The Remove control is
   hidden or disabled for those rows; the server guard is the authority. The
   confirm copy is corrected.
2. **Staff record an outcome instead.** One "Record outcome" action on an
   invited reviewer offers only the outcomes valid for that row's stage:
   - Not yet answered: Conflict of interest, Other (note required). Plus the
     existing "no longer needed" release, and No Response, which the sweep
     already sets.
   - Accepted, review outstanding: Reviewer withdrew, Did not submit, Conflict
     of interest, Other (note required). Plus the existing Released.
   Each writes the existing terminal shape (link revoked, honorarium handling
   as today) and keeps the reviewer's history.
3. **Who ended it is recorded.** Reliability needs "the reviewer bowed out"
   kept apart from "staff ended it". Withdrew and Did not submit are reviewer
   reliability outcomes; COI, Other and Released are not.
4. **Reporting.** Each outcome appears in exactly one bucket in staff counts,
   filters and the Track Reviewers view.

## Open decisions

- **A. Where "Did not submit" lives.** Either (a) a new `wmkf_reviewstatus`
  option, which is clearest for reports, or (b) Withdrew plus a new
  `wmkf_declinereasonpicklist` option. Both add one Dataverse choice value in
  Production (a schema change needing approval). Recommendation: (a).
  **Owner decision 2026-10-31: (a), a new `wmkf_reviewstatus` option.** The
  Production schema change itself still needs its own approval when built.
- **B. Staff-recorded COI/Other before acceptance.** Store it as a decline
  (`wmkf_responsetype` = Declined, picklist = conflict-of-interest/other, note
  in `wmkf_declinereason`) marked as staff-recorded, or as a new response
  type? Recommendation: decline plus marker. Needs a check of whether a
  staff/reviewer marker already exists.
  **Owner decision 2026-10-31: decline plus staff-recorded marker.**
- **C. Existing removed rows.** The 29 D26 rows lost their answers. Check
  whether Dataverse auditing kept the prior values before deciding on any
  repair. No backfill without a separate owner decision.
  **Checked 2026-10-31** [VERIFIED via owner-requested read-only Production
  probe `scripts/probe-d26-removed-audit-history.cjs`]: auditing is on for the
  organization and the table, and all 29 rows' change histories were readable
  (0 errors). Removals ran 2026-07-06 to 2026-09-02.
  - 20 rows had no answer to erase (invited, never answered, then removed).
  - 9 rows lost an answer, and the audit history holds it:
    - 7 "no longer needed" (`withdrawn_sufficient`); one of these was removed
      more than once and lost its answer at an earlier removal;
    - 2 accepted;
    - 1 accepted with materials sent (review status `materials_sent`).
  Repair is possible from the audit values. The 7 can be put back exactly. For
  the 3 accepted reviewers, the history says they accepted, not why they were
  removed, so their outcome needs the PD's word. Proposed: repair after the
  outcome build, using its outcomes. Not authorized yet.

## Not in scope

- Never-invited candidates: no outcome, and Remove keeps working as today.
- "Remove entirely" (permanent delete, `RemoveEntirelyModal`) is unchanged.

## Verification to do before building

- Every reader of `wmkf_reviewstatus`, `wmkf_responsetype` and
  `wmkf_declinereasonpicklist` (symbol fan-out), including
  `countAcceptedForRequest`, rollups, reminders, the stale sweep and Track
  Reviewers buckets.
- Every caller of `softDelete` and `deleteMyCandidates`.
- `/contract-reconcile` Mode A on this plan, then an independent review.
