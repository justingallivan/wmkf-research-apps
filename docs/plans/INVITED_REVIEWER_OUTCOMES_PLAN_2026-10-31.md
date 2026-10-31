---
title: Invited reviewer outcomes plan
status: decisions final; build contract written after third review
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

## Second independent review (2026-10-31)

Codex adversarial review of the revised plan (verdict: needs-attention); each
finding spot-checked against source:

1. **Decision E as taken breaks re-acceptance.** Withdrew (100000005) is above
   materials_sent (100000001), so `respond-service.js:225-231` refuses a later
   accept as `materials_sent_locked`, and `canFlipState` turns false
   (`review-engagement-state.js:53-55`). The accept branch does not clear
   `wmkf_reviewstatus` (`reviewer-suggestion.js:2177-2185`). Claude found the
   same independently. E is reopened below.
2. **A "staff-recorded" yes/no cannot tell the outcomes apart.** A staff-
   recorded reviewer withdrawal and a staff-ended Other would store the same
   values. The column must record who *initiated* the ending, not who typed
   it.
3. **The audit probe missed erasures on already-unselected rows** (a decline
   later erased by removal). Fixed by detecting cleared answer fields from
   paired old/new values; a fixture reproduces the case. Rerun result
   unchanged: 19/10 (decision C).
4. **Decision D leaves live callers pointing at Restore.** Manual re-add
   returns `restore_required` (`reviewer-suggestion.js:1004-1012`),
   `manual-reviewer-service.js:289-292` tells staff to restore from Removed,
   and "Reset & restore" (`ReviewerInvitePanel.js:829-859`) is the existing
   way to re-invite an auto-archived decline. These are in D's scope.

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
4. **Who ended it** is one new choice column, "Ended by", set by every
   outcome writer to the initiator, not the person typing (see revised B/E):
   Reviewer before accepting, Reviewer after accepting, or the Foundation. No
   existing column records it [VERIFIED: no actor or source column among the
   suggestion fields in `lib/dataverse/core/entity-registry.js`]. Every
   writer and correction path states whether it sets or clears it; a portal
   re-accept clears it in the same atomic payload that already clears the
   decline fields (`reviewer-suggestion.js:2183-2185`).
5. **Reporting** reads outcome history separately from active workload: an
   outcome query and DTO covering unselected invited rows, for the single
   proposal and cross-proposal views. One classification precedence across
   response, review status, reason and marker places every row in exactly one
   bucket, the rollup included. Tests use archived outcome rows, not only
   enum parity.

## Third independent review and build contract (2026-10-31)

Codex adversarial review round 3 (verdict: needs-attention) found the design
settled but the contract underspecified: identical stored outcomes, no full
writer/correction matrix, no materials cutoff for revised E, and no precise
"recorded outcome" predicate for D. Owner rules taken in response
(2026-10-31):

- **A conflict of interest is not a reliability mark**, even after accepting.
- **A lapsed invitation has a blank "Ended by"**; neither side acted, and the
  No Response response type already records it.
- **Who typed the outcome is deliberately not stored.** "Ended by" records who
  initiated; the Dataverse audit log already records the user who wrote it.

The tables below supersede the per-outcome table in "Proposal (revised)".

### Stored values per outcome

| Outcome | Response | Review status | Reason picklist | Ended by |
|---|---|---|---|---|
| Reviewer declines in portal, before accepting | Declined | unchanged | reviewer's pick | Reviewer before accepting |
| Reviewer declines in portal after accepting (pre-materials) | Declined | unchanged | reviewer's pick | Reviewer after accepting |
| Staff: reviewer withdrew after accepting | Declined | Withdrew | staff pick, not COI | Reviewer after accepting |
| Staff: COI after accepting | Declined | Withdrew | conflict-of-interest | staff picks Reviewer after accepting or Foundation |
| Staff: Other after accepting | Declined | Withdrew | other + required note | staff picks |
| Staff: did not submit | Declined | Did not submit (new) | none | Reviewer after accepting |
| Staff: COI before answering | Declined | unchanged | conflict-of-interest | staff picks Reviewer before accepting or Foundation |
| Staff: Other before answering | Declined | unchanged | other + required note | staff picks |
| Enough reviews, before answering | Withdrawn – sufficient | unchanged | none | Foundation |
| Enough reviews, after accepting | unchanged | Released | none | Foundation |
| No response (sweep or staff release) | No Response | unchanged | none | blank |

