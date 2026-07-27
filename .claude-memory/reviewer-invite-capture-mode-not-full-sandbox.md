---
name: reviewer-invite-capture-mode-not-full-sandbox
description: REVIEWER_EMAIL_DELIVERY_MODE=capture blocks reviewer email delivery only — it does NOT stop the Dataverse writes on the invite path (token mint, lifecycle stamp)
metadata:
  type: project
  status: active
  last_verified: 2026-07-27 via render-emails-service.js, token-lifecycle.js, and send-emails-service.js
---

## Recall Rule

Before using reviewer-email capture mode, assume it suppresses transport only.
Use throwaway records for any realistic invite-flow exercise unless the current
source proves every persistence side effect is disabled.

`REVIEWER_EMAIL_DELIVERY_MODE=capture` (default `send`; blocked in Vercel prod)
makes the reviewer-invite send path route to `captureReviewerEmail` instead of
`DynamicsService.createAndSendEmail` — so **no email leaves** [VERIFIED 2026-07-27
via `lib/services/review-manager/send-emails-service.js:1201-1209,570-572`].
It is NOT a full
sandbox. Two write paths on the invite flow still hit real Dataverse in capture:

1. **Token mint** — rendering a template that contains the external-link placeholder
   calls `mintAndStore()` and persists a replacement hash/expiry via
   `setExternalToken` [VERIFIED 2026-07-27 via
   `lib/services/review-manager/render-emails-service.js:143-169`,
   `lib/external/token-lifecycle.js:45-60`, and
   `lib/dataverse/adapters/reviewer-suggestion.js:215-222`]. There is no
   delivery-mode check in this path, so such a preview persists a token.
2. **Invite lifecycle stamp** — a `send-emails` invitation with `markAsSent:true`
   writes `wmkf_invited=true` + `emailSentAt` regardless of delivery mode
   [VERIFIED 2026-07-27 via
   `lib/services/review-manager/send-emails-service.js:625-647`].

Capture skips contact promotion and ORCID back-prop (`skipped_capture`)
[VERIFIED 2026-07-27 via
`lib/services/review-manager/send-emails-service.js:573-610`]. The
abstract-edit route (`update-abstract`) is a separate write, not capture-aware.

**How to apply:** a render that needs an external link is not side-effect-free.
Drive preview/send/edit tests against a **throwaway reviewer suggestion +
proposal**, never a real reviewer. See
[[reviewer-workbench-lifecycle]] and the external-reviewer-portal topic.
