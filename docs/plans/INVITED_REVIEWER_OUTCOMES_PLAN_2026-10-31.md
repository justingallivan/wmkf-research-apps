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
| 2 Accepted, bowed out | Two different shapes. (i) Staff "Record reviewer withdrawal" (`applyStaffReviewerWithdrawal`, `reviewer-suggestion.js:2236-2258`): `wmkf_reviewstatus` = Withdrew, reason hard-coded to `other`. (ii) The reviewer declines through the portal after accepting, before materials (`respond-service.js:295-361` → `applyStage2aResponse` decline branch): response Declined, no Withdrew status; the service treats it as a withdrawal (cancels acceptance jobs, notifies the PD) but nothing on the row says they had accepted. So Withdrew identifies only the staff path |
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

## Independent review (2026-10-31)

Claude whole-flow review plus a Codex adversarial review (verdict:
needs-attention). Accepted findings, each spot-checked against source:

1. **Removal is not the only eraser.** Restore and manual re-selection apply
   `ENGAGEMENT_STAMP_RESET` (`reviewer-suggestion.js:929-969`, restore at
   `:2508-2535`; "Reset & restore" in `ReviewerInvitePanel.js:829-859`). They
   clear invitation stamps, response, terminal status and timestamps, so any
   recorded outcome on an unselected row can still be wiped.
2. **Outcome rows drop out of Track Reviewers.** Withdrawal and decline set
   `wmkf_selected=false`; `getReviewers` reads selected rows only and keeps
   accepted or review-received ones (`reviewers-service.js:214-222`). New
   labels alone cannot show them. The rollup gives Declined precedence over
   terminal status (`reviewer-rollup.js:109-111`), so a withdrawal-shaped "Did
   not submit" would count as Declined.
3. **No single terminal shape to reuse.** `terminal-transition.js:355-373`
   sends every non-Withdrew status to `applyStaffReviewerRelease`, so a bare
   new enum value would be written as Released. Withdrawal deletes the
   honorarium and clears acceptance; release keeps acceptance and withdraws an
   open honorarium. The acceptance drain recognizes only Declined or Released
   as terminal (`reviewer-acceptance-drain.js:1006-1023`).
4. **Portal self-withdrawal exists** (table row 2 (ii)).
5. **The first audit probe missed earlier removals and the plan miscounted.**
   Fixed; see decision C.

## Proposal (revised)

1. **Remove is for candidates only.** `softDelete` refuses a row with
   `wmkf_invited` or `wmkf_emailsentat` set. Both invitation writers set the
   two together, after a real send or a staff-recorded manual link
   (`record-invitation.js:23-44`), so "invited" means contacted. The control
   is hidden for those rows, the server guard is the authority, and the
   confirm copy is corrected.
2. **Resets keep the outcome.** Restore and manual re-selection must not erase
   an invited row's outcome. Decision D chooses how.
3. **One outcome shape per outcome**, each written by its own explicit adapter
   function with a defined honorarium disposition, acceptance-job
   cancellation and late-honorarium compensation (the existing
   `reviewer-withdrawal.js` helpers), plus a race test against a leased drain
   worker. No outcome falls through to Released.

   | Outcome | Stage | Response / status written | Reason | Who | Honorarium |
   |---|---|---|---|---|---|
   | Reviewer withdrew | accepted | Declined / Withdrew | picklist (staff picks) | reviewer | delete linked (as today) |
   | Did not submit | accepted | Declined / **Did not submit** (new) | none | reviewer | delete linked |
   | Conflict of interest | accepted | Declined / Withdrew | conflict-of-interest | staff picks who | delete linked |
   | Other | accepted | Declined / Withdrew | other + required note | staff | delete linked |
   | Conflict of interest | not yet answered | Declined | conflict-of-interest | staff (marker) | none exists |
   | Other | not yet answered | Declined | other + required note | staff (marker) | none exists |
   | Enough reviews | either | unchanged (existing release paths) | none | staff | unchanged |
   | No response | not yet answered | unchanged (sweep) | none | reviewer | none |

   Portal accept-then-decline also records that the reviewer had accepted
   (decision E), so it reads as a reviewer withdrawal.
4. **Who ended it** is a new yes/no column marking a staff-recorded outcome,
   following the `wmkf_reviewuploadedbystaff` precedent. No existing column
   records it [VERIFIED: no actor or source column among the suggestion
   fields in `lib/dataverse/core/entity-registry.js`]. A later acceptance
   through the portal clears it, as that branch already clears the decline
   fields (`reviewer-suggestion.js:2183-2185`).
5. **Reporting** reads outcome history separately from active workload: an
   outcome query and DTO covering unselected invited rows, for the single
   proposal and cross-proposal views. One classification precedence across
   response, review status, reason and marker places every row in exactly one
   bucket, the rollup included. Tests use archived outcome rows, not only
   enum parity.

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
  The staff marker is a new column, a second schema change alongside A's
  choice value.
- **C. Existing removed rows.** Checked 2026-10-31 [VERIFIED via the
  owner-requested read-only Production probe
  `scripts/probe-d26-removed-audit-history.cjs`, corrected after review to
  scan every erasing removal and exclude the reviewer's own declines]:
  auditing is on for the organization and the table; all 29 histories read
  with 0 errors and no further pages.
  - 19 rows had nothing to erase (invited, never answered, then removed).
  - 10 rows lost an answer, each in a single removal between 2026-07-06 and
    2026-09-02: 7 "no longer needed" (`withdrawn_sufficient`), 2 accepted, 1
    accepted with materials sent.
  The audit values make repair possible. The 7 can be restored exactly. The 3
  accepted reviewers' outcomes need the PD's word. Before any repair: a
  per-row manifest with audit evidence and current-state preconditions,
  separately authorized. Proposed timing: after the outcome build.
- **D. How resets keep the outcome.** (a) Refuse Restore and re-selection for
  a row with a recorded outcome; inviting the same person to the same request
  again then needs an explicit path. (b) Allow them, but first copy the prior
  outcome somewhere durable. Recommendation: (a), the simpler of the two;
  re-inviting someone who already answered is rare.
- **E. Portal accept-then-decline.** Record that the reviewer had accepted
  (Withdrew status) so it counts as a reviewer withdrawal, keeping their
  ability to change their mind before materials. Recommendation: write
  Withdrew on that branch.

## Not in scope

- Never-invited candidates: no outcome, and Remove keeps working as today.
- "Remove entirely" (permanent delete, `RemoveEntirelyModal`) is unchanged.

## Verification to do before building

- Every reader of `wmkf_reviewstatus`, `wmkf_responsetype` and
  `wmkf_declinereasonpicklist` (symbol fan-out), including
  `countAcceptedForRequest`, rollups, reminders, the stale sweep and Track
  Reviewers buckets.
- Every caller of `softDelete` and `deleteMyCandidates`.
- `/contract-reconcile` Mode A and the Codex adversarial review: done
  2026-10-31 (findings above). Re-review the revised plan before building.
