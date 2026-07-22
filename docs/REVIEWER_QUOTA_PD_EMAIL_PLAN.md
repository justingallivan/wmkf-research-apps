---
title: "Reviewer Quota PD Email Plan"
domain: reviewer-workbench
kind: plan
status: historical
summary: "SHIPPED S352 (2026-07-09): the reviewer quota threshold alert now emails the lead Program Director, and the quota target is settable/seeded end-to-end."
owner: product-engineering
related:
  - docs/REVIEWER_ENGAGEMENT_SPEC.md
  - shared/components/reviewers/CampaignConfigModal.js
  - lib/services/reviewer-quota.js
  - lib/services/notification-service.js
  - tests/unit/reviewer-quota.test.js
---

# Reviewer Quota PD Email Plan

> **Completed outcome:** The quota/PD email change shipped in S352. This document is
> retained as the historical implementation record.
>
> **Current routing:** Use [Reviewer Workbench & Lifecycle](agent-wiki/topics/reviewer-workbench-lifecycle.md)
> for current reviewer engagement behavior.

## Status: SHIPPED (S352, 2026-07-09)

Both proposed changes are built and deployed, plus three owner-requested extensions
beyond the original plan:

- **Change #1 (quota settable in the modal)** — `4a2ee03c`. `CampaignConfigModal` loads,
  saves, and clears `desiredCount` (UI-only, as planned).
- **Change #2 (PD email on quota reached)** — `4a2ee03c`. The `reviewer_quota_reached`
  notify sets `emailAdmins: true`, drops `category: 'reviewers'`, keeps
  `explicitRecipients: pdEmail ? [pdEmail] : []` (alert-only fallback when the PD email
  is unresolvable), exactly per §Proposed Changes.
- **Extension: admin default** — `c2785729`. The Reviewer Campaign Timeline admin panel
  carries a "Reviewer quota" default (`desiredCount`, default 4) in
  `reviewer.campaign_timeline_defaults`; legacy stored JSON backfills 4, an explicitly
  cleared default stays null. The campaign settings modal prefills Review due date and
  Reviewer quota from these defaults when the request value is unset (durable only on Save).
- **Extension: first-send seeding** — `a28876b0`. `send-emails-service.js` seeds
  `wmkf_desiredcount` from the admin default on the first invite send, in the same
  per-column non-clobbering gate as the timing columns (server-side default read only,
  never from the client payload; best-effort). The request `$select` now includes
  `wmkf_desiredcount` so the never-overwrite guard sees existing values (regression-tested).

The sections below are the original plan, retained as the design record. Their
"current state" claims describe the pre-build codebase.

## Goal

When the accepted reviewer count first reaches `wmkf_desiredcount`, the existing quota threshold path should send an actual email to the lead Program Director, not only create a dashboard alert.

The quota target itself must be settable in the reviewer workflow. Without a live write path for `wmkf_desiredcount`, the email fix is inert because `maybeNotifyQuotaReached()` exits before counting accepted reviewers.

This plan does not change the reviewer-facing "no longer needed" flow. The PD still decides which pending invitees to release from the Workbench Reviewers tab; the system must not auto-withdraw pending reviewers.

## Codebase Drift Since Scoping (re-verified 2026-07-09, S350)

This plan was scoped 2026-07-02. It was recovered to `main` (commit `1420d79c`) and
re-verified against a codebase roughly a week ahead. **Neither proposed change had been
built at that point** (both shipped S352 — see Status above). The goal and both changes
remained valid, but two structural shifts landed after
scoping and moved cited code:

1. **The quota check moved off the synchronous accept path into the async drain.** The
   reviewer accept-fast-response build (shipped 2026-07-04, `reviewer_acceptance_jobs`
   queue + drain) moved `maybeNotifyQuotaReached()` out of `respond.js`. It is now called
   **only** from `lib/services/reviewer-acceptance-drain.js` (`processReviewerAcceptanceJob`),
   which the `/api/cron/drain-reviewer-acceptances` cron runs (~2-min cadence). The drain
   re-verifies the Dataverse accept committed (`verifyAcceptedOrCancel`) before running the
   quota step, and wraps the whole job in `withDalContext('cron-drain-reviewer-acceptances')`.
   **Implication:** the PD email now fires from the async drain, not synchronously on accept —
   a short delay, and the "fires only after a committed accept" invariant is satisfied by the
   drain's accept re-verification rather than by call-ordering in `respond.js`. The trusted DAL
   context needed for the email send is already established by the cron.
