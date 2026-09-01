---
title: "Outbound email inventory (2026-08-26)"
domain: email
kind: audit
status: active
summary: "Dated snapshot of all 18 outbound email types: trigger class, sender identity, recipients, controls, automation-notice and noFallback coverage."
canonical: false
cataloged: 2026-08-26
owner: product-engineering
related:
  - docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
---

# Outbound email inventory (2026-08-26)

Compiled by a repo-wide sweep on branch state at merge `4a743d63` to seed the
reviewer-email extension of the VIP/digest decision layer
(`docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md` "Broader effort"). Dated snapshot:
verify sender/control claims against live source before building on them.

## Transport layer (shared)

`lib/services/dynamics/email.js` — `createEmailActivity` (:77), `sendEmail`
(:188), `createAndSendEmail` (:217). `noFallback` defaults **false**; when
false and impersonation is off, `_writeFetch`
(`lib/services/dynamics/write-core.js:100-104`) silently retries WITHOUT the
caller-ID header — the mail goes out as the service principal instead of the
PD. Disclosure helper `lib/external/automated-email-notice.js` is imported
only by `reviewer-reminder-email.js` and `grantee-invite-email.js`.

## The 18 types

| # | Type | Trigger | Sends as | noFallback | Notice | Ledger |
|---|---|---|---|---|---|---|
| 1 | Reviewer invitation | Staff (any review-manager/reviewers staff), send-emails SSE route | Lead PD | **absent** | no | no |
| 2 | Reviewer materials | Staff, same route | Acting staff member | absent | no | no |
| 3 | Reviewer follow-up (manual batch) | Staff, same route | Acting staff member | absent | no | no |
| 4 | Reviewer thank-you (manual) | Staff, same route | Acting staff member | absent | no | no |
| 5 | Respond-by reminder | Cron reviewer-reminders 10:00 UTC | Lead PD | true | yes | no |
| 6 | Review-due reminder | Same cron | Lead PD | true | yes | no |
| 7 | Manual respond-by reminder | Staff, send-review-reminder route (editable preview) | Lead PD | true | **no** (diverges from cron twin #5) | no |
| 8 | Manual review-due reminder | Staff, same route (no preview) | Lead PD | true | yes | no |
| 9 | Thank-you sweep | Cron send-review-thankyous 10:30 UTC | Lead PD | true | yes | no |
| 10 | Acceptance confirmation (+.ics) | Reviewer token action → job queue → drain cron */2 | Lead PD, **falls back to NOTIFICATION_EMAIL_FROM** | absent | no | no |
| 11 | Due-date extension (+.ics) | Staff, review-due-extension route | Lead PD | true | no | no |
| 12 | Withdraw-sufficient courtesy | Staff, withdraw-sufficient route (preview route) | Lead PD | true | no | no |
| 13 | Grantee abstract invite | Staff, send-invite route (UI preview) | Acting staff member | absent | no | no |
| 14 | Grantee abstract reminder | Cron grantee-deliverable-reminders 08:00 UTC + PD send-now | Assigned PD | true | yes | **yes** |
| 15 | Per-PD digest | Same cron | NOTIFICATION_EMAIL_FROM | absent | n/a (internal) | digest_runs |
| 16 | Pre-site-visit distribution | Staff, prepare→send routes (hash-bound preview) | Preparing staff member | true | no | own table |
| 17 | Admin test email | Superuser route | Caller | absent | no | no |
| 18 | System alerts family | Crons + event-driven NotificationService | NOTIFICATION_EMAIL_FROM | absent | no | no |

## Cross-cutting findings (design-relevant)

- **PD-attributed mail triggered by OTHER staff:** #1, #7, #8, #11, #12 —
  any holder of review-manager/reviewers access sends as the lead PD. This
  is the consent axis the current VIP layer does not cover: "do I approve
  mail that other people send as me?" Only #14's ledger has a true per-PD
  ownership guard.
- **noFallback absent on PD-attributed mail:** #1 (reviewer invitation) and
  #10 (acceptance confirmation) can silently downgrade to service-principal
  identity if impersonation is off — candidate hardening items for the
  reviewer slice.
- **Automation-notice divergence:** #7 renders WITHOUT the notice while its
  cron twin #5 renders it.
- **Batch semantics:** solicitation (#1) is one Dynamics activity per
  reviewer, batched per staff action after a two-step preview; the natural
  approval unit for the extension is the batch, not the message (owner
  decision 2 in the plan doc's Broader-effort section).
- Full per-type control detail (fire-once markers, ETag claims, preview
  contracts, dry-runs) lives in the compiling session's report; re-derive
  from source when planning each slice.

## Update 2026-08-27 — hygiene items closed

Three of the cross-cutting findings above were fixed (S463); the table rows
reflect the 2026-08-26 snapshot and are superseded on these points:

- **#1 reviewer invitation:** now `noFallback: true` (invitations only; the
  shared payload keeps fallback for #2–4, which send as the acting staff
  member). `createAndSendEmail` (`lib/services/dynamics/email.js`) tags every
  throw from before the SendEmail POST — env preflight
  (`code: 'impersonation_disabled'`), create-activity, and attachment stages —
  with `dispatched: false`; the invitation catch routes those to plain
  `failed[]` with staff-readable copy, keeping the "possibly sent — verify
  before retry" bucket for SendEmail-stage throws that may have dispatched
  (stage-aware contract added after the S463 Codex adversarial review).
- **#10 acceptance confirmation:** now `noFallback: true`. Harmless on the
  NOTIFICATION_EMAIL_FROM fallback branch (no acting user there); the drain
  records a throw as a non-fatal failed step, at-most-once.
- **#7 manual respond-by reminder:** now renders the automation notice,
  matching cron twin #5 (notice threaded through
  `renderRespondReminderFromBodyText`; server-side chrome, not part of the
  staff-editable preview text).

The remaining cross-cutting finding — PD-attributed mail triggered by other
staff (#1, #7, #8, #11, #12) — is a design axis for the reviewer slice of the
VIP/digest plan, not a hygiene fix, and stays open.

## Update 2026-09-01 — generic post-acceptance composer retired

The table remains the dated transport-capability snapshot, but the staff UI no
longer exposes #3 or #4 through `ReviewerManagePanel`. Track Reviewers now uses
one accepted-reviewer-only materials release (#2), the dedicated row-level
review-due reminder route (#8), and the fire-once thank-you sweep (#9). The
shared `send-emails` route and four stored template records retain
`followup`/`thankyou` compatibility; they are not current panel actions.
