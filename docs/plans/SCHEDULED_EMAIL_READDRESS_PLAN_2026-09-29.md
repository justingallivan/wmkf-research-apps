# Scheduled email: engine hardening, then queued-reminder re-addressing

Status: **DRAFT, revision 1 (2026-09-29, Session 551). Narrowed by the owner in S551 after the measurement below: Part A, engine hardening for every program, now leads, and Part B, Liaison re-addressing, is a smaller follow-on. Revision 0 (S549) was split out of `docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md` after Codex round 3 on that plan. Revision 1 has not been reviewed. Nothing built.**

## Why

The scheduled-email engine sends the grantee materials reminder (`grantee_abstract_reminder`, the only workflow the status table allows [VERIFIED via `scripts/setup-database.js:891-892`]) for every program. It has hazards that do not depend on the Liaison change: it can send the same email twice once a send has been requested, it can adopt a stale draft, and it can drop a PD's edit (*Current engine facts*). Part A fixes these.

The Research Liaison switch gives **new** reminders the current Liaison. A row already queued keeps the recipients it was created with (liaison plan, owner answer 9). Production has no queued rows (*Measurement*), so the only remaining case is a Liaison change while a row waits to send. Part B covers it, reusing Part A's recipient generation.

## Measurement (S551)

**Result (owner-run, production, 2026-09-29, read-only) [DERIVED-FROM: the S551 session run of scratch probe `probe-queued-reminder-liaison-drift.js`; its output is not committed]:** the production ledger has **0** `grantee_abstract_reminder` rows in any status, so 0 are unsent. The owner confirmed the probe read the production Postgres host. The owner also said no grantee materials requests are outstanding, which is consistent: the cron creates a row only for an Invited deliverable with an invited date [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:151-153`]. The owner's statement is an owner report, not a probe result.

So no queued reminder carries a Liaison from before the switch. Every row the cron creates from now on gets the Liaison current at creation [VERIFIED via `grantee-deliverable-reminders-service.js:300-318,365`]. The remaining re-address exposure is an institution changing its Liaison while a row waits to send. The engine hazards under *Current engine facts* do not depend on this count.

## Current engine facts

All line numbers are as of `b9f05ae5d`.

- The daily cron runs three passes in order: process deliverables (create or PD-handoff rebuild), send digests, deliver due messages [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:173-209`].
- **Duplicate send after send intent (every program).** An error from the SendEmail call once `send_requested_at` is set is classified `uncertain` [VERIFIED via `shared/utils/email-send-outcome.js:51-58`], and an `uncertain` outcome skips `recordFailure` [VERIFIED via `lib/services/scheduled-email-service.js:384-392`]. The row stays `sending` until its lease expires. The due query includes `sending` rows with an expired lease [VERIFIED via `lib/services/scheduled-email-store.js:81-92`]. On the next claim, an activity that is not yet accepted gets `recordSendRequested` (a COALESCE no-op) and **another `sendEmail`** [VERIFIED via `scheduled-email-service.js:363-377`]. Only the test-Request path refuses to resend [VERIFIED via `scheduled-email-service.js:243-275`].
- **A failed activity read looks like no activity.** Reading a stored `dynamics_email_id` uses `.catch(() => null)` at `scheduled-email-service.js:118` and `:320` [VERIFIED]. A transient read error then falls through to correlation recovery or a new activity create (`:108-138`). The persist fence (`dynamics_email_id IS NULL OR = new id`, `scheduled-email-store.js:221-231`) stops a second id from being recorded, so the row fails with "could not be persisted" or "Multiple … share correlation" and leaves an orphan draft [VERIFIED by reading the path; not reproduced].
- **PD edits after the activity exists are not sent.** `updateScheduledEmailDraft` and `approveScheduledEmail` are fenced on PD, version, `scheduled`/`failed` status and no live lease, not on a null `dynamics_email_id` [VERIFIED via `scheduled-email-store.js:106-150`]. The send path reuses an existing activity as created and renders a body only when none exists [VERIFIED via `scheduled-email-service.js:319-359`]. A PD who edits a `failed` row that already has an activity sees the edit saved, but the older content is what is sent.
- **The PD-handoff rebuild can adopt the old draft.** `reassignScheduledEmail` rewrites recipients, content and posture when the stored PD differs, the row is `scheduled`/`failed`, both transport fields are null and no lease is live. It has no expected-version predicate [VERIFIED via `scheduled-email-store.js:344-377`]. A crash between activity create and persist leaves a Dynamics draft under correlation key `wmkf-scheduled-recipient:<id>` with `dynamics_email_id` still null [VERIFIED via `scheduled-email-service.js:76-78,122-135`]. The rebuild keeps the same row id, so the next send recovers that old draft by the same key (`:118-120`) and sends the former PD's recipients and content.
- `cancelScheduledEmailForSource` checks only id and status (`scheduled`/`failed`/`sending`) and clears any lease, including another worker's [VERIFIED via `scheduled-email-store.js:173-188`].
- The digest groups `scheduled`/`failed` rows into approval-pending or upcoming and unreceipted `sent` rows into FYI [VERIFIED via `scheduled-email-store.js:305-313`; `scheduled-email-service.js:414-437`]. Approval-pending rows repeat in every digest until actioned and need no receipt; only FYI ids are frozen into a digest run [VERIFIED via `scheduled-email-service.js:455-466`].
- Send-now passes `expectedVersion` and returns 409 when the claim is lost [VERIFIED via `pages/api/scheduled-emails/[id].js:82-91`].

