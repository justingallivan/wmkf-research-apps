---
name: reviewer-invite-capture-mode-not-full-sandbox
description: REVIEWER_EMAIL_DELIVERY_MODE=capture blocks reviewer email delivery only — it does NOT stop the Dataverse writes on the invite path (token mint, lifecycle stamp)
metadata:
  type: project
  status: active
---

`REVIEWER_EMAIL_DELIVERY_MODE=capture` (default `send`; blocked in Vercel prod)
makes the reviewer-invite send path route to `captureReviewerEmail` instead of
`DynamicsService.createAndSendEmail` — so **no email leaves** [VERIFIED S341 via
`lib/services/review-manager/send-emails-service.js:504-506`]. It is NOT a full
sandbox. Two write paths on the invite flow still hit real Dataverse in capture:

1. **Token mint** — opening the invite preview calls `/api/review-manager/render-emails`,
   which `mintAndStore()`s an accept/decline token (hash + expiry) onto the
   reviewer suggestion via `setExternalToken` (`lib/dataverse/adapters/reviewer-suggestion.js`).
   render-emails has NO delivery-mode guard — it always mints. So even a read-only
   "preview" persists a token. (Self-heals: overwritten on the real send, expires;
   JWT never delivered.)
2. **Invite lifecycle stamp** — a `send-emails` invitation with `markAsSent:true`
   (the modal always sends true) writes `wmkf_invited=true` + `emailSentAt`
   regardless of delivery mode (`send-emails-service.js:570-582`).

Capture DOES skip contact-promotion and ORCID back-prop (`skipped_capture`). The
abstract-edit route (`update-abstract`) is a separate write, not capture-aware.

**How to apply:** for a truly side-effect-free dry run, stay at the render/preview
step and expect a token write, OR drive the send/edit steps against a **throwaway
reviewer suggestion + proposal**, never a real reviewer. See
[[reviewer-workbench-lifecycle]] and the external-reviewer-portal topic.