**Reliability mark** = Ended by "Reviewer after accepting" with a reason other
than conflict-of-interest, or review status Did not submit.

**Report buckets** (exactly one per row, in this order): review received or
completed → Did not submit → Withdrew/Declined with Ended by → Released →
Withdrawn – sufficient → No Response → accepted/held/pending. Rows with no
"Ended by" written before this build (legacy) bucket on response and status
alone, and never count as reliability marks.

### Writer and correction matrix

| Writer | Ended by |
|---|---|
| `applyStage2aResponse` decline | Set before/after accepting from the same fresh row whose ETag binds the write (`respond-service.js` already reads it at :221 and passes `ifMatch`); the adapter takes the value, it does not infer it |
| `applyStage2aResponse` accept | Cleared in the same payload that clears the decline fields (`reviewer-suggestion.js:2183-2185`) |
| `applyStaffReviewerWithdrawal` | Takes reason, note and Ended by from the staff choice (today hard-coded `other`) |
| New did-not-submit writer | Reviewer after accepting; own adapter function, honorarium as withdrawal, job cancellation, late-honorarium compensation; never falls through to Released (`terminal-transition.js:355-373` gets an explicit branch per status) |
| New pre-answer outcome writer (COI / Other) | Staff choice |
| `applyStaffReviewerRelease` | Foundation |
| `withdrawPendingInvitation` | no_longer_needed → Foundation; no_response → explicit blank |
| `expireInvitation` (stale sweep) | Explicit blank |
| `correctResponse` | May move a pre-materials Declined row back to Accepted (the staff mirror of portal re-accept), clearing Ended by atomically. Refused: clearing the invited flag or sent time on a contacted row, and any other change to an answer that ended the engagement (Declined, No Response, no longer needed). **Narrowed in build (slice 2, 2026-10-31):** additive corrections stay allowed, e.g. Accepted on a row whose review already arrived, which the existing correction contract deliberately supports; terminal statuses were already refused by `isInvitationCorrectionSourceRow`. A decline may be corrected to Accepted from any open status, not only pre-materials: later it repairs a decline contradicted by delivered materials or a received review, which the existing contract supports (**owner confirmed 2026-10-31**) |
| `correct-status.js` → `updateLifecycle` | Refused on a row with a recorded outcome; the closed-source guard (`reviewer-suggestion.js:2026-2047`) gains the outcome predicate |
| Restore / manual re-select (`ENGAGEMENT_STAMP_RESET`) | Refused on a row with a recorded outcome (decision D) |
| `reviewer-merge.js` | Copies person fields, not engagement outcomes; its engagement-signal predicate and adapter projection include Ended by |
| Remove entirely | Deletes the row (an authorized exception that permits a later re-add); the removal audit snapshot (`remove-candidate-service.js:334-363`) adds Ended by, reason and status |

Propagation: `entity-registry.js`, the adapter `FIELD_SELECT` lists, the
token-verifier select (`verify-suggestion-token.js`), the DTO mappers and the
Dataverse export workbook.

### "Recorded outcome" predicate (decision D)

One server-side function. A row has a recorded outcome when any of these
holds: Ended by is set; response is Declined, No Response or Withdrawn –
sufficient; `wmkf_declined` is true; review status is terminal (Withdrew,
Released, Did not submit); `wmkf_reviewreceivedat` or `wmkf_completedat` is
set. Accepted or Held with none of these is not ended. This covers legacy
outcomes written before the column existed.

Applied at: both re-add branches that return `restore_required`
(`reviewer-suggestion.js:1004-1012`, `:1071-1082`), applicant promotion
(`promote-applicant-reviewer-service.js:375-387`), `restore`, and every
Removed-list control (Restore and Reset & restore, `ReviewerInvitePanel.js:829-859`).
Those producers return a new `reinvite_unavailable` code with a plain message
instead of `restore_required`; consumers updated: `manual-reviewer-service.js:280-292`,
`ReviewerFindPanel.js:416,700-706`, `ReviewersTab.js:355`,
`ReviewerManagePanel.js:219-225`, `reviewer-institution-measurement.js:62`.

**Exception:** a reviewer re-accepting their own pre-materials decline through
the portal is not a staff re-invitation and stays allowed.

### Materials cutoff for revised E

