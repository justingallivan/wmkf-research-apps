---
name: External reviewer file access architecture (proposals out, reviews in)
description: SHIPPED 2026-05-03 — foundation-owned external-intake primitive (HMAC magic-links) mediates proposal download + review upload through our backend. Reusable for the intake portal. SharePoint write access verified end-to-end.
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
status: active
scope: reviewer
last_verified: 2026-07-27 via lib/external source, upload service, proxy allowlist, and current token-lifecycle callers; external deployment remains date-bounded
---

## Recall Rule

Read this when: building any external-facing flow that hands foundation files to non-AzureAD parties or accepts their uploads (reviewer or applicant intake).

Do:
- Reuse the `lib/external/*` primitives (`token-lifecycle`, `verify-suggestion-token`, `reviewer-materials`, `review-form-schema`) — the HMAC magic-link boundary is at our backend.
- Extend the same primitive to the applicant intake portal.

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

**Updated direction (Session 121, 2026-05-01):** Plan is to build a foundation-owned external-intake primitive (HMAC-signed magic-link tokens) that mediates BOTH outbound proposal access and inbound review uploads through our own backend. Reviewer never touches SharePoint directly — our backend authenticates via the app registration on every read/write. **This means the "separate quarantine library with anonymous-public permissions" idea (earlier guess in this note) is unnecessary** — the akoyaGO site never needs anonymous access at all because the boundary is at our backend, not at SharePoint. Reviews can land in the request's existing folder under a `Reviews/` subfolder.

Connor (2026-05-01) is open to eventually replacing GOapply (the Bromelkamp applicant portal) and bringing applicant intake in-house too. Strategy: build reviewer-side first (smaller N, async, email fallback exists), then extend the same primitive to applicants if it proves out.

**Source status verified 2026-07-27; deployment evidence dated.** Current source
contains the token utility, `/external/*` proxy allowlist, tokenized proposal
download/upload, SharePoint writeback, and per-recipient minting. Production
promotion and Vercel Blob retirement were observed on 2026-05-03
(`2277d23`); re-probe deployment state if operationally material. Current source
keys expiry on accepted status via `computeReviewerTokenExpiry`
(`lib/external/reviewer-token-ttl.js`): accepted → review-due + 90d,
invitee/non-responder → review-due + 2d cap, no sane future due date → 90d
fallback. `regenerate-token`/`ensureToken` retain the flat 90-day default;
`extendForPostSubmissionWindow` supplies the seven-day modify window; upload
requires `wmkf_reviewstatus >= materials_sent`.

**How to apply:**
- Don't rebuild any of the above. Reuse the `lib/external/*` primitives (`token-lifecycle`, `verify-suggestion-token`, `reviewer-materials`, `review-form-schema`) for new external-facing flows.
- Applicant-side (GOapply replacement) is the *next* extension — same primitive should carry over to the intake portal.
