---
name: reviewer-invite-capture-mode-not-full-sandbox
description: REVIEWER_EMAIL_DELIVERY_MODE=capture blocks reviewer email delivery only — it does NOT stop the Dataverse writes on the invite path (token mint, lifecycle stamp)
metadata:
  type: project
  status: active
last_verified: 2026-10-22 via render-emails-service.js, send-emails-service.js, token-lifecycle.js, and reviewer-suggestion.js
---

## Recall Rule

Before using reviewer-email capture mode, assume it suppresses transport only.
Use throwaway records for any realistic invite-flow exercise unless the current
source proves every persistence side effect is disabled.

`REVIEWER_EMAIL_DELIVERY_MODE=capture` (default `send`; blocked in Vercel prod)
makes the reviewer-invite send path route to `captureReviewerEmail` instead of
`DynamicsService.createAndSendEmail` — so **no email leaves** [VERIFIED 2026-07-27
via `lib/services/review-manager/send-emails-service.js:1201-1209,570-572`].
It is not a full sandbox. **Historical checkpoint (2026-07-27):** this note
recorded that template rendering called `mintAndStore()` for an external-link
placeholder and persisted token state. Later source changed the preview
contract. **Current source** renders `{{externalLink}}` as a deliberately
non-live placeholder and does not mint or change token authority
[`lib/services/review-manager/render-emails-service.js::renderEmails`]. That
claim is limited to token minting; other preview setup may still perform its
own reads or writes. The actual send service mints at the final dispatch
boundary before capture is recorded, so a capture-mode send can still write
Dataverse:

1. **Token mint** — an actual send containing the external-link placeholder
   calls `mintAndStore()` and persists a replacement token hash/expiry through
   `setExternalToken` before the transport branch [VERIFIED via
   `lib/services/review-manager/send-emails-service.js::sendEmails`,
   `lib/external/token-lifecycle.js::mintAndStore`, and
   `lib/dataverse/adapters/reviewer-suggestion.js::setExternalToken`]. Capture
   suppresses transport only; it does not suppress this send-boundary mint.
2. **Invite lifecycle stamp** — a `send-emails` invitation with `markAsSent:true`
   writes `wmkf_invited=true` + `emailSentAt` regardless of delivery mode
   [VERIFIED via `lib/services/review-manager/send-emails-service.js:977`].

Contact promotion and ORCID back-prop are absent from **all** send modes after
S389; capture returns the same legacy `contactPromoted:false` /
`orcidBackprop:null` fields as real send
[VERIFIED 2026-07-30 via
`lib/services/review-manager/send-emails-service.js`]. The
abstract-edit route (`update-abstract`) is a separate write, not capture-aware.

**How to apply:** current preview rendering uses a non-live placeholder and
does not mint, but a capture-mode send can still rotate token authority and
stamp an invitation. Drive send/edit exercises against a **throwaway reviewer
suggestion + proposal**, never a real reviewer. Keep the separate abstract-edit
write in scope when testing `update-abstract`; capture mode does not make that
route safe. See
[[reviewer-workbench-lifecycle]] and the external-reviewer-portal topic.
