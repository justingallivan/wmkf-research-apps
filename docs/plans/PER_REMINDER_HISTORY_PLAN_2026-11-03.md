# Per-reminder history for reviewer follow-up

Status: **PLAN — NOT BUILT; OWNER DECISIONS D1–D3 TAKEN 2026-11-03; REVISED
SAME DAY AFTER TWO CODEX ADVERSARIAL REVIEWS (D2 rule replaced, see §3 — owner
to confirm); THIRD CODEX REVIEW APPROVED THE PLAN.** Session 662,
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
survive that reset, so §3 states why they cannot cross engagements.

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

**D1 — where the rows live. [OWNER DECISION 2026-11-03: Postgres table above.]** Alternative
A: a new Dataverse child entity of the reviewer suggestion. That needs a
Dynamics schema change through Connor, a new adapter and DAL registration, and a
per-reviewer query in the list. Alternative B: read the Dynamics email
activities instead. Rejected: they are attached to the request, not the reviewer
suggestion [VERIFIED via `reviewer-reminder-sweep.js:496-497`], so matching
would rely on recipient address and editable subjects.

### 2. Write rules

- **W1/W2 (`sendOneReminder`).** Write the row only after the Dataverse claim
  succeeds, and only **after the send attempt** (in both the success and the
  failure branch, since the claim already happened). A 412 or other claim
  failure writes no row, so no phantom entry. The history write is never on
  the path to the email: a slow or failed database cannot stop a reminder that
  has already been claimed (Codex review finding 2; the claim is never rolled
  back, `reviewer-reminder-sweep.js:442-458`, `:503-505`). One edit covers
  manual and cron sends.
- **W3 (follow-up email).** Write the row inside `recordDeliveredEmail`'s
  `followup` branch, only after `updateLifecycle` succeeds, with
  `recorded_at = sentAt`. When the bookkeeping write throws (row closed, binding
  changed, three 412s), no row is written. That matches the count, which also
  does not increment. The email has already gone out by then.
- **Invited rows only.** The store's insert takes the suggestion row the
  writer already holds and writes nothing unless `isInvitedRow(row)` is true
  (`shared/utils/reviewer-engagement-policy.js:119-122`: invited flag or an
  invitation date). This one gate covers every writer, including a follow-up
  email sent to a never-invited candidate, which the send path allows today
  (Codex review 2, finding 1: the accepted-only guard at
  `send-emails-service.js:749` covers materials, not follow-ups, and
  `record-email-outcome.js:26-28` accepts an empty status). Such a send still
  increments the count as today; it just leaves no dated row, so §3's
  invariant holds. The row passed must carry `wmkf_invited` and
  `wmkf_emailsentat`: `recordDeliveredEmail`'s `fresh` row does (registry
  select, `lib/dataverse/core/entity-registry.js:143-146`); the manual reminder
  select does (`reviewer-manual-reminder.js:58-76`); the two sweep selects
  (`reviewer-reminder-sweep.js:154`, `:254`) gain the missing fields.
  `isInvitedRow` throws on a row missing those fields, which the build treats
  as a test failure, not a skip.
- **Bounded, fail-soft, cancelled.** Every history insert and the listing read
  are bounded at 2 seconds (a code constant), and the bound cancels the work
  rather than just abandoning the wait (Codex review 2, finding 2):
  - The store issues its queries through the Neon HTTP driver the app already
    ships (`@neondatabase/serverless` 0.9.5 under `@vercel/postgres` 0.10.0)
    with a per-query `fetchOptions.signal` of `AbortSignal.timeout(2000)`.
    **[ASSUMED, verify at build]** per-query `fetchOptions` are honored
    (`node_modules/@neondatabase/serverless/index.mjs:1536-1540` merges them;
    the build proves an aborted query rejects and its fetch is torn down). If
    not, the build stops and reports rather than shipping a wait-only bound.
  - A per-invocation circuit breaker: after the first history timeout or error,
    the rest of that invocation (a sweep batch, a listing) skips history calls
    and logs one summary line. At most one cancelled call per invocation, so a
    database outage cannot pile up requests.
  - Database-side: the insert is a single-row `INSERT … ON CONFLICT DO NOTHING`
    and the read a single indexed `SELECT`; neither takes long-held locks. A
    cancelled insert may still commit on the server; that is a true record of a
    claimed reminder, so the outcome stays "unknown, fine either way".
  - On timeout or error the insert caller logs and carries on, and the read
    returns `null`.
