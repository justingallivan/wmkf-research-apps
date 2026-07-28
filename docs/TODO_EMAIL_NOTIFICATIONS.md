---
title: "Email Notifications — Unified Notification Service"
domain: email
kind: plan
status: draft
summary: "System-alert emails are wired to the Dynamics email transport (DynamicsService.createAndSendEmail). When NOTIFICATION_EMAIL_FROM is set, the..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# Email Notifications — Unified Notification Service

## Current Status (as of 2026-05-23)

System-alert emails are wired to the Dynamics email transport (`DynamicsService.createAndSendEmail`). When `NOTIFICATION_EMAIL_FROM` is set, the notification service automatically emails recipients on:

- New user sign-ups (forced — admins need proactive visibility for app-access grants).
- `error` / `critical` severity alerts (cron failures, secret expiration, log analysis, health degradation).

**Recipient routing (S181):** every `notify()` call tags an alert with a `category` (e.g. `spend`, `intake`, `ops`, `security`, `staff-onboarding`). Routing is configured in `/admin` → **Alert Recipients**, persisted as the `alertRecipientsByCategory` setting in `wmkf_appsystemsettings`. Resolution rule: `config[category]` → `config.default` → the active superuser roster (`dynamics_user_roles.role = 'superuser'` joined to `user_profiles`). The old `SPEND_ALERT_EMAIL_TO`/`SPEND_ALERT_EMAIL_FROM`/`NOTIFICATION_EMAIL_TO` env vars are removed — categorized routing supersedes them.

The previous Microsoft Graph `Mail.Send` path was retired in S142. That permission was never granted, and the Dynamics transport (already shipped, working since Session 77) covers every current use case using already-granted privileges.

## What Works Now (Dashboard Alerts)

All notifications are stored in `system_alerts` regardless of email configuration:

- **New user sign-up** — `new_user` alert + email to admins.
- **Health monitoring** — health-check cron creates alerts when services degrade and auto-resolves on recovery.
- **Maintenance results** — daily cleanup recorded as info alerts.
- **Secret expiration** — approaching expiry triggers warning/error/critical alerts.
- **Log analysis** — server error spikes are AI-analyzed and stored as alerts.

All alerts are visible in the **System Alerts** section of `/admin`, with acknowledge and resolve actions.

## Configuration

### Required for email send-out

```env
# Sender mailbox — must be a Dynamics systemuser with Server-Side Sync enabled.
# When unset, alerts are dashboard-only (no email goes out).
NOTIFICATION_EMAIL_FROM=<some-staff-or-role-mailbox@wmkeck.org>
```

That's it. `DYNAMICS_*` credentials are already required for the rest of the app.

### Related — keep the scholarly API contact reachable

`NOTIFICATION_EMAIL_FROM` historically served double duty as the contact address
sent to NCBI E-utilities and Europe PMC. When the sender is moved to an
unmonitored role/noreply mailbox, set `SCHOLARLY_POLITE_MAILTO` to a monitored
address so those providers can still reach a human about our API usage; it falls
back to `NOTIFICATION_EMAIL_FROM` when unset. OpenAlex uses its own
`OPENALEX_POLITE_MAILTO`.

### Recipient management (no env vars)

Recipients = active superusers. To add or remove someone from the alert distribution, grant or revoke the `superuser` role via `/admin → User Access`. The change takes effect on the next alert send (no cache, no restart, no env-var update).

## Sender mailbox guidance

The sender must:
1. Exist as a Dynamics `systemuser` (resolvable by `internalemailaddress`).
2. Have **Server-Side Synchronization** enabled for outgoing email.

Three reasonable choices:

