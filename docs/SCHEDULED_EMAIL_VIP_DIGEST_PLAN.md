---
title: "Scheduled email: VIP review and digest design"
domain: email
kind: plan
status: active
summary: "Owner-settled scheduled-email redesign: automatic labeled sends, per-PD VIP recipient flags, digest as single interface, explicit rollout onboarding."
canonical: false
cataloged: 2026-08-26
owner: product-engineering
related:
  - docs/SCHEDULED_PERSONALIZED_EMAIL_P0.md
  - docs/GRANTEE_PORTAL_SPEC.md
  - docs/atlas/postgres-infra-tables.md
---

# Scheduled email: VIP review and digest design

## Status

**OWNER-SETTLED DESIGN 2026-08-26; SOURCE-BUILT SAME DAY on branch
`codex/scheduled-email-review-p0` (commit `417774f`); adversarially reviewed
and all three findings fixed same day (digest run ledger + PD handoff
rebuild — see "Adversarial review outcome" below); NOT DEPLOYED, migration
036 not applied.** One scope note against Decision 5: the Reviewers/Invite
Reviewers panel toggle is deferred to the reviewer-workflow slice — reviewer
rows key on `wmkf_potentialreviewers`, the flag store keys on contact, and no
ledger workflow reads reviewer flags yet, so a toggle there would write state
nothing consumes. The built toggles are the Awardee tab and the
`/scheduled-emails` inbox; the principle stands and the reviewer placement
activates with its workflow. This document supersedes the
decision layer of `docs/SCHEDULED_PERSONALIZED_EMAIL_P0.md` (per-PD
automatic/review modes, per-message notifications, Profile Settings card,
global nav item). The P0 document remains the implementation record for the
durable ledger, review actions, send recovery, and disclosure rendering,
which carry over under this design.

## Owner decisions (settled 2026-08-25/26)

1. **Automatic sending is the default behavior.** Routine automated mail
   sends without review. Owner experience: nearly all previewed emails
   required no change, so blanket review was almost entirely wasted effort.
2. **Sends remain personalized.** Mail goes out from the assigned PD's own
   address, so external replies reach that human directly; every automated
   message carries the disclosure that it was sent automatically on the PD's
   behalf and where replies go. (Both built in P0 — [RECHECKED after
   lib/services/scheduled-email-service.js change:
   `from: message.pd_email` at lib/services/scheduled-email-service.js:268;
   lib/external/automated-email-notice.js `buildAutomatedEmailNotice`].)
3. **Review is triggered by the recipient, not the sender.** A VIP flag
   marks recipients whose mail waits for explicit PD approval before
   sending. Review by exception, not by policy.
4. **The VIP flag is per (PD, contact) pair.** One PD's first-name
   relationship with a contact says nothing about another PD's. On request
   handoff, VIP review deliberately does NOT transfer; the new PD flags the
   contact themselves if they want review.
5. **Flag them where you see them.** The flag toggle renders in-context on
   every working surface where a mail-receiving person appears: reviewer
   rows on the Workbench Reviewers/Invite Reviewers panels, PI/liaison
   recipients on the Awardee tab, and reactively from a draft in the
   scheduled-emails inbox and the digest. Each surface shows only its own
   population. There is no standalone VIP management screen; flagging is
   in-context by principle (no preemptive contact-browsing UI).
6. **A per-PD "review everything" override remains available** for a PD who
   wants to see all their automated mail regardless of VIP flags. Coarse,
   cheap to honor at ≤6 PDs.
7. **The digest is the single interface.** Per-message notification email is
   removed. One digest email per PD, sections ordered by urgency: "waiting
   on your approval" (VIP-bound drafts), "sending soon unless you act",
   and "sent on your behalf" (passive FYI). Action links deep-link into the
   authenticated `/scheduled-emails` page; no signed one-click action tokens
   in email — the server keeps owning all send decisions.
8. **Digest cadence is daily, only-when-nonempty.** At current volume this
   is self-limiting (most days produce no digest). Revisit only if volume
   makes daily digests noisy.
9. **Onboarding is a rollout precondition, not a runtime state.** The code
   has no "unconfigured PD" concept and no hold/compatibility path. Before
   the cron is enabled, the admin walks each PD (at most 6, ever) through
   the feature and seeds their override/VIP state. A later-hired PD is
   onboarded as part of PD setup. This guarantee is procedural and lives in
   the rollout checklist below.
10. **Miss asymmetry is an accepted trade.** Mail to a non-VIP recipient
    sends with no human review. A template bug or stale context that blanket
    review might have caught will go out. Accepted mitigations: the pre-send
    eligibility re-check, the automation disclosure on every message, and
    replies routing to the PD, who can correct in one email. **A single miss
    does not reopen blanket review** — reopening per-PD review of all mail
    requires a new owner decision, not an incident reaction.

## Interaction model

A PD's entire steady-state interaction: receive a digest → act on it or
ignore it. VIP-bound drafts wait for approval in the inbox; everything else
sends on schedule and is FYI'd afterward. The VIP list is curated in the
flow of normal work (Workbench tabs, inbox, digest), never in a settings
panel.