- Inserts use `ON CONFLICT DO NOTHING` on the unique key.
- A new small store module, `lib/services/reviewer-engagement/reminder-events-store.js`
  (insert + batch read), mirrors `materials-release-store.js`.
- **W4 (test tool).** `scripts/reset-reviewer-for-testing.js` resets an invited
  test reviewer to never-invited, clearing all three reminder fields
  (`:70-82`). With `--commit` it must also delete that suggestion's history
  rows, alongside the child rows it already deletes, so a reused test reviewer
  starts with empty history.

### 3. Engagement fence (D2)

**[REVISED 2026-11-03 after Codex review; owner to confirm.]** The first rule
(rows count only from the current invitation date) is withdrawn. Codex showed
Review Manager can re-send an invitation to a reviewer who already accepted
(`allowResend` skips only the duplicate check,
`lib/services/review-manager/send-emails-service.js:876`;
`lib/utils/reviewer-invite.js:24-26`). The re-send moves `emailSentAt` forward
through `recordDeliveredInvitation` (`:1360`) without clearing review-due
reminders, so that rule would have hidden real history.

**New rule: no date fence. A row belongs to the engagement of its reviewer
suggestion, and that engagement never resets once the reviewer has been
invited.**

- Since 2026-10-31 (commit `4b73a6f4c`, owner decision D in
  `docs/plans/INVITED_REVIEWER_OUTCOMES_PLAN_2026-10-31.md`) both places that
  apply `ENGAGEMENT_STAMP_RESET` refuse any row that was ever invited or has a
  recorded outcome: `restore` [VERIFIED via `reviewer-suggestion.js:2766`] and
  staff manual re-select [VERIFIED via `reviewer-suggestion.js:1012-1013`].
  Those are the only two uses of the reset constant in `lib/`, `shared/` and
  `pages/` [VERIFIED via grep].
- History rows are written only for invited rows (§2, "Invited rows only"),
  and an invited row can never be reset. So a suggestion that has any history
  row can never start a new engagement, and rows cannot leak into one. The
  table starts empty at build, so no older row predates this guard. This does
  not rely on every send path requiring an invitation: Codex review 2 showed
  the follow-up email does not.
- The one exception is the test tool `scripts/reset-reviewer-for-testing.js`,
  which deletes the rows itself (W4).
- The build adds regression tests that tie history scoping to both halves:
  the store writes nothing for a never-invited row (the follow-up → Remove →
  Restore case Codex named), and both reset paths refuse an invited row, with
  a comment at each guard naming the history dependency.

Consequences, all deliberate:

- A re-sent invitation no longer hides anything. Respond nudges from an
  earlier invitation round stay visible with their own dates, as do reminders
  on a reviewer whose response was later withdrawn or released (the release
  clears `respondReminderSentAt`, `withdraw-pending-invitation.js:26-37`, but
  the reminder did happen).
- A reviewer invited outside the app (no `emailSentAt`) gets full history too;
  the earlier limitation is gone.

Alternative considered: an explicit engagement id on the suggestion row. It
needs a new Dataverse column and a writer at every reset site, and it guards
against a reset that the 2026-10-31 rule already forbids. Not recommended.

### 4. Display rule

`getReviewers` adds `reminderHistory` to each reviewer row:

- `null` when the read failed (fail-soft; the reviewer list still loads): the
  drawer behaves exactly as today.
