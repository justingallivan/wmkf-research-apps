---
name: Reviewer accept/decline magic links — partly subsumed by external-reviewer landing
description: HMAC magic-link primitive shipped as the broader external-reviewer landing page. Accept/decline endpoint `pages/api/external/review/[token]/respond.js` also shipped (verified 2026-05-14). Email-side click-buttons are the remaining gap.
type: project
originSessionId: 223c47bb-55ef-4adb-bab2-c2616bfa5311
---
**Audit 2026-05-03: this entry was rewritten.** The original plan was a small "click Accept / click Decline" flow in invitation emails. What actually shipped is broader: the External Reviewer Intake (`/external/review/[token]`) landing page, where reviewers see proposal info, download materials, and upload completed reviews — all token-authenticated.

**What shipped (don't rebuild):**
- HMAC-signed JWT primitive: `lib/services/external-token.js` (`mintToken`, `verifyToken`, `hashToken`).
- Token lifecycle: `lib/external/token-lifecycle.js` (`mintAndStore`, `revoke`, `ensureToken`, `extendForPostSubmissionWindow`, `buildExternalUrl`).
- Public endpoints: `pages/external/review/[token].js` + `pages/api/external/review/[token]/{context,proposal,upload}.js`.
- Hash-only storage in Dataverse so revoke is a single PATCH.
- 7-day post-submission modify window via `extendForPostSubmissionWindow` (Session 125).

**Accept/decline endpoint SHIPPED (verified 2026-05-14):**
- `pages/api/external/review/[token]/respond.js` is the unified accept/decline endpoint. Validates `action` as `'accept'` or `'decline'`.
- Writes `wmkf_accepted`, `wmkf_declined`, `wmkf_responsetype`, `wmkf_responsereceivedat` via `lib/dataverse/adapters/reviewer-suggestion.js:444-469`.
- Catalogued in `docs/API_ROUTE_SECURITY_MATRIX.md` as "Token-scoped accept/decline."

**What's still NOT yet built (the original-original ask):**
- Dedicated Accept / Decline buttons in invitation email bodies (the click-from-email flow). The endpoint exists; what's missing is the email-side UX that calls it with a single click.
- Two-click confirm page to defeat email-scanner prefetch.
- `pages/review-response.js` and `pages/api/review-response/confirm.js` were never created at those exact paths — the capability moved to `respond.js`. Those filenames remain unused.

**How to apply:**
- If accept/decline email buttons come up, build the email-side UX on top of the existing `respond.js` endpoint and `lib/external/token-lifecycle.js` primitive. Don't add a separate `REVIEWER_RESPONSE_SECRET` (use `EXTERNAL_LINK_SECRET`).
- Two-click confirm is still mandatory for the email-click case (Microsoft Defender Safe Links, Gmail prefetch, antivirus crawlers GET every link).
- The lifecycle gap that's still partially open: `response_received_at` auto-fills via the endpoint when the reviewer responds through the landing page; it's still manual today when staff handle replies received via email and need to enter them.
