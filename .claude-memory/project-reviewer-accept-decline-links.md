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
- Historical token-lifecycle behavior (Session 125): after a successful review
  upload, `extendForPostSubmissionWindow` sets the stored expiry to `now + 7
  days` by default. This absolute assignment can shorten a later stored expiry;
  it does not change the signed JWT expiry or grant permission to edit a
  received review. The shared receipt guard rejects later upload writes. See
  the current reviewer upload/receipt contract in the External Reviewer Portal
  wiki.

**Accept/decline endpoint SHIPPED (verified 2026-05-14):**
- `pages/api/external/review/[token]/respond.js` is the unified accept/decline endpoint. Validates `action` as `'accept'` or `'decline'`.
- Writes `wmkf_accepted`, `wmkf_declined`, `wmkf_responsetype`, `wmkf_responsereceivedat` via `lib/dataverse/adapters/reviewer-suggestion.js:444-469`.
- Catalogued in `docs/API_ROUTE_SECURITY_MATRIX.md` as "Token-scoped accept/decline."

**Email action UX shipped (2026-07-24):**
- Invitation buttons deep-link to the existing portal with `?action=accept` or
  `?action=decline`; these query values select the displayed form. The
  external context GET also performs a best-effort first-access timestamp
  update when `wmkf_proposalfirstaccessed` is empty, and requests use
  Postgres-backed rate-limit accounting. Scanner prefetch can therefore cause
  this first-access stamp and rate-limit accounting, but cannot accept or
  decline a reviewer.
- The acceptance-confirmation email stores the portal token encrypted in the
  durable acceptance job and links to `?action=decline`.
- Accepted reviewers may self-withdraw only before materials/review receipt.
  The existing decline form captures reason/referrals; the state flip and exact
  linked honorarium deletion are atomic, and the PD is notified after commit.
- The originally planned `pages/review-response.js` and
  `pages/api/review-response/confirm.js` paths were never created; the
  capability lives in the portal + `respond.js`.

**How to apply:**
- If accept/decline email buttons change, preserve the decision boundary:
  accept/decline transitions are POST-only, while GET may select a view and
  perform the best-effort first-access stamp. Don't add a separate
  `REVIEWER_RESPONSE_SECRET` (use `EXTERNAL_LINK_SECRET`).
- `response_received_at` auto-fills when the reviewer responds through the
  landing page. Production merge `70f51f45` also lets a PD record an accepted
  reviewer's emailed withdrawal through Track Reviewers; that action writes the
  declined response state, revokes access, removes the exact linked honorarium,
  and cancels acceptance follow-up without asking for alternate suggestions.
  Initial pre-accept replies received only by email still require staff entry.