- `[]` when no rows exist.
- Otherwise `[{ kind, recordedAt }]` for that suggestion, newest first.

One query per listing: `WHERE suggestion_id = ANY($1)` over the rows the
listing already returns, so test-request visibility
(`test-requests/isolation.js`, imported at `reviewers-service.js:57`) is
inherited, not re-decided.

In `reviewer-activity-history.js`, per kind:

1. One "reminder recorded" event per row, each with its own date and
   the existing "Recorded; send not confirmed" note.
2. The current Dataverse stamp is also shown as an event when no row of the
   same kind lies within one second of it (a reminder sent before this change,
   or an insert that failed). One second absorbs a stamp stored without
   milliseconds. **[ASSUMED]** Dataverse may drop milliseconds; the build
   confirms with one readback and tightens the window to exact match if it
   does not. W3 can keep a newer stamp written by another send
   (`record-email-outcome.js:65-67`); that stamp is itself that send's row, so
   it matches and is not shown twice.
3. Review-due only: let C be `reminderCount` and E the number of review-due
   events from steps 1–2. If C > E, add one undated line: "N earlier reminders
   recorded without a date". No date is ever invented from the count. If
   E ≥ C, no line. Two reminders in the same second are two rows (the unique
   key keeps milliseconds) and two events.
4. Respond reminders have no count, so steps 1–2 only.

**D3 — load with the list vs. fetch on open. [OWNER DECISION 2026-11-03: load
with the list.]** Loading the rows
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

- **Store:** insert, `ON CONFLICT DO NOTHING`, batch read; no insert for a
  never-invited row; a stalled insert or read is aborted at the deadline (the
  fetch receives an aborted signal, not just an abandoned promise) and
  resolves as unknown / `null`; after one failure the breaker skips further
  calls in that invocation; deadline timers are cleared when the call settles.
- **W1/W2:** a successful claim writes exactly one row with the claim's
  timestamp, after the send, on both send success and send failure; a 412
  writes none; a stalled or failing insert never delays or prevents the send
  (the send mock is called before the insert mock).
- **W3:** a recorded follow-up writes one row with `sentAt`; a closed row or
  binding change writes none; an insert failure does not throw; a follow-up to
  a never-invited candidate increments the count but writes no row, and after
  Remove → Restore the drawer shows no reminder.
- **W4:** the test reset script deletes the suggestion's rows with `--commit`
  and not on a dry run.
- **Engagement guard:** `restore` and staff re-select refuse an invited row
  (pins the scoping rule in §3).
- **DTO:** `reminderHistory` is `null` on read failure or timeout, `[]` on no
  rows; rows dated before a re-sent invitation are still returned.
- **Drawer:** three rows give three dated events; an accepted reviewer whose
  invitation was re-sent keeps every dated reminder; a pre-change reviewer with
  count 2 and one stamp gives one dated event plus "1 earlier reminder recorded
  without a date"; `null` history matches today's output exactly; a stamp
  matching a row is not shown twice, including a stamp without milliseconds.

## Durable surfaces

- Migration `095_reviewer_reminder_events.sql` (the number is **[ASSUMED]**
  free; recheck open branches at build) and `npm run prebuild` for the manifest.
- `scripts/setup-database.js`: no edit. A fresh install executes the checked-in
  migrations [VERIFIED via `scripts/setup-database.js:2110-2113`], and 091 is
  likewise absent from the script [VERIFIED via grep].
- Atlas: new `docs/atlas/postgres-reviewer-reminder-events.md`, a row in
  `docs/atlas/postgres-infra-tables.md` (091 has one [VERIFIED via grep]),
  `check:atlas`.
- `docs/SERVICE_AND_UTILITY_CATALOG.md` entry and source header for the store.
- Header comments in `reviewer-activity-history.js` (reminder events now come
  from history rows scoped by the no-reset rule, not only from reset stamps)
  and `ReviewerActivityDrawer.js`; comments at both reset guards.
