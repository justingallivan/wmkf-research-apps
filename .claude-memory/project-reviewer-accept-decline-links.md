---
name: Reviewer accept/decline magic links — shipped through external-reviewer landing
description: HMAC magic-link primitive, invitation action links, and pre-materials self-withdrawal through the existing decline/referral form are implemented.
type: project
originSessionId: 223c47bb-55ef-4adb-bab2-c2616bfa5311
status: active
scope: reviewer
last_verified: 2026-07-24 via source and focused regression tests
---

## Recall Rule

Read this when: someone asks for reviewer accept/decline email buttons or a click-from-email response flow.

Do:
- Build the email-side UX on top of the existing `pages/api/external/review/[token]/respond.js` endpoint and `lib/external/token-lifecycle.js` primitive.
- Add a two-click confirm page to defeat email-scanner prefetch (Defender Safe Links, Gmail prefetch, antivirus crawlers GET every link).
- Reuse `EXTERNAL_LINK_SECRET`.

Do not:
- Rebuild the HMAC token primitive, the external-reviewer landing page, or the accept/decline endpoint — all SHIPPED (endpoint verified 2026-05-14).
- Add a separate `REVIEWER_RESPONSE_SECRET`, or recreate `pages/review-response.js` / `pages/api/review-response/confirm.js` (those paths are unused; capability lives in `respond.js`).

Ground truth: `pages/api/external/review/[token]/respond.js`, `lib/external/token-lifecycle.js`, `lib/services/external-token.js`, `lib/dataverse/adapters/reviewer-suggestion.js` (`applyStage2aResponse`, `applyStaffReviewerWithdrawal`), `docs/API_ROUTE_SECURITY_MATRIX.md`.

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

**Email action UX shipped (2026-07-24):**
- Invitation buttons deep-link to the existing portal with `?action=accept` or
  `?action=decline`; GET only selects a form and never mutates state, so scanner
  prefetch is harmless.
- The acceptance-confirmation email stores the portal token encrypted in the
  durable acceptance job and links to `?action=decline`.
- Accepted reviewers may self-withdraw only before materials/review receipt.
  The existing decline form captures reason/referrals; the state flip and exact
  linked honorarium deletion are atomic, and the PD is notified after commit.
- The originally planned `pages/review-response.js` and
  `pages/api/review-response/confirm.js` paths were never created; the
  capability lives in the portal + `respond.js`.

**How to apply:**
- If accept/decline email buttons change, preserve the current GET-as-view-hint /
  POST-as-only-mutation boundary. Don't add a separate
  `REVIEWER_RESPONSE_SECRET` (use `EXTERNAL_LINK_SECRET`).
- `response_received_at` auto-fills when the reviewer responds through the
  landing page. On the current feature branch, a PD can also record an accepted
  reviewer's emailed withdrawal through Track Reviewers; that action writes the
  declined response state, revokes access, removes the exact linked honorarium,
  and cancels acceptance follow-up without asking for alternate suggestions.
  Initial pre-accept replies received only by email still require staff entry.
