# Atlas: `reviewer_reminder_events` (Postgres — per-reminder history)

**Status:** [SOURCE-BUILT on branch `claude/per-reminder-history`, 2026-11-03;
migration 095 NOT applied; not merged or deployed.] Plan and reviews:
`docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md`.

## Purpose

One row per reviewer reminder recorded, so the Activity history drawer can
show each reminder with its own date. The reviewer suggestion in Dataverse
keeps only the latest stamp of each kind (`wmkf_respondremindersentat`,
`wmkf_remindersentat`) and a review-due count (`wmkf_remindercount`); those
stay authoritative for eligibility, sending and counts. This table is history
only and never gates a send.

## Source of truth

- Schema: `lib/db/migrations/095_reviewer_reminder_events.sql`. Fresh installs
  apply it through the numbered migrations.
- Store: `lib/services/reviewer-engagement/reminder-events-store.js`, the only
  application reader and writer. Queries go through the Neon HTTP driver
  (`@neondatabase/serverless`) with a per-query abort signal, so each call is
  cancelled after 2 seconds; a request-local breaker skips further calls in
  that request after one failure. It never throws.
- Writers (all call `recordReminderEvent`, which writes only for invited rows):
  - `lib/services/reviewer-reminder-sweep.js` `sendOneReminder` — manual
    reminders (`reviewer-manual-reminder.js`) and the held daily cron. Written
    after the send attempt, on success or failure, with the same time as the
    claimed Dataverse stamp. A failed claim writes nothing.
  - `lib/services/reviewer-engagement/record-email-outcome.js`
    `recordDeliveredEmail` (`followup` only) — Review Manager's Follow-up
    reminder email, after its stamp/count write succeeds, at that send's time.
- Deleter: `scripts/reset-reviewer-for-testing.js` (test tool) deletes a test
  suggestion's rows when it resets that reviewer to never-invited.
- Reader: `lib/services/review-manager/reviewers-service.js` `getReviewers`
  adds `reminderHistory` to each reviewer (`null` when the read failed, `[]`
  when none) → `shared/components/reviewers/reviewer-activity-history.js`.

## Engagement scope

Rows survive the reviewer engagement reset (`ENGAGEMENT_STAMP_RESET` in
`lib/dataverse/adapters/reviewer-suggestion.js`). They stay inside one
engagement because they are written only for invited rows and both reset
paths (`restore`, staff re-select) refuse any invited row (since 2026-10-31).
The test reset tool is the one exception and clears the rows itself.

## Columns

| Column | Meaning |
| --- | --- |
| `id` | Row id. |
| `suggestion_id` | The reviewer suggestion (`wmkf_appreviewersuggestion`). |
| `request_id` | The request the suggestion belongs to. |
| `kind` | `respond` (please-respond nudge) or `review_due` (review reminder, including the Follow-up email). |
| `recorded_at` | When the reminder was recorded; equals the Dataverse stamp written with it. |
| `created_at` | Insert time. |

Unique on `(suggestion_id, kind, recorded_at)`; inserts use `ON CONFLICT DO
NOTHING`. Indexed on `suggestion_id`.

## Display rule

Per kind: one event per row; the current Dataverse stamp is also an event when
no row lies within one second of it (reminders from before this table, or a
failed history write); for review-due, a count above the dated events becomes
one undated line ("N earlier reminders recorded without a date"). No date is
derived from the count.

## Lifecycle and retention

No cleanup job: one small row per reminder. Test-request rows stay (test
residue is kept for data mining) and are read only by suggestion id.

## Tests

`tests/unit/reminder-events-store.test.js`,
`tests/unit/reminder-events-store-neon-abort.test.js` (real driver, aborted
fetch), `tests/integration/reviewer-reminder-events-store.pg.test.js` (real
Postgres in CI), plus history cases in `reviewer-reminder-sweep.test.js`,
`record-email-outcome.test.js`, `reviewers-service.test.js`,
`reviewer-activity-history.test.js` and `reviewer-activity-drawer.test.js`.