Removed from the P0 build: the Profile Settings "Automatic Email Review"
card, the global "Scheduled Emails" nav item (the inbox remains as the
digest's deep-link target), and the per-message review notification.

## Carry-over from the P0 branch

These mechanisms survive the rebuild (their host files were rewritten
2026-08-26 for the decision layer, the mechanisms carried over): the
`scheduled_email_messages` ledger and leases
(`lib/services/scheduled-email-store.js`
[RECHECKED after lib/services/scheduled-email-store.js change: `locked_until` lease fences at lines 88, 128, 146],
migration 036), edit /
approve / stop / send-now actions and routes
(`pages/api/scheduled-emails/`), send recovery and Dynamics correlation,
Dataverse finalization (`lib/services/scheduled-email-service.js`
[RECHECKED after lib/services/scheduled-email-service.js change:
`correlationKey` at lib/services/scheduled-email-service.js:71,
`finalizeScheduledEmail` at lib/services/scheduled-email-service.js:214]),
disclosure rendering and the legacy-marker stripper
(`lib/external/automated-email-notice.js`), and the `/scheduled-emails`
inbox page.

Rebuilt or new ([BUILT 2026-08-26 on the branch]): the preference layer
(per-PD mode became the `{ reviewAll }` override; `scheduled_email_vip_flags`
per (PD, contact) with the indexed `filterVipFlaggedContacts` lookup), the
fail-closed due-send guard (the store claim refuses an unapproved
approval-required row; PD send-now is the only bypass), the digest builder
(replacing the removed `notifyScheduledEmailReview` and its notification
columns), and the in-context flag toggles (Awardee tab + inbox; Reviewers
panel deferred per Status).

## Adversarial review outcome (2026-08-26, Codex; all three findings fixed same day)

An owner-invoked Codex adversarial review of the branch returned three
confirmed findings; the fixes are source-built on the branch:

1. **Digest retries could receipt FYIs the digest never contained** (high).
   Fixed by the `scheduled_email_digest_runs` ledger: `fyi_message_ids`
   freezes the rendered membership at first claim, and every stamp path
   stamps at most that membership — a row sent after today's digest stays
   unreceipted and appears tomorrow. Accepted direction of error: a mid-run
   crash can repeat an FYI once; it can never drop one.
   [RECHECKED after lib/services/scheduled-email-service.js change: sendScheduledEmailDigest stamps parseRecipients(run.fyi_message_ids), never group.sentFyi]
2. **PD handoff left the former PD's mailbox and posture on unsent rows**
   (high; live concern — PD rotations planned). Fixed: the cron rebuilds an
   unsent row in place under the request's current PD (mailbox, name,
   signature, recipients, and the CURRENT PD's own review-all/VIP posture).
   **Deliberate product behavior:** the former PD's edits and any prior
   approval are discarded — a handed-off, previously-approved VIP draft
   re-enters the new PD's posture, which may be automatic. Reassignment
   mid-run (after the drift check, before that run's send) and rows deferred
   by a capped scan self-heal next run.
   **Transport-state residual (re-review 2026-08-26, fixed via Codex
   rescue):** a row whose Dynamics activity already exists (created, send
   failed) is NOT rebuilt — the deliver path prefers the retained activity
   and the correlation backstop is generation-blind, so a rebuild would send
   the former PD's frozen content under the new PD's name. Such a row
   deliberately stays under the former PD until its retry resolves (honest
   attribution; same mail as a handoff one day later), and the cron reports
   `pd handoff deferred` in the summary failures list. The full
   cancel-and-regenerate path (generation-keyed correlation + a Dynamics
   cancel op the adapter does not have) is deliberately not built.
   [RECHECKED after lib/services/scheduled-email-store.js change: reassignScheduledEmail SQL guard — different PD + unsent + no transport state + unleased only]
3. **Digest creation was not concurrency-safe** (medium). Fixed by the same
   run ledger: the (PD, day) primary key plus lease is claimed before any
   Dynamics work; a losing invocation skips without sending or stamping. The
   Dynamics correlation key remains the crash backstop.

**Retention decision:** `scheduled_email_digest_runs` is deliberately
unbounded (≤6 PDs × ≤366 rows/PD/year); revisit only if PD count grows.

## Rollout checklist (procedural guarantees)

1. Admin onboards every active PD and seeds their override/VIP state
   BEFORE enabling the cron (Decision 9).
2. Apply the schema migration(s) for the VIP flag store; probe live.
3. First digest cycle observed with a test PD before real recipients.

## Implementation questions (resolved 2026-08-26 at build time)

- VIP flag storage: Postgres `scheduled_email_vip_flags` in migration 036
  alongside the ledger, primary key (pd_systemuser_id, contact_id) — the
  cron's indexed is-flagged lookup is `filterVipFlaggedContacts` in
  `lib/services/scheduled-email-store.js`
  [RECHECKED after lib/services/scheduled-email-store.js change: exported at line 468].
- The digest is generated by the existing daily reminders cron
  (`lib/services/cron/grantee-deliverable-reminders-service.js`), one digest
  per PD per UTC day, claimed through the `scheduled_email_digest_runs`
  ledger (lease + frozen FYI membership; the Dynamics correlation key is the
  crash backstop); sent-FYI rows are receipted via `digest_fyi_at` from the
  run's frozen membership only.
  [RECHECKED after lib/services/cron/grantee-deliverable-reminders-service.js change: digest loop unchanged, drift rebuild added before it 2026-08-26]
- The review-all override (Decision 6) is set from a toggle on the
  `/scheduled-emails` inbox page through the authenticated
  `/api/email-automation-preferences` route, value shape
  `{ reviewAll: boolean }` (redefined freely — no old-shape values were ever
  deployed).