- **A specific staff mailbox** (e.g. an admin's address) — works today; no IT touchpoint. Fine for placeholder / small-org operation. Risk: if that person leaves, the env var must be updated.
- **A role mailbox** (e.g. `appsuite-notifications@wmkeck.org` or an existing IT shared mailbox) — durable across personnel changes. May require an IT ask if a fresh mailbox is needed.
- **A dedicated `noreply@wmkeck.org`** — standard pattern but requires the mailbox to be a real systemuser with SSS, not just an alias.

### Selected sender — `alerts@wmkeck.org` (owner decision + applied 2026-07-27)

Program directors received the reviewer-quota alert (`lib/services/reviewer-quota.js`)
from a named individual's mailbox, because `NOTIFICATION_EMAIL_FROM` was a specific
staff address. The owner named `alerts@wmkeck.org` as the replacement sender
[VERIFIED via owner instruction, session 2026-07-27].

State of this change:

- **[DECIDED]** `alerts@wmkeck.org` is the intended sender for all system-alert
  email. The var is global — it is not per-alert-type, so this changes every
  alert's sender, not just the quota notice.
- **[ASSUMED]** That the address is already a monitored contact: a dated Vercel
  environment probe recorded `OPENALEX_POLITE_MAILTO=alerts@wmkeck.org`
  (`docs/audits/memory-wiki-audit-2026-06-23.md:86`, 2026-06-23). Not re-verified
  here — Vercel sensitive env values are not readable from a session.
- **[VERIFIED via read-only Dataverse probe of `wmkf.crm.dynamics.com`,
  2026-07-27]** The address exists as a Dynamics `systemuser`
  (`d57ddb27-c8db-ee11-904d-000d3a310f67`) with `isdisabled=false` and
  `accessmode=0` (licensed Read-Write), and its `domainname` is
  `alerts@wmkeck.org`. So `resolveSystemUser`'s `internalemailaddress` filter
  resolves and the sender-party bind will succeed. This was the blocking
  prerequisite; a monitored M365 role mailbox is frequently *not* a licensed
  systemuser, and this one is.
- **[VERIFIED via the same probe]** The systemuser's `fullname` is `# Alerts`,
  which is the sender name recipients see — the leading `#` appears to be a
  sort-to-top convention for Dynamics user lists. The owner reviewed this and
  accepted it as-is (session 2026-07-27); no `systemuser` edit is required.
- **[UNVERIFIED]** Outgoing Server-Side Sync state on the related `mailboxes`
  row. If outgoing SSS is not enabled and succeeding for this mailbox, the send
  fails *after* the sender resolves. `notify()` catches any such failure and logs
  "email failed (alert still stored)", so **alert email delivery would stop
  silently while dashboard alerts keep working** — verified at
  `lib/services/notification-service.js:85-88`. Check the `mailboxes` row for this
  systemuser, or the Power Platform admin UI under Email Configuration →
  Mailboxes, before relying on alert email.
- **[VERIFIED via owner report, session 2026-07-27]** `NOTIFICATION_EMAIL_FROM`
  and `SCHOLARLY_POLITE_MAILTO` were both set to `alerts@wmkeck.org` in Vercel and
  a deploy was started. Not independently confirmed here — Vercel sensitive env
  values are not readable from a session.
- **[PENDING MERGE]** `SCHOLARLY_POLITE_MAILTO` has no effect in production until
  the code that reads it reaches `main` (branch `codex/claude-bug-fixes`). Until
  then PubMed/Europe PMC fall back to `NOTIFICATION_EMAIL_FROM`, which is now the
  same address — so the contact path is correct either way, and the new var is
  simply inert.

Note that `/api/test-email` cannot verify any of this: it sends from the
authenticated superuser's own `azureEmail` and only honors a `from` body param
when the session carries no email (`pages/api/test-email.js:46`).

When applying it, also set `SCHOLARLY_POLITE_MAILTO` (see above). Because that
address appears to be monitored, pointing it there as well is reasonable; the two
vars stay separate so a later move to a genuinely unmonitored `noreply` does not
silently strand the NCBI/Europe PMC contact path.

## Architecture

```
NotificationService.notify()
  ├── AlertService.createAlert()                   ← always (dashboard)
  └── if (emailAdmins || severity ≥ error) and isEmailEnabled:
        NotificationService.sendAdminEmail()
          ├── getAdminRecipients()                 ← SQL: active superusers
          └── DynamicsService.createAndSendEmail() ← Dynamics SSS transport
```

## Why this design

Two failure modes the old Graph-based design didn't handle:

1. **Mailbox vanishes** (personnel change with hard-coded `NOTIFICATION_EMAIL_TO`) — recipient list now derives from per-category config in `/admin` with fallback to the current superuser roster, not a static env var.
2. **Tribal knowledge vanishes** — a successor admin browsing Dynamics finds the App Suite admin roster via `user_profiles ↔ systemuser` bridge + `dynamics_user_roles`. The `/admin` dashboard surfaces the same data.

Vercel envs are minimized: one durable variable (`NOTIFICATION_EMAIL_FROM`) instead of two coupled to a person.

## Alternative channels (not implemented)

If email becomes inadequate:

1. **Webhook to Slack/Teams** — extend `NotificationService` with a webhook channel.
2. **Daily digest** — wire the existing cron infrastructure to a digest cron.