## Part A: engine hardening (every program)

A1. **Send intent is the point of no return.** Once `send_requested_at` is set, the ordinary path reconciles only, as the test-Request path does today: accepted → record sent and finalize; otherwise → no `sendEmail`, and the row is marked unconfirmed (A2). This applies to send-now as well as the cron.

A2. **Unconfirmed is an error code, not a new status** (owner decision A-1; recommended because it needs no status CHECK migration). The row is set to `failed` with `last_error_code = 'scheduled_email_send_unconfirmed'`, and the lease is released.
- The due query keeps claiming it, but only for reconciliation (A1), so a late acceptance is recorded and finalized without anyone acting.
- The digest lists it in a new **Needs attention** section, never under upcoming. Like approval-pending, the section repeats every day until the row is resolved, so no receipt or frozen membership is needed (this replaces revision 0's open requirement 3).
- The UI shows "Send status is uncertain. Check the email history before trying again" (`EMAIL_SEND_OUTCOME_COPY.uncertain`) and offers only Stop. Edit, approve and send-now are refused for these rows.
- A row stopped here that Dynamics later accepts stays stopped. Staff decided after checking the history (owner decision A-2: accept this, or add a late-acceptance check on stopped rows).

A3. **A failed read of a stored activity is unknown, not absent.** When `dynamics_email_id` is set and the read fails, the attempt ends as a retryable failure. There is no correlation recovery and no create. Correlation recovery runs only when `dynamics_email_id` is null.

A4. **No edits after the activity exists.** `updateScheduledEmailDraft` and `approveScheduledEmail` add `dynamics_email_id IS NULL AND send_requested_at IS NULL`. The UI disables editing on those rows and gives the reason. A PD who needs to change a row that is stuck after activity creation stops it and sends by hand.

A5. **Recipient generation for the PD-handoff rebuild.**
- New column `recipient_generation INTEGER NOT NULL DEFAULT 0`: a migration plus the `scripts/setup-database.js` mirror and the Atlas page.
- The correlation key is `wmkf-scheduled-recipient:<id>` at generation 0 (unchanged, so existing rows keep recovering) and `…:<id>:g<n>` after that. Every create and recovery uses the row's current generation, so an older generation's draft is never adopted.
- `reassignScheduledEmail` increments `recipient_generation` and `version`, and gains `version = expectedVersion`. The cron passes the version of the row it just read; a lost race is reported as deferred, as it is today.
- An older-generation draft left in Dynamics is an unsent draft. The cron summary counts rebuilt rows. A read-only probe that lists drafts by correlation key is the cleanup report; deleting drafts is a separate, owner-authorized step.

A6. **Fenced source cancel.** The two `cancelForSource` calls inside `deliverScheduledEmail` (`scheduled-email-service.js:315,363`) require the caller's `lease_token`. The pre-claim test-Request stop (`:305`) requires no live lease.

## Part B: re-address on a Liaison change (after Part A)

B1. **Where.** In `deliverScheduledEmail`, after a successful claim and before any activity lookup, only when `dynamics_email_id` and `send_requested_at` are both null. The Liaison is resolved with `resolveRequestLiaison` plus a contact read, the same as row creation.

B2. **What.** If the resolved Liaison email differs from the stored Cc (or a Cc is gained or dropped), `readdressScheduledEmail` runs under the caller's lease. It is fenced on lease token, version, `sending` status and null transport fields. It updates `cc_recipients` and `recipient_contact_ids`, increments `version` and `recipient_generation`, and keeps subject, body, signature and edits. The send then continues to the new recipients under the new generation. If a crash left a draft under the old generation, that draft is orphaned, not sent.

B3. **Review posture.** The VIP check reruns for the new contact ids. If the row now requires approval and has none, the send stops for this run and the row appears as approval-pending (owner decision B-1: whether a prior approval carries over when only the Cc changed; recommended no).

B4. **Failure.** A Liaison or contact read failure is a retryable failure for this run. The row is never sent to the stored Cc because a read failed.

B5. **Rows with an activity but no send intent** (a crash window) are not re-addressed. They send as created, and the Needs attention section lists them when the stored Cc differs. With production at 0 queued rows, this is accepted rather than built (owner decision B-2).

This removes revision 0's interim stop, so its open requirement 1 no longer applies.

## Revision 0 open requirements: where each went

| r0 requirement | Revision 1 |
|---|---|
| 1. No unrecoverable interim stop | No interim stop; B2 re-addresses in place |
| 2. Liaison-specific atomic transition | B2 is lease-fenced; A6 fences the source cancel; B1 runs before every activity lookup |
| 3. Crash-safe attention receipt | Not needed: Needs attention repeats daily like approval-pending (A2) |
| 4. Every rebuild in the generation scheme | A5 (PD handoff) and B2 (re-address) |
| 5. Send-intent state machine, engine-wide | A1–A2, all programs |
| 6. Tests | *Tests* below |

## Tests

- A1: send intent set and activity unaccepted → no second `sendEmail`, for cron and send-now; late acceptance on a later run → sent and finalized.
- A2: an unconfirmed row is under Needs attention, not upcoming; edit, approve and send-now are refused; Stop works.
- A3: a stored-activity read error → retryable failure, and no create or correlation lookup.
- A4: an edit or approval on a row with an activity → 409, row unchanged.
- A5: a crash between create and persist, then a PD handoff → the next send creates a new generation-1 activity and never recovers the generation-0 draft; the rebuild loses to a concurrent edit or approval by version; a generation-0 row created before the migration still recovers by today's key.
- A6: `cancelForSource` with a foreign lease → no-op.
- B: the Liaison changes after creation → the send goes to the new Cc with PD edits kept; a Liaison read failure → no send; a new VIP contact → approval-pending; a concurrent lease turnover → the re-address no-ops.
- Crash-safety tests run against live Postgres (the `.pg.test.js` pattern in the CI ledger job), not mocked SQL.

## Release

Part A is Tier 2 (a migration on the shared Postgres plus email-engine changes): its own branch, after a Codex plan review, then an implementation review. Part B follows on its own branch and needs Part A's generation column.
