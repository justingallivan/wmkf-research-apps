# Per-reminder history for reviewer follow-up

Status: **PLAN — NOT BUILT; OWNER DECISIONS D1–D3 OPEN.** Session 662,
Claude, 2026-11-03, plan written on `claude/per-reminder-history-plan` from
`main` `a66e09091`. Queue entry: `docs/CURRENT_WORK_QUEUE.md` item 7
"Per-reminder audit trail for reviewer follow-up (Activity history)" (J27 item,
plan-first with `/contract-reconcile`). Origin:
`docs/plans/REVIEWER_FOLLOW_UP_POLISH_HANDOFF_2026-09-06.md:23`.

## Problem

The reviewer's Activity history drawer shows at most one dated reminder of each
kind plus "N reminders recorded in total"
[VERIFIED via `shared/components/reviewers/reviewer-activity-history.js:481-483`].
That is because the reviewer suggestion row in Dataverse keeps only:

- `wmkf_respondremindersentat`: latest "please respond" nudge, overwritten on
  each re-send and cleared on every invitation
  [VERIFIED via `lib/services/reviewer-engagement/record-invitation.js:24-41`];
- `wmkf_remindersentat` + `wmkf_remindercount`: latest review-due reminder and
  a running count.

Earlier reminder dates are overwritten and cannot be recovered. The queue entry
forbids reading `reminderCount` as evidence of individual dates.

**Met when** (from the queue): each reminder sent appears as its own dated event
in the drawer, backed by durable rows, with the existing count preserved for
older reviewers.

## Current state

### Who writes a reminder stamp today

| # | Path | Kind | Order | Source |
| --- | --- | --- | --- | --- |
| W1 | Manual reminder (Invite tab respond nudge, Reviews tab review-due reminder) via `sendOneReminder` | respond, review-due | claim, then send | `lib/services/reviewer-manual-reminder.js:5-9`; `lib/services/reviewer-reminder-sweep.js:435-458` |
| W2 | Daily cron via the same `sendOneReminder` | respond, review-due | claim, then send | `lib/services/reviewer-reminder-sweep.js:142-240`. **Held:** no schedule in `vercel.json` [VERIFIED via grep, 0 hits] |
| W3 | Review Manager "Follow-up reminder" template email, bookkeeping after delivery | review-due (count + stamp) | send, then record | `lib/services/reviewer-engagement/record-email-outcome.js:33-89`, called from `lib/services/review-manager/send-emails-service.js:131`; template offered in `shared/components/reviewers/EmailTemplatesModal.js:19` |

W1/W2 write the Dataverse marker with an ETag guard **before** sending
(at-most-once). A failed send leaves the marker in place; the drawer already
labels these events "Recorded; send not confirmed"
[VERIFIED via `reviewer-activity-history.js:15-22`, `:174`].

W3 retries the conditional write up to three times and keeps a newer existing
stamp if one landed meanwhile, but always increments the count
[VERIFIED via `record-email-outcome.js:65-82`].

### How the drawer gets its data

The drawer is built from the reviewer row already in memory: "no fetch, no
route, and no loading state" (owner decisions 2026-08-12)
[VERIFIED via `shared/components/reviewers/ReviewerActivityDrawer.js:1-15`].
The row comes from `getReviewers` (`lib/services/review-manager/reviewers-service.js:198`,
DTO fields at `:397-427`) through `GET /api/review-manager/reviewers`
(`pages/api/review-manager/reviewers.js:83`).

### The engagement fence

The drawer only shows events from the reviewer's **current** engagement. Every
event timestamp is a stamp in `ENGAGEMENT_STAMP_RESET_ENTRIES`, so a
remove-and-re-add clears it [VERIFIED via `reviewer-activity-history.js:44-48`;
`lib/dataverse/adapters/reviewer-suggestion.js:940-965`]. Rows in a new table
would survive that reset, so the plan needs its own fence (below).

## Proposed design

### 1. One new Postgres table (D1)

`reviewer_reminder_events`, one row per reminder recorded:

```sql
CREATE TABLE IF NOT EXISTS reviewer_reminder_events (
  id BIGSERIAL PRIMARY KEY,
  suggestion_id UUID NOT NULL,
  request_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('respond', 'review_due')),
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (suggestion_id, kind, recorded_at)
);
CREATE INDEX IF NOT EXISTS reviewer_reminder_events_suggestion
  ON reviewer_reminder_events (suggestion_id);
```

- `recorded_at` is the **same** timestamp written to the Dataverse stamp in that
  write (W1/W2: `nowIso`; W3: the delivery `sentAt`), so a row and the current
  stamp can be matched.
- No send outcome, actor or source columns. They are not needed for dated
  entries; see Non-goals.
- Precedent: `reviewer_materials_releases` (migration 091) is a Postgres table
  keyed by `suggestion_id` for the same reviewer engagement
  [VERIFIED via `lib/db/migrations/091_reviewer_materials_releases.sql:1-27`].