2. **Campaign-config write/validation moved route → service.** Per the Route→Service
   Consolidation Plan (Stage 2), `pages/api/review-manager/campaign-config.js` is now a thin
   shell delegating to `lib/services/review-manager/campaign-config-service.js`. `desiredCount`
   is a generic entry in that service's `WRITABLE_FIELDS` map (`{ col: 'wmkf_desiredcount',
   kind: 'int' }`), validated non-negative-int-or-null by `coerceField`, and returned by
   `readConfig`. **Implication for Change #1:** the backend write/read/validation for
   `desiredCount` already exist end-to-end with no backend edits needed — only the modal UI is
   missing.

## Current State

- [VERIFIED 2026-07-09 via `lib/services/reviewer-acceptance-drain.js` (`processReviewerAcceptanceJob`, quota step ~line 406)] The accept follow-up drain calls `maybeNotifyQuotaReached()` after re-verifying the Dataverse accept committed. (Was `respond.js` at scoping; moved by the 2026-07-04 accept-fast-response drain.)
- [VERIFIED 2026-07-09 via `lib/services/reviewer-quota.js` (`maybeNotifyQuotaReached`, ~lines 46-83)] Counts accepted reviewers, then conditionally writes `wmkf_quotanotifiedat` with `If-Match` (bounded-retry loop distinguishing the two 412 causes) before notifying.
- [VERIFIED 2026-07-09 via `lib/services/reviewer-quota.js` (notify call, ~lines 88-100)] The current notification call passes the resolved PD email as `explicitRecipients` and still sets `category: 'reviewers'`, but uses `severity: 'info'` and does not set `emailAdmins: true`.
- [VERIFIED 2026-07-09 via `lib/services/notification-service.js:74-75`] `NotificationService.notify()` only sends email when `emailAdmins` is true or severity is `error`/`critical`.
- [VERIFIED 2026-07-09 via `tests/unit/notification-service-explicit-recipients.test.js`] `NotificationService.sendAdminEmail()` already supports explicit recipients, union'd with (optional) category recipients and deduped.
- [VERIFIED 2026-07-09 via `lib/services/review-manager/campaign-config-service.js:38`] The campaign config service supports writing `desiredCount` to Dataverse column `wmkf_desiredcount` via its generic `WRITABLE_FIELDS` map. (Was the route file at scoping; moved route → service.)
- [VERIFIED 2026-07-09 via `lib/services/review-manager/campaign-config-service.js:84-87` (`coerceField`)] `desiredCount` is validated as a non-negative integer, with `null` allowed to clear the column.
- [VERIFIED 2026-07-09 via `shared/components/reviewers/CampaignConfigModal.js:7-11`] The current campaign config modal only loads and saves response-timing fields; it deliberately does not expose or submit `desiredCount` ("we don't surface a control that does nothing yet").
- [VERIFIED 2026-07-09] The initial invite-batch send seeds response-timing config only; it does not seed `wmkf_desiredcount`. (Send logic moved to `lib/services/review-manager/send-emails-service.js`; neither the route nor the service references `desiredCount`.)

Result: the quota threshold path currently creates the `reviewer_quota_reached` alert row when `wmkf_desiredcount` is already populated, but the email branch is skipped. If `wmkf_desiredcount` is not populated outside the app, the quota path returns `no_quota_configured` and never reaches the notification branch.

## Implementation Invariants

| Invariant | Files likely touched | Verification |
|---|---|---|
| PDs can set or clear the quota target from the reviewer workflow | `shared/components/reviewers/CampaignConfigModal.js`, `pages/api/review-manager/campaign-config.js` | Modal GET state includes `desiredCount`; save payload includes `desiredCount`; API validation remains non-negative integer or `null` |
| A missing quota remains explicitly supported | `shared/components/reviewers/CampaignConfigModal.js`, `lib/services/reviewer-quota.js` | Clearing the field sends `desiredCount: null`; quota checker still returns `no_quota_configured` for null or non-positive values |
| Quota threshold still fires only after a committed fresh accept | `lib/services/reviewer-acceptance-drain.js`, unchanged | Drain's `verifyAcceptedOrCancel` gates the quota step on a confirmed-accepted Dataverse row; the `maybeNotifyQuotaReached()` call in the drain remains after that gate (call moved off `respond.js` by the 2026-07-04 accept-fast-response build) |
| Only the first threshold winner can attempt the PD email | `lib/services/reviewer-quota.js` | Existing `wmkf_quotanotifiedat` conditional `If-Match` write remains before notify |
| The quota alert email goes to the lead PD when resolvable | `lib/services/reviewer-quota.js` | `NotificationService.notify()` receives `emailAdmins: true` and `explicitRecipients: [pdEmail]` |
| The quota alert does not fan out to the `reviewers` category by accident | `lib/services/reviewer-quota.js` | Omit `category` when `pdEmail` is present, relying on explicit-only recipient routing |
| If the PD email cannot be resolved, no broad accidental email is sent | `lib/services/reviewer-quota.js` | Empty `explicitRecipients` means email send no-ops; dashboard alert remains the durable fallback |
| Pending reviewers are not auto-withdrawn | `lib/services/reviewer-quota.js`, `pages/api/review-manager/withdraw-sufficient.js` | No call to `withdraw-sufficient`; Workbench button remains the only no-longer-needed sender |

## Proposed Changes

### 1. Make the quota target settable

In `shared/components/reviewers/CampaignConfigModal.js`, add a reviewer quota input backed by `desiredCount`:

- Load `desiredCount` from `GET /api/review-manager/campaign-config`.
- Let the PD enter a non-negative integer reviewer target or clear the field.
- Submit `desiredCount` in the existing `POST /api/review-manager/campaign-config` payload.
- Preserve the existing validation, which now lives in `lib/services/review-manager/campaign-config-service.js` (`coerceField` / `WRITABLE_FIELDS`), not the thin route shell; do not add a separate write route. The service already accepts, validates, and returns `desiredCount`, so no backend change is required — this is a UI-only change.

The UI label should make clear this is the number of committed reviewers needed before the PD is notified, not an automatic withdrawal count.

### 2. Send the PD email when the quota is reached

In `lib/services/reviewer-quota.js`, change the `NotificationService.notify()` call for `type: 'reviewer_quota_reached'` so the alert forces email delivery:

```js
await NotificationService.notify({
  type: 'reviewer_quota_reached',
  severity: 'info',
  title: ...,
  message: ...,
  metadata: ...,
  source: 'reviewer-quota',
  emailAdmins: true,
  explicitRecipients: pdEmail ? [pdEmail] : [],
});
```

Do not pass `category: 'reviewers'` on this forced-email path unless the owner explicitly wants reviewer-quota threshold emails copied to the configured reviewer alert category. `NotificationService.sendAdminEmail()` unions category recipients with explicit recipients, so keeping the category would send beyond the lead PD when that category is configured.

## Tests

Update the campaign config coverage:

1. Add or update a component/API test proving `desiredCount` is loaded into the campaign config modal.
2. Assert saving the modal posts `desiredCount` with the existing response timing fields.
3. Assert clearing the quota posts `desiredCount: null`, not `0` unless the PD explicitly enters zero.
4. Keep the route-level validation behavior for negative and non-integer values.

Update `tests/unit/reviewer-quota.test.js`:

1. The existing threshold test should assert the notify call includes `emailAdmins: true`.
2. It should assert `explicitRecipients: ['pd@keck.org']`.
3. It should assert `category` is absent or undefined for the PD-only email path.
4. Add or adjust a resolver-null test so a missing PD email still returns `{ notified: true }` after the marker write, but passes `explicitRecipients: []` and does not add a category fallback.

Existing `tests/unit/notification-service-explicit-recipients.test.js` already proves explicit-only recipient routing sends only to explicit recipients and never calls category resolution.

Suggested verification:

```bash
npm test -- tests/unit/reviewer-quota.test.js tests/unit/notification-service-explicit-recipients.test.js --runInBand
```

Also run the new or updated campaign-config component/API test that covers the `desiredCount` modal load/save behavior.

## Operational Preconditions

Email still depends on `NotificationService.isEmailEnabled()`:

- `NOTIFICATION_EMAIL_FROM`
- `DYNAMICS_URL`
- `DYNAMICS_TENANT_ID`
- `DYNAMICS_CLIENT_ID`
- `DYNAMICS_CLIENT_SECRET`

The sender mailbox must be a Dynamics `systemuser` with outgoing Server-Side Sync, as documented in `docs/TODO_EMAIL_NOTIFICATIONS.md`.

## Out Of Scope

- Auto-selecting pending invitees.
- Auto-sending "no longer needed" emails to reviewers when quota is reached.
- Changing `wmkf_quotanotifiedat` semantics or adding a retry field.
- Adding a new email template. This is a PD system alert, not the reviewer-facing withdrawal email template.
