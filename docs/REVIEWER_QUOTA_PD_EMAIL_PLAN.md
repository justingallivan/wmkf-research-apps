---
title: "Reviewer Quota PD Email Plan"
domain: reviewer-workbench
kind: plan
status: active
summary: "Make the existing reviewer quota threshold alert send an actual email to the lead Program Director."
owner: product-engineering
related:
  - docs/REVIEWER_ENGAGEMENT_SPEC.md
  - shared/components/reviewers/CampaignConfigModal.js
  - lib/services/reviewer-quota.js
  - lib/services/notification-service.js
  - tests/unit/reviewer-quota.test.js
---

# Reviewer Quota PD Email Plan

## Goal

When the accepted reviewer count first reaches `wmkf_desiredcount`, the existing quota threshold path should send an actual email to the lead Program Director, not only create a dashboard alert.

The quota target itself must be settable in the reviewer workflow. Without a live write path for `wmkf_desiredcount`, the email fix is inert because `maybeNotifyQuotaReached()` exits before counting accepted reviewers.

This plan does not change the reviewer-facing "no longer needed" flow. The PD still decides which pending invitees to release from the Workbench Reviewers tab; the system must not auto-withdraw pending reviewers.

## Current State

- [VERIFIED via `pages/api/external/review/[token]/respond.js:750-766`] A fresh accept calls `maybeNotifyQuotaReached()` after the accept write commits.
- [VERIFIED via `lib/services/reviewer-quota.js:52-67`] `maybeNotifyQuotaReached()` counts accepted reviewers, then conditionally writes `wmkf_quotanotifiedat` with `If-Match` before notifying.
- [VERIFIED via `lib/services/reviewer-quota.js:87-102`] The current notification call passes the resolved PD email as `explicitRecipients`, but uses `severity: 'info'` and does not set `emailAdmins: true`.
- [VERIFIED via `lib/services/notification-service.js:75-85`] `NotificationService.notify()` only sends email when `emailAdmins` is true or severity is `error`/`critical`.
- [VERIFIED via `tests/unit/notification-service-explicit-recipients.test.js:75-86`] `NotificationService.sendAdminEmail()` already supports explicit recipients without category fan-out.
- [VERIFIED via `pages/api/review-manager/campaign-config.js:33-40`] The campaign config API supports writing `desiredCount` to Dataverse column `wmkf_desiredcount`.
- [VERIFIED via `pages/api/review-manager/campaign-config.js:72-79`] `desiredCount` is validated as a non-negative integer or `null`.
- [VERIFIED via `shared/components/reviewers/CampaignConfigModal.js:21-78`] The current campaign config modal only loads and saves response timing fields; it does not expose or submit `desiredCount`.
- [VERIFIED via `pages/api/review-manager/send-emails.js:609-640`] The initial invite-batch send seeds response timing config only; it does not seed `wmkf_desiredcount`.

Result: the quota threshold path currently creates the `reviewer_quota_reached` alert row when `wmkf_desiredcount` is already populated, but the email branch is skipped. If `wmkf_desiredcount` is not populated outside the app, the quota path returns `no_quota_configured` and never reaches the notification branch.

## Implementation Invariants

| Invariant | Files likely touched | Verification |
|---|---|---|
| PDs can set or clear the quota target from the reviewer workflow | `shared/components/reviewers/CampaignConfigModal.js`, `pages/api/review-manager/campaign-config.js` | Modal GET state includes `desiredCount`; save payload includes `desiredCount`; API validation remains non-negative integer or `null` |
| A missing quota remains explicitly supported | `shared/components/reviewers/CampaignConfigModal.js`, `lib/services/reviewer-quota.js` | Clearing the field sends `desiredCount: null`; quota checker still returns `no_quota_configured` for null or non-positive values |
| Quota threshold still fires only after a committed fresh accept | `pages/api/external/review/[token]/respond.js`, unchanged | Existing `respond.js` call remains after accept write |
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
- Preserve the existing API-side validation in `pages/api/review-manager/campaign-config.js`; do not add a separate write route.

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