- `scripts/reset-reviewer-for-testing.js` header (W4).
- Agent wiki `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md`.
- No new API route: `docs/API_ROUTE_SECURITY_MATRIX.md` unchanged.

## Release and proof

Tier 2 under `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md:129-144`
(reminder behavior, migrations): a branch, characterization tests first, PR with
CI green, recorded last-known-good Production deployment, explicit owner
decision to merge. Rollback: revert the merge commit; the table can stay (no
reader once reverted).

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
| 1 Whole-flow | All writers (W1–W3, test tool W4) and the one reader (`getReviewers` → drawer) traced above. `my-candidates-service.js:304` also projects `respondReminderSentAt` but does not feed the drawer [VERIFIED via grep: the drawer is imported only by `ReviewerManagePanel.js:33`]. |
| 2 Partial success | Unit of success is one reminder. Rows are written only after the Dataverse write succeeds and after the send attempt; insert failure or delay never blocks or fails a send (bounded by the deadline); the count line absorbs a missed review-due row. |
| 3 Async / stale state | N/A for the drawer: it is unmounted on any row mutation (`ReviewerActivityDrawer.js:12-14`). Server: the insert follows the send; a timed-out insert may land later, which is still a true record of a claimed reminder. |
| 4 Helper extraction | The store only inserts and reads; it must not decide eligibility or replace the Dataverse claim, which stays the at-most-once guard. |
| 5 Durable surfaces | Listed above. No route, so `check:api-routes` and route counts are unaffected. |
| 6 Doc reconcile | Queue item 7, the 2026-09-06 handoff note, the drawer header, Atlas, wiki: at build. |
| 7 Symbol fan-out | New `kind` values `respond` / `review_due` are read only by the drawer's per-kind rule; an unknown kind is ignored (allowlist). Reviewer merge cannot move rows: merges are blocked when the losing record has any reminder stamp (`lib/services/reviewer-merge.js:35-38`). |

**Verdict: READY WITH NAMED CHANGES**; D1–D3 decided 2026-11-03, D2 revised
after Codex review (owner to confirm). Named checks for the build: confirm
Dataverse timestamp precision (display rule 2); prove per-query abort works on
the installed Neon driver (§2); recheck the free migration number.

**Codex adversarial review 1 (2026-11-03): needs-attention, two findings, both
addressed.** (1) High: invitation re-send moved `emailSentAt` past review-due
reminders, breaking the D2 fence → the fence is removed; scoping rests on the
2026-10-31 no-reset-after-invite guard (§3). (2) Medium: an unbounded insert
before the irreversible send → the insert moves after the send and every
history database call is bounded (§2).

**Codex adversarial review 2 (2026-11-03): needs-attention, two findings, both
addressed.** (1) High: the follow-up email can record a reminder on a
never-invited candidate, who can then be removed and restored → history is
written only for invited rows (§2), so §3's invariant no longer depends on the
send paths. (2) Medium: `Promise.race` bounded the wait, not the query → the
store cancels the fetch with an abort signal and a per-invocation breaker caps
outstanding work (§2).

**Codex adversarial review 3 (2026-11-03): approve, no material findings.**
Approval is for the plan, not implementation. Build notes it gave, now part of
the plan: (a) breaker state is request-local, created per sweep run, per
send-emails batch, per manual reminder and per listing, and never held in
module-level state across warm invocations; (b) the store uses a direct Neon
client on `POSTGRES_URL` for per-query cancellation.

## Scope

- Code: one migration, one small store module, two insert sites, one batch read
  in `getReviewers`, the drawer's reminder rule, a delete in one test script,
  and comments at two reset guards.
- Tests: about five files, mostly extending existing ones.
- Docs: Atlas page, catalog entry, two component headers, wiki, queue.
- External: a Production migration apply and an owner-present test-request
  proof. No Dynamics schema change, no new route, no change to who receives
  reminders.
