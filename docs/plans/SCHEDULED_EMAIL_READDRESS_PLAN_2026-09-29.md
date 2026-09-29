# Scheduled email: re-addressing queued reminders safely

Status: **DRAFT, revision 0 (2026-09-29, Session 549). Split out of `docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md` (owner, S549) after Codex round 3 found five high issues in its reminder design. This is a starting design plus the open requirements from rounds 2 and 3; it has not been reviewed on its own. Nothing built.**

## Why

The Research Liaison switch (the liaison plan) gives **new** grantee reminders the current Liaison. A reminder row already queued in `scheduled_email_messages` keeps the recipients it was created with, so after a Liaison change it still goes to the former Liaison (liaison plan, owner answer 9). Measured 2026-09-29: the switch changes the actual Liaison recipient on 27 active Research awards (liaison plan, *Measurement*).

Re-addressing a queued row safely needs the shared scheduled-email engine hardened. Several of the hazards Codex found (duplicate send after recorded send intent, a PD-handoff rebuild that can adopt an older draft) exist for every program today, independent of the Liaison change.

## Current engine facts

- The daily cron runs three passes in order: process deliverables (create or PD-handoff rebuild), send digests, deliver due messages [VERIFIED via `lib/services/cron/grantee-deliverable-reminders-service.js:173-209`].
- Activity creation precedes persistence of `dynamics_email_id`. A failure between them is recovered by correlation key `wmkf-scheduled-recipient:<id>` [VERIFIED via `lib/services/scheduled-email-service.js:76-78,108-138`].
- The ordinary path re-sends an unaccepted activity even when `send_requested_at` is already set [VERIFIED via `scheduled-email-service.js:361-377`]; only the test-Request path refuses (`:243-275`, per round 2).
- `reassignScheduledEmail` (PD handoff) rewrites recipients, subject, body, signature and approval with no expected-version predicate, fenced only on status, null transport fields and no live lease [VERIFIED via `lib/services/scheduled-email-store.js:344-377`].
- The digest lists `scheduled`/`failed` and unsurfaced `sent` rows, grouped into approval, upcoming and sent sections [VERIFIED via `scheduled-email-store.js:305-313`; `scheduled-email-service.js:415-437`]. Only sent-FYI ids are frozen into a digest run (per round 3: `scheduled-email-service.js:462-466`).
- Send-now passes `expectedVersion` and returns 409 when the claim is lost [VERIFIED via `pages/api/scheduled-emails/[id].js:82-91`].

## Starting design (from liaison plan revision 3)

1. **Recipient generation.**
   - New column `recipient_generation`, via a migration and the fresh-install mirror.
   - A generation-specific correlation key: generation 0 keeps today's key, and later generations use `:g<n>`.
   - Recovery looks up only the current generation's key, so a draft left under an older generation is never adopted or sent.
2. **Recipient-only re-address.** `readdressScheduledEmail`, fenced on the expected version:
   - It updates recipients, contact ids and the review posture, and increments `version` and `recipient_generation`.
   - It keeps `subject`, `body_text`, `signature_text` and `edited_at`, so PD edits survive.
   - It applies only while `scheduled`/`failed`, with no activity, no send intent and no lease.
3. **Send intent is a point of no return.** Once `send_requested_at` is set, the activity is never re-sent; it is reconciled only.
4. **Draft activity with no send intent.** On a Liaison change, the row is stopped for staff, not sent to the old parties.
5. **Needs attention.** A digest section and a UI error for rows stopped or unconfirmed.

## Open requirements (Codex round 3 on that design; must be resolved here)

1. **No Phase 1 stop that Phase 2 cannot recover.** If any interim stop ships, it must be a non-terminal, re-addressable state, or Phase 2 must atomically reactivate it; `createOrGetScheduledEmail` returns the same `(workflow_type, source_record_id)` row forever (round 3: `scheduled-email-store.js:38-46`). Test the carry-over.
2. **A liaison-specific atomic transition.** `cancelScheduledEmailForSource` checks only id and status and clears any lease (round 3: `:173-188`). A stop or re-address must be fenced by expected version or lease token, status, null activity, null send intent and lease ownership. The drift check runs after a successful claim and before **every** activity lookup, including the direct `recoverByCorrelation` at `scheduled-email-service.js:319-321`.
3. **A crash-safe attention receipt.** Include the exact attention-row ids in the digest run's frozen membership; stamp only accepted membership, in normal completion and crash recovery (round 3: receipt writer `scheduled-email-store.js:317-326` stamps only `sent` rows).
4. **Every rebuild in the generation scheme.** PD handoff (`reassignScheduledEmail`) must also be expected-version-fenced and increment `recipient_generation`. Define a cleanup report or ledger for orphaned older-generation drafts.
5. **A complete send-intent state machine.** Decide whether `send_unconfirmed` is a status (the status CHECK in migration 036 allows scheduled/sending/sent/stopped/failed, per round 3) or an error code, and specify lease release, the due query, digest receipt, UI, cleanup and late-acceptance finalization. Make no-resend an **engine-wide** invariant, not Research-only; the cron creates the same workflow for every program (round 3: `grantee-deliverable-reminders-service.js:120-132`).
6. **Tests:** crash between activity create and persist with a Liaison change and with a PD handoff; concurrent edit, approval and send-now against each rebuild; lease turnover; stale snapshots; digest crash after send; late acceptance.

## Release

Tier 2 or higher (a migration on the shared Postgres plus changes to the email engine), on its own branch, after its own plan reviews. It follows the liaison plan's release.
