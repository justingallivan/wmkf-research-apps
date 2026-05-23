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
