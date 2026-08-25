---
title: "P0: Personalized scheduled email review"
domain: email
kind: plan
status: active
summary: "Source-built P0 for per-PD review preferences, durable drafts, personalized automation disclosure, and recoverable send/finalization."
canonical: false
cataloged: 2026-08-25
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/APPLICATION_STATE_ATLAS.md
  - docs/atlas/postgres-infra-tables.md
  - docs/atlas/dataverse-wmkf-granteedeliverable.md
---

# P0: Personalized scheduled email review

## Status

**SOURCE-BUILT AND FOCUSED-TESTED 2026-08-25; NOT DEPLOYED.** Migration 036
has not been applied or live-probed. The first workflow is the automatic
grantee abstract reminder. No external/third-party review was requested for
this implementation pass.

## Owner decisions implemented

- Email remains personalized and sends from the assigned Program Director.
- Every automated recipient message says it was sent automatically on behalf
  of that PD and where replies will go.
- Each PD explicitly chooses automatic sending or advance review. Review lead
  days are 1–14; the suggested UI value is 3.
- Lead days move the internal intervention point earlier; they do not move the
  workflow's established recipient send time.
- A review-mode PD may edit subject/body, approve, stop, or send now. Silence
  sends the frozen message at its scheduled time.
- Recipients, sender, signature, workflow identity, and schedule are
  server-owned.

## Contract matrix

| Claim | Producer / entry | Persistence / authority | Consumer | Evidence | Status |
|---|---|---|---|---|---|
| PD preference is explicit and validated | Profile Settings → `/api/email-automation-preferences` | Dataverse `wmkf_appuserpreferences.email_automation` | Grantee reminder cron | source + route/preference tests | VERIFIED IN SOURCE |
| Review lead does not move recipient send | cron schedule calculation | first 08:00 UTC cron tick after full day-12 eligibility; `scheduled_send_at` + `review_available_at` | notification/send processors | shared config + service/cron tests | VERIFIED IN SOURCE |
| Exact draft/actions survive cron retries | cron creates row; PD PATCH actions | Postgres `scheduled_email_messages` | PD inbox + due-send worker | migration/setup parity + route/service tests | VERIFIED IN SOURCE; NOT LIVE |
| Browser cannot redirect a send | owned route accepts bounded action fields only | server-owned row recipients/sender/source | Dynamics email creation | route tests + API security matrix | VERIFIED IN SOURCE |
| Preview never contains a live token | scheduled-email projection | placeholder only; no token persistence | recipient preview iframe | service tests | VERIFIED IN SOURCE |
| Real send is recoverable | due/send-now worker | PG lease/activity/send receipt; Dynamics correlation | Dataverse finalizer | service tests + source trace | VERIFIED IN SOURCE; NOT LIVE |
| Recipient sees personalized automation disclosure | shared notice renderer | rendered message only | grantee/reviewer automated mail | notice renderer tests | VERIFIED IN SOURCE |
| Cleanup cannot erase unresolved work | daily maintenance | deletes only finalized `sent` or explicit `stopped` | operational retention | maintenance tests | VERIFIED IN SOURCE; NOT LIVE |

## Rollout boundary and remaining decision

A PD with no saved preference currently retains the historical day-12
automatic claim-before-send path. This avoids silently choosing either
automatic or three-day review while profiles are unconfigured, but it is a
rollout compatibility state rather than the desired final policy.

Before migration 036 is applied and the feature is promoted, the owner must
choose what existing no-preference PDs inherit and how they are prompted to
make the explicit decision. No code in this branch applies the migration,
changes production configuration, or deploys the feature.

## Recovery and residual risk

- The message is stopped only when a successful eligibility read shows the
  source deliverable is no longer Invited, or the deliverable is confirmed
  deleted (404). Any other eligibility read failure marks the row failed and
  retryable; a transient Dataverse error cannot permanently stop a message.
- A Dynamics activity ID is persisted before transport; ambiguous creation is
  recovered by a deterministic correlation key. Multiple matches fail closed.
- Dynamics transport acceptance is recorded before Dataverse is finalized.
  Sent-but-unfinalized rows are retried without another send.
- A final eligibility read occurs immediately before transport. Dataverse has
  no atomic transaction spanning its source row and Dynamics `SendEmail`, so a
  source change in the narrow interval after that read remains a cross-system
  race. The durable activity/receipt prevents blind retries, but cannot make
  those two systems one transaction.
- This first slice sends the initial advance-review notification. A separate
  follow-up notification near the send time is not implemented in P0.
- No minimum review window is guaranteed. If a row is first created after its
  scheduled send time has already passed (a cron outage longer than the lead
  window, or a preference saved late), the same cron run creates and sends it
  with no review notification, because notification claiming requires the send
  time to still be in the future. Any change here intersects the owner
  decision that lead days never move the established send date.

## Mode-A sweep report (2026-08-25)

- **Domain/change:** preference → durable scheduled draft → owned review UI
  → Dynamics transport → Dataverse finalization.
- **Authoritative evidence:** current branch source, migration 036, fresh-install
  parity, focused Jest suites, API route inventory, and build/gates recorded in
  the implementation handoff.
- **Durable surfaces reconciled:** API security matrix, Application State Atlas,
  Postgres and grantee-deliverable Atlas pages, current grantee portal spec,
  service catalog, canonical counts, source headers, and tests.
- **Historical hits left unchanged:** the historical grantee-package migration,
  signature, and route-consolidation plans preserve their dated claim-before-
  send implementation record.
- **Unknown/owner decision:** final default and rollout for existing
  no-preference PDs.
- **Verdict:** source claims reconciled; live/provisioned claim intentionally
  remains NOT VERIFIED until an approved release applies and probes migration
  036.
