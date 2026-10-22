---
name: External reviewer file access architecture (proposals out, reviews in)
description: Shipped external reviewer HMAC magic-link flow for proposal download and review upload. Reuse its primitives for reviewer flows; the broader applicant-intake extension remains parked pending a new owner decision. Site Visit materials is separate.
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
status: active
scope: reviewer
last_verified: 2026-10-22 via current lib/external source and callers; production deployment evidence remains date-bounded to 2026-08-11 / 2026-08-12
---

## Recall Rule

Read this when: building any external-facing flow that hands foundation files to non-AzureAD parties or accepts their uploads (reviewer or applicant intake).

Do:
- Reuse the `lib/external/*` primitives (`token-lifecycle`, `verify-suggestion-token`, `reviewer-materials`, `review-form-schema`) — the HMAC magic-link boundary is at our backend.
- Treat the GOapply replacement/applicant-intake extension as parked. Reopen it
  only if the owner makes a new decision; see
  `project-intake-portal-parked`. The shipped Site Visit materials collection is
  a separate product and does not revive that broader intake-portal direction.

Do not:
- Rebuild the token/download/upload flow — it shipped 2026-05-03.
- Reach for anonymous-public SharePoint permissions or a separate quarantine library — unnecessary, the boundary is our backend, not SharePoint.

Ground truth: `lib/external/*`, `proxy.js` (`/external/*` allowlist), `/api/review-manager/upload-review`, commit `2277d23`.

Two related problems that share the same underlying architectural question: how do we hand foundation-controlled documents to external reviewers (who don't have AzureAD accounts) and accept their uploads back?

**Historical Problem A (pre-2026-05-03) — proposal URLs in emails threw
"expired link" errors.** Direct SharePoint links did not provide a reliable
external-reviewer boundary; this motivated the backend-mediated token flow.

**Historical Problem B — review uploads originally landed in Vercel Blob, not
SharePoint.** Pre-2026-05-03, `/api/review-manager/upload-review` wrote there;
the dated rollout evidence records the later SharePoint path and Blob-path
retirement.

**Why these are one problem:** both A and B are about the same boundary — foundation files exposed to external parties.

**Historical design direction (Session 121, 2026-05-01):** The plan was to build a foundation-owned external-intake primitive (HMAC-signed magic-link tokens) that mediates BOTH outbound proposal access and inbound review uploads through our own backend. Reviewer never touches SharePoint directly — our backend authenticates via the app registration on every read/write. **This meant the "separate quarantine library with anonymous-public permissions" idea (an earlier guess in this note) was unnecessary** — the akoyaGO site never needed anonymous access because the boundary was at our backend, not at SharePoint. Reviews could land in the request's existing folder under a `Reviews/` subfolder. This records the reviewer-side design that shipped; the separate GOapply replacement idea remains parked as stated above.

**Historical direction (Session 121, 2026-05-01):** Connor was open to
eventually replacing GOapply (the Bromelkamp applicant portal) and bringing
applicant intake in-house. The plan was reviewer-side first, then extend the
same primitive to applicants if it proved out. That historical possibility is
not a current roadmap: the broader intake-portal project is parked and requires
a new owner decision before work resumes. The separately shipped Site Visit
materials collection is not the GOapply replacement.

## Current source contract — verified 2026-10-22

Current source
contains the token utility, `/external/*` proxy allowlist, tokenized proposal
download/upload, SharePoint writeback, and per-recipient minting. Source
keys expiry on accepted status via `computeReviewerTokenExpiry`
(`lib/external/reviewer-token-ttl.js`): accepted → review-due at 23:59:59 UTC
+ 90d; invitee/non-responder → that due instant + 2d; no sane future due date
→ now + 90d. Link-bearing sends, respond-by reminder sends,
`regenerate-token`, and `ensureToken` use the suggestion override first and
the request date second. Review-due reminders and ordinary follow-up/thank-you
messages are link-free and do not mint or rotate token authority. [VERIFIED via
`lib/external/reviewer-token-ttl.js`, `lib/services/review-manager/send-emails-service.js`,
and `lib/services/reviewer-reminder-sweep.js`; no deployment probe performed.]

`extendForPostSubmissionWindow` sets the stored expiry to `now + 7 days` by
default after a successful upload. This is an absolute assignment and can
shorten a later stored expiry; it does not change the signed JWT expiry and
does not grant permission to edit or upload again. The shared receipt guard
locks every received review against all later writers
(`lib/services/review-upload.js` and its callers), regardless of the token's
remaining expiry. Reviewer upload also requires
`wmkf_reviewstatus >= materials_sent`.

## Historical rollout receipts

Production promotion and Vercel Blob retirement were observed on 2026-05-03
(`2277d23`). Wave 18's override-first effective date was verified through the
production create/publish/exact probe, non-clobbering settings seed, main commit
`8647af33`, deployment `dpl_AbTvWvMYb5inwPnYKTK2mkrkNXZz`, and HTTP checks on
2026-08-11 / 2026-08-12 UTC. These dated observations do not establish today's
deployment state or imply that link-free review-due reminders mint tokens.

**How to apply:**
- Don't rebuild any of the above. Reuse the `lib/external/*` primitives (`token-lifecycle`, `verify-suggestion-token`, `reviewer-materials`, `review-form-schema`) for new external-facing flows.
- Applicant-side (GOapply replacement) is not the next extension. Reopen only
  under a new owner decision; keep its parked status separate from the shipped
  Site Visit materials product.