The cutoff between reversible acceptance and materials release is the
**materials release claim** (`reviewer_materials_releases`, #562), not the
later materials_sent status.

- Portal decline or re-accept: refused as "materials released, contact your
  Program Director" when a release row exists in any state other than
  `failed` (claimed, link_minted, sent, recorded, uncertain).
- Automatic release: already mints with the row's ETag
  (`reviewer-acceptance-drain.js:803-807`). A decline that commits first makes
  the mint fail, the release is marked failed, and the drain's terminal check
  sees Declined. A mint that commits first changes the ETag, so the decline
  re-reads, finds the claim and is refused.
- Manual send: today it checks acceptance (`send-emails-service.js:728-792`)
  and later mints without `ifMatch` (`:1205`). The build re-reads after
  its claim and mints with that ETag, so a decline in between wins and the
  send is skipped. **This gap is live in Production today**; the window is
  seconds.
- Re-accept after a failed release: allowed; the next release retakes the
  failed row (#562 behavior).
- The PD withdrawal notice (`reviewer-withdrawal.js:96-99`) states release
  state from the claim, not an assumption.
- Interleaving tests for both senders: decline before mint, mint before
  decline, decline during an uncertain send.

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
  **Superseded 2026-10-31 by the second review:** the marker becomes the
  "Ended by" choice column (initiator), proposal item 4. Still a second
  schema change alongside A's choice value.
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
  **Owner decision 2026-10-31: (a), refuse; re-invitation gets its own explicit path.**
- **E. Portal accept-then-decline.** ~~Write Withdrew on that branch~~
  (owner decision 2026-10-31, **reopened**: it would block re-acceptance,
  second review finding 1). Revised recommendation: the branch leaves review
  status alone and writes "Ended by = Reviewer after accepting"; a re-accept
  clears it. Re-acceptance keeps working, and reports still count it as a
  reviewer withdrawal.
  **Owner decision 2026-10-31: confirmed, including the "Ended by" column
  (Reviewer before accepting / Reviewer after accepting / Foundation).**
- **D scope (second review finding 4).** Refusing Restore for outcome rows
  also changes the `restore_required` producer, the re-add remedy text and the
  Removed list's "Reset & restore". Open question: does staff ever re-invite a
  reviewer who declined, on the same proposal? If not, re-invitation becomes
  unavailable with a clear message. If so, it needs a history-preserving path.
  **Owner decision 2026-10-31: staff never or almost never re-invite on the
  same proposal. Re-invitation becomes unavailable for rows with a recorded
  outcome: the `restore_required` producer and re-add remedy return a clear
  message, and "Reset & restore" is removed for those rows.**

## Not in scope

- Never-invited candidates: no outcome, and Remove keeps working as today.
- "Remove entirely" (permanent delete, `RemoveEntirelyModal`) is unchanged.

## Verification to do before building

- Every reader of `wmkf_reviewstatus`, `wmkf_responsetype` and
  `wmkf_declinereasonpicklist` (symbol fan-out), including
  `countAcceptedForRequest`, rollups, reminders, the stale sweep and Track
  Reviewers buckets.
- Every caller of `softDelete` and `deleteMyCandidates`.
- `/contract-reconcile` Mode A and three Codex adversarial rounds: done
  2026-10-31 (findings above). The build contract above is the reviewed
  baseline; code review covers the rest.

## Production schema rollout and test (owner decision 2026-10-31: test in Production)

**Status 2026-10-31:** steps 1–3 done by the owner. Ended by created
(preflight `EXACT` / `READABLE` after about two minutes of metadata lag; the
first re-check right after the create still said `ABSENT`). Did not submit
inserted as 100000007 (`NewOptionValue` 100000007), published, verified.
Step 4 done (owner browser check: a D26 request's Review Manager reviewer list loads normally). Step 5 done: request 1003125 (marked test request), row `b50501d3-9675-f111-ab0f-000d3a3065b8` (accepted, no status) took Ended by = Foundation and Did not submit, read back from the write response, and was restored and verified (`null`/`null`); no recovery record left. The sandbox has neither change.

**Step 5 finding, a slice 3 requirement:** with Did not submit set, Track
Reviewers showed the row as plain "Accepted" (the unknown status falls back to
the accepted flag), Ended by appeared nowhere, and "Release proposal to
reviewers (3)" still counted the row. Slice 3/4 must show the status, and take
Did not submit rows out of the release count and eligibility, reminders and
the accepted-count totals.

**Test venue (owner, 2026-10-31):** slices 3–5 are tested in Production on
marked test requests, not the sandbox, which will not get the Wave 35 schema.

**Slice 3 split (2026-10-31):** 3a, Did not submit end to end (terminal
status, `applyStaffReviewerDidNotSubmit`, explicit `terminal-transition.js`
branch with a throwing `else`, Track Reviewers action, `did_not_submit` DTO
mapping that closes the step 5 finding). 3b, Ended by on the other writers per
the matrix, the pre-answer COI/Other writer, portal decline/re-accept, and
`wmkf_endedby` in selects/DTOs (selects before the outcome predicate). 3c, the
materials cutoff with interleaving tests. Build choice in 3a: Did not submit
keeps `wmkf_responsereceivedat` (the acceptance time) instead of restamping it
as the withdrawal does. Owner decision (2026-10-31): staff-ended Withdrew and
Did not submit reviewers stay visible on Track Reviewers (single proposal) as
ended rows; previously a withdrawn reviewer vanished from Track.

**Honoraria (owner decision 2026-10-31, after the Production test):** staff-
recorded Withdrew and Did not submit keep the linked honorarium request and
mark it Withdrawn (the release path's rule and checks), instead of deleting
it; the acceptance worker's late-honorarium cleanup does the same for those
rows. A reviewer's own portal decline before materials still deletes. Track
shows "Saving…" on the row while an End engagement write is in flight (one
with an honorarium took ~20s in Production).

**Production check (2026-10-31, test request 1003125, read-only lookups with
owner OK):** row `bb5787d7` recorded Did not submit at 23:52:50 UTC; its
honorarium `1530402a` still exists, now `Withdrawn` with
`wmkf_datewithdrawalreceived` 23:52:50, unpaid and unauthorized; the link is
retained. Saving… showed and the row refreshed on its own. History shows no
dated entry for the outcome until the Ended at field exists.

Both schema changes are additive and no runtime code reads or writes them
until slice 3. Each step below is owner-run or explicitly owner-approved;
steps 2, 3 and 5 also need that day's `DATAVERSE_PROD_WRITE_ACK`. Every
script goes through `lib/dataverse/client.js` (target interlock) and refuses a
Production run unless `DATAVERSE_TARGET_INTERLOCK=on` and
`DATAVERSE_ALLOW_PROD_READS=yes` (`scripts/lib/dataverse-script-target.cjs`).

1. **Read-only check before.** `node scripts/preflight-reviewer-outcomes-schema.mjs --target=prod`
   should print `ABSENT` / `RUNTIME_SELECT: UNAVAILABLE`;
   `node scripts/extend-reviewstatus-picklist-did-not-submit.mjs --target=prod`
   (preview by default) should list the current options and "Would add
   100000007: Did not submit".
2. **Ended by.** `node scripts/apply-dataverse-schema.js --target=prod --wave=35-reviewer-outcomes`
   (dry run), then the same with `--execute`. Re-run the preflight: `EXACT` /
   `READABLE`. A second `--execute` reports `exists`.
3. **Did not submit.** Re-run the picklist script with `--execute`. It inserts
   the option, publishes only `wmkf_appreviewersuggestion` (`PublishXml`) and
   re-reads it. A second run is a no-op.
4. **Nothing broke.** Review Manager and the reviewer list for a live request
   still load.
5. **Round trip on one test row.**
   `node scripts/roundtrip-reviewer-outcomes-test-row.mjs --target=prod --suggestion=<guid>`
   previews; `--execute --pause` writes Ended by = Foundation and Did not
   submit (ETag-bound), reads them back, waits while staff check that request
   in Review Manager (how today's screens show Did not submit before slice 3),
   then restores both original values and verifies them. The restore is bound
   to the version the test write returned, so any other change in between
   stops it instead of overwriting. It refuses any row whose request is not a
   marked test request, saves a recovery record under `outputs/` before
   writing (`--recover` restores from it while the row still holds exactly the
   test values on the same test request), caps the pause at 10 minutes, and
   will not start within 20 minutes of UTC midnight, when the ACK expires. Dataverse
   auditing keeps a record of both writes on that row.

Rollback: deleting the new field or option is safe only while no row holds a
value in it.
