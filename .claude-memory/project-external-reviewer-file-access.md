---
name: External reviewer file access architecture (proposals out, reviews in)
description: SHIPPED 2026-05-03 — foundation-owned external-intake primitive (HMAC magic-links) mediates proposal download + review upload through our backend. Reusable for the intake portal. SharePoint write access verified end-to-end.
type: project
originSessionId: 9ea67012-f70f-47e6-ba56-ded9f73601c4
---
Two related problems that share the same underlying architectural question: how do we hand foundation-controlled documents to external reviewers (who don't have AzureAD accounts) and accept their uploads back?

**Problem A — Proposal URLs in emails throw "expired link" errors.** The links we send to reviewers point at SharePoint share URLs (or similar). Reviewers without authenticated access to the akoyaGO site can't open them — and even when authenticated paths exist, the links seem to expire. Justin's read: the deeper issue is that reviewer access must be non-authenticated for that fragment of the SharePoint drive, which the akoyaGO site policy may not currently support.

**Problem B — Review uploads originally landed in Vercel Blob, not SharePoint.** Pre-2026-05-03, `/api/review-manager/upload-review` wrote to `reviews/{requestId}/{suggestionId}_{filename}` in Vercel Blob. The SharePoint write path was wired in alongside the external-reviewer landing rollout: uploads now land in the request-specific SharePoint folder (`Reviewer_Downloads/Reviews/`) and the Vercel Blob path was retired 2026-05-03 via commit `2277d23` (see Status block below).

**Why these are one problem:** both A and B are about the same boundary — foundation files exposed to external parties.

**Updated direction (Session 121, 2026-05-01):** Plan is to build a foundation-owned external-intake primitive (HMAC-signed magic-link tokens) that mediates BOTH outbound proposal access and inbound review uploads through our own backend. Reviewer never touches SharePoint directly — our backend authenticates via the app registration on every read/write. **This means the "separate quarantine library with anonymous-public permissions" idea (earlier guess in this note) is unnecessary** — the akoyaGO site never needs anonymous access at all because the boundary is at our backend, not at SharePoint. Reviews can land in the request's existing folder under a `Reviews/` subfolder.

Connor (2026-05-01) is open to eventually replacing GOapply (the Bromelkamp applicant portal) and bringing applicant intake in-house too. Strategy: build reviewer-side first (smaller N, async, email fallback exists), then extend the same primitive to applicants if it proves out.

**Status (2026-05-03): SHIPPED.** Token utility, middleware allowlist for `/external/*`, tokenized proposal download endpoint, tokenized upload endpoint with SharePoint write + Dataverse writeback, and per-recipient token minting in Review Manager email render are all live. Vercel Blob review download path was retired 2026-05-03 (commit `2277d23`). Token expiry is now event-driven (90-day mint ceiling, 7-day post-submission modify window via `extendForPostSubmissionWindow`).

**How to apply:**
- Don't rebuild any of the above. Reuse the `lib/external/*` primitives (`token-lifecycle`, `verify-suggestion-token`, `reviewer-materials`, `review-form-schema`) for new external-facing flows.
- Applicant-side (GOapply replacement) is the *next* extension — same primitive should carry over to the intake portal.