**D1 — where the rows live (recommendation: Postgres table above).** Alternative
A: a new Dataverse child entity of the reviewer suggestion. That needs a
Dynamics schema change through Connor, a new adapter and DAL registration, and a
per-reviewer query in the list. Alternative B: read the Dynamics email
activities instead. Rejected: they are attached to the request, not the reviewer
suggestion [VERIFIED via `reviewer-reminder-sweep.js:496-497`], so matching
would rely on recipient address and editable subjects.

### 2. Write rules

- **W1/W2 (`sendOneReminder`).** Insert the row **after** the Dataverse claim
  succeeds and **before** the send. A 412 or other claim failure writes no row,
  so no phantom entry. If the insert fails, log it and still send. The
  reminder is the deliverable; the drawer's count line (rule 4 below) shows the
  gap honestly for review-due. One edit covers manual and cron sends.
- **W3 (follow-up email).** Insert the row inside `recordDeliveredEmail`'s
  `followup` branch, only after `updateLifecycle` succeeds, with
  `recorded_at = sentAt`. When the bookkeeping write throws (row closed, binding
  changed, three 412s), no row is written. That matches the count, which also
  does not increment. Insert failure: log, do not throw (the email already went
  out).
- Inserts use `ON CONFLICT DO NOTHING` on the unique key.
- A new small store module, `lib/services/reviewer-engagement/reminder-events-store.js`
  (insert + batch read), mirrors `materials-release-store.js`.

### 3. Engagement fence (D2)

**Recommendation:** a row is in scope only when `recorded_at >= emailSentAt` of
the current row; when `emailSentAt` is empty, no rows are in scope.

- A re-added reviewer has `emailSentAt` cleared and later set by the new
  invitation, so rows from the earlier engagement fall before it and drop out.
- A re-sent invitation also moves `emailSentAt` forward, hiding respond
  reminders from the earlier invitation round. That matches today: every
  invitation already clears `respondReminderSentAt`.
- **[ASSUMED, verify at build]** An invitation cannot be re-sent to a reviewer
  who already accepted. The UI offers re-invite only on repair targets
  (`shared/components/reviewers/ReviewerInvitePanel.js:797-806`). The server's
  duplicate guard checks only `invited`, not the response
  (`lib/utils/reviewer-invite.js:24-26`). If the server allows it, an accepted
  reviewer's review-due rows would be hidden after such a re-send. Fallback
  if that path is reachable: fence review-due rows on `responseReceivedAt`
  (also a reset stamp) instead, after confirming every acceptance path sets it.

Alternative: an explicit engagement id on the suggestion row. That needs a new
Dataverse column and a writer at every reset site; not recommended.

### 4. Display rule

`getReviewers` adds `reminderHistory` to each reviewer row:

- `null` when the read failed (fail-soft, like `fetchAnswersBySuggestion` at
  `reviewers-service.js:39`): the drawer behaves exactly as today.
- `[]` when no rows exist.
- Otherwise `[{ kind, recordedAt }]`, already filtered by the fence (rule 3) on
  the server.

One query per listing: `WHERE suggestion_id = ANY($1)` over the rows the
listing already returns, so test-request visibility
(`test-requests/isolation.js`, imported at `reviewers-service.js:57`) is
inherited, not re-decided.

In `reviewer-activity-history.js`, per kind:

1. One "reminder recorded" event per in-scope row, each with its own date and
   the existing "Recorded; send not confirmed" note.
2. The current Dataverse stamp is also shown as an event when no row matches it
   (a reminder sent before this change, or an insert that failed). Match at
   whole-second precision. **[ASSUMED]** Dataverse may drop milliseconds from
   stored times; the build confirms with one readback.
3. Review-due only: let C be `reminderCount` and E the number of review-due
   events from steps 1–2. If C > E, add one undated line: "N earlier reminders
   recorded without a date". No date is ever invented from the count. If
   E ≥ C, no line.
4. Respond reminders have no count, so steps 1–2 only.

**D3 — load with the list (recommendation) vs. fetch on open.** Loading the rows
with the reviewer list keeps the recorded "no fetch, no loading state" drawer
decision and avoids a new API route (security matrix, `check:api-routes`,
canonical route counts). Alternative: fetch when the drawer opens. That reverses
the 2026-08-12 decision and adds a route, a loading state and an error state.

### 5. Parked cron-ledger branch

`origin/feature/reviewer-cron-reminders-ledger` (owner-parked 2026-08-27, last
commit `059e51f92`) rewrites `reviewer-reminder-sweep.js` and the cron route
[VERIFIED via `git diff --stat`]. If it is ever promoted, its plan
(`docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` items 7–10) must keep the W1/W2 insert
or cron reminders stop getting dated entries. This plan adds that note to the
queue's parked item. It does not build toward that branch.

## Non-goals

- Turning the automatic cron on, or promoting the parked cron-ledger branch.
- Changing reminder eligibility, counts, stamps or any send behavior.
- Backfilling earlier reminders from Dynamics email activities.
- Showing per-reminder send outcome (sent / failed). The existing "Recorded;
  send not confirmed" wording stays. Adding outcomes would need a second write
  after each send; ask separately if wanted.
- A cleanup job. Like migration 091, rows are small, one per reminder; test
  request rows stay (they are kept for data mining) and are only read by
  suggestion id.

## Tests

- **Store:** insert, `ON CONFLICT DO NOTHING`, batch read, fence filter.
- **W1/W2:** a successful claim writes exactly one row with the claim's
  timestamp; a 412 writes none; an insert failure still sends.
- **W3:** a recorded follow-up writes one row with `sentAt`; a closed row or
  binding change writes none; an insert failure does not throw.
- **DTO:** `reminderHistory` is `null` on read failure, `[]` on no rows; rows
  before `emailSentAt` are excluded.
- **Drawer:** three rows give three dated events; a pre-change reviewer with
  count 2 and one stamp gives one dated event plus "1 earlier reminder recorded
  without a date"; `null` history matches today's output exactly; a stamp
  matching a row is not shown twice.

## Durable surfaces

- Migration `095_reviewer_reminder_events.sql` (the number is **[ASSUMED]**
  free; recheck open branches at build) and `npm run prebuild` for the manifest.
- `scripts/setup-database.js`: follow the migration 091 precedent, which is not
  in it [VERIFIED via grep].
- Atlas: new `docs/atlas/postgres-reviewer-reminder-events.md`, a row in
  `docs/atlas/postgres-infra-tables.md` (091 has one [VERIFIED via grep]),
  `check:atlas`.
- `docs/SERVICE_AND_UTILITY_CATALOG.md` entry and source header for the store.
- Header comments in `reviewer-activity-history.js` (the engagement fence now
  has an exception) and `ReviewerActivityDrawer.js`.
- Agent wiki `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
- No new API route: `docs/API_ROUTE_SECURITY_MATRIX.md` unchanged.

## Release and proof

Tier 2 under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`: a branch,
characterization tests first, PR with CI green, owner decision to merge.

1. Apply the migration in Production with `node scripts/apply-migrations.js`
   before merging. If the table is missing, inserts are logged and skipped and
   the drawer falls back to today's display, so order mistakes do not break
   sends.
2. Proof on an agreed test request, owner-present: send one manual review-due
   reminder, then a second; the drawer shows two dated entries. Open a reviewer
   reminded before the change; the drawer shows its stamp and, if the count is
   higher, the undated line.
3. The cron stays held throughout.

## Contract review (Session 662, Mode A)

**Surface.** Caller: staff reminder actions and the follow-up template email →
`sendOneReminder` / `recordDeliveredEmail` → new Postgres table → `getReviewers`
DTO → drawer.

| Audit | Result |
| --- | --- |
| 1 Whole-flow | All three writers (W1–W3) and the one reader (`getReviewers` → drawer) traced above. `my-candidates-service.js:304` also projects `respondReminderSentAt` but does not feed the drawer [VERIFIED via grep: the drawer is imported only by `ReviewerManagePanel.js:33`]. |
| 2 Partial success | Unit of success is one reminder. Rows are written only after the Dataverse write succeeds; insert failure never blocks or fails a send; the count line absorbs a missed review-due row. |
| 3 Async / stale state | N/A for the drawer: it is unmounted on any row mutation (`ReviewerActivityDrawer.js:12-14`). Server writes are sequential within one send. |
| 4 Helper extraction | The store only inserts and reads; it must not decide eligibility or replace the Dataverse claim, which stays the at-most-once guard. |
| 5 Durable surfaces | Listed above. No route, so `check:api-routes` and route counts are unaffected. |
| 6 Doc reconcile | Queue item 7, the 2026-09-06 handoff note, the drawer header, Atlas, wiki: at build. |
| 7 Symbol fan-out | New `kind` values `respond` / `review_due` are read only by the drawer's per-kind rule; an unknown kind is ignored (allowlist). Reviewer merge cannot move rows: merges are blocked when the losing record has any reminder stamp (`lib/services/reviewer-merge.js:35-38`). |

**Verdict: READY WITH NAMED CHANGES** once D1–D3 are decided. Named checks for
the build: confirm whether an accepted reviewer can be re-invited (fence, rule
3); confirm Dataverse timestamp precision (display rule 2); recheck the free
migration number.

## Scope

- Code: one migration, one small store module, two insert sites, one batch read
  in `getReviewers`, and the drawer's reminder rule.
- Tests: about five files, mostly extending existing ones.
- Docs: Atlas page, catalog entry, two component headers, wiki, queue.
- External: a Production migration apply and an owner-present test-request
  proof. No Dynamics schema change, no new route, no change to who receives
  reminders.
