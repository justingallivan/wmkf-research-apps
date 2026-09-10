---
title: Deliberation Briefing Page — Read-Only Materials for Board Members and Consultants Without Login
domain: workbench
kind: plan
status: active
summary: "Share mints one expiring, revocable link per proposal serving the shared writeup, all completed reviews with authors, and the proposal narrative, no login."
canonical: false
cataloged: 2026-09-09
last_verified: 2026-09-09
owner: product-engineering
related:
  - docs/PC_MEETING_TRACKER_PLAN.md
  - docs/plans/STAFF_DELIBERATIONS_TAB_SHAPE_BRIEF_2026-09-09.md
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/atlas/postgres-infra-tables.md
---

# Deliberation Briefing Page

Board members and external consultants attend deliberation sessions and site visits but have no Dataverse login. Today the Share email carries the writeup as an attachment plus SharePoint links that require login [VERIFIED via lib/services/pre-site-visit/distribution-service.js:198-210, `distributionBodyHtml`]. This plan adds one read-only page per proposal, reached by a link the Share email carries, that serves the materials the session needs.

The first deliberation session is the week of 2026-09-14. This is the deliberation-session subset of the Site Visit Materials briefing room planned on `origin/codex/applicant-additional-materials` [PLANNED there, not built]; applicant additional materials are out of scope here and get a slot later.

## 1. Owner decisions (2026-09-09, Session 502)

| # | Decision |
|---|---|
| D13 | Every recipient sees the full reviews and their authors. No anonymized or summarized variant. |
| D14 | The page shows all completed reviews for the proposal. Staff do not select a subset. |
| D15 | Share creates the link. There is no separate "publish" step. |
| D16 | Staff can revoke the link from the tab. Revoking issues a new link; the old one stops working immediately. |

Carried from the Codex Site Visit Materials plan §2 and §9, unchanged: one shared link per proposal, read-only, no copies of files, exact pinned writeup version, external labels are institution-led and carry no request number, unknown members fail closed, no folder listing.

## 2. Contract

### 2.1 What the page serves

| Section | Source | Pinned or live |
|---|---|---|
| Session line | Meeting Tracker reader `getDeliberationScheduleByRequests` (PC_MEETING_TRACKER_PLAN §5.4) [PLANNED, Codex slice 2]; until it lands, a local seam returns null and the page reads "Session not yet scheduled" | live |
| Site visit line | active `wmkf_sitevisit` for the request via `findActiveByRequest` [VERIFIED via lib/dataverse/adapters/site-visit.js:46-58], reduced to one row by `selectActiveSiteVisit` (earliest scheduled end wins, ties on activity id) [ASSUMED rule, owner may adjust] so expiry and display never depend on Dataverse's ordering | live |
| Writeup (Word and PDF) | the frozen snapshot request documents pinned on the most recent distribution attempt for this request that Dynamics accepted for transport (`state = 'sent'`; send intent alone is not publication, since a pre-transport recheck can still fail after it is stamped): `pre_site_distribution_attempts.docx_drive_id/docx_item_id` and `pdf_*` [VERIFIED via lib/db/migrations/034_pre_site_distribution_attempts.sql:29-48]. Snapshot rows are separate retained request documents created by `ensureSnapshot` and re-validated for stability by `validateReadySnapshot` [VERIFIED via lib/services/pre-site-visit/distribution-service.js:612, 702-760], so the item id is the exact version and `GraphService.downloadFile(driveId, itemId)` serves it without a version-content endpoint. | pinned to the last Share |
| Reviews | `wmkf_appreviewersuggestion` rows for the request read through `findByRequest(requestId, { selectedOnly: true, requireComplete: true })` and kept when `wmkf_reviewreceivedat` is set, the same signal the Reviews tab uses [VERIFIED via lib/services/review-manager/reviewers-service.js:200-206, 386-391]; answers via `fetchAnswersBySuggestion` [VERIFIED via lib/services/review-answers.js:18-21]; the file via the existing `downloadReview` reader [VERIFIED via lib/services/review-manager/download-review-service.js:1-60] after the server proves the suggestion is in this request's set | live (a late review appears without re-sharing) |
| Proposal narrative | `AI Materials/ProposalNarrative_{Request#}.pdf` located through `listProposalDocuments` [VERIFIED via lib/services/workbench-proposal-documents.js:71-130] at request time | live by path |

Before any Share has been sent, the writeup section reads "The writeup will appear here once staff share it." Everything else still renders.

Departure from the Codex plan §8 (stored manifest): no manifest row. The link row holds identity, expiry, and revocation only. Writeup identity comes from the distribution ledger, which already pins exact snapshots per send. Reviews are resolved live because D14 replaced staff selection with "all completed."

### 2.2 Link lifecycle

- **Table** `deliberation_briefing_links` (migration 038) [PLANNED]. At most one live row per request, enforced by a partial unique index on `request_id WHERE revoked_at IS NULL` [PLANNED; a constraint, not a data count]. Columns: `id`, `request_id`, `jti`, `token_digest` (SHA-256 of the JWT, unique), `token_ciphertext` (the JWT encrypted with `lib/utils/encryption.js` `encrypt`/`decrypt`, keyed by `USER_PREFS_ENCRYPTION_KEY` [VERIFIED via lib/utils/encryption.js:5-8, 50, 78], so Share can re-carry the same link and staff can copy it), `expires_at`, `created_by`, `created_at`, `revoked_at`, `revoked_by`, `superseded_by`.
- **Token**: `mintScopedToken({ subject: requestId, audience: 'briefing', ops: ['view_briefing'], expiresAt })`, the same primitive the grantee surface uses [VERIFIED via lib/external/grantee-token-lifecycle.js:54-70]. Verification requires signature, `aud === 'briefing'`, digest match against a live row, `revoked_at IS NULL`, `expires_at > now`, and `sub` equal to the row's `request_id`. Every external request re-runs the row checks; there is no cache.
- **Expiry** [ASSUMED default, owner may adjust]: the first event-based cutoff strictly later than now wins, however close, site visit scheduled end + 7 days, then `wmkf_meetingdate` + 7 days; only when neither authoritative read is still ahead (both absent, or both already past, as in a post-visit re-share) does mint + 60 days apply. A failed site-visit or request read refuses to mint rather than widening the window. Expiry is fixed in the JWT; extending it means reissuing.
- **Mint** (`ensureLiveBriefingLink`): returns the live row when one exists and is not expired; otherwise mints, revoking any expired live row first. Runs inside `preparePreSiteDistribution` after the source resolves, so the link appears in the exact preview; its id joins `previewHash` (which today covers attachments, links, calendar, recipients, subject, and body [VERIFIED via lib/services/pre-site-visit/distribution-service.js:1140-1178]) and is stored on the attempt (`pre_site_distribution_attempts.briefing_link_id`, migration 038 [PLANNED]). The stored email body carries a placeholder, never the token; the live URL is rendered into the Dynamics activity at creation (and re-rendered for recovery matching), so `pre_site_distribution_attempts.body_html` never holds a usable bearer. Once the flag is on, an unsent preview prepared before it (no bound link) is refused with `distribution_briefing_stale` so the PD re-prepares and the email carries the link; a preview whose send was already requested only reconciles. Send re-checks that the same link is still live at claim time and again immediately before transport; a revoke in between fails the send with `distribution_briefing_stale` and asks for a new preview, matching the existing stale-source and stale-material guards [VERIFIED via lib/services/pre-site-visit/distribution-service.js:1259-1310].
- **Reissue** (`reissueBriefingLink`): a single transaction locks the live row and every unsent distribution attempt bound to it, refuses with 409 `briefing_send_in_progress` when one of those attempts holds an unexpired send lease or reached `send_requested` within the last 24 hours without reconciling to `sent` [ASSUMED window; an ambiguous Dynamics SendEmail resolves on the next retry], locks every unsent attempt bound to the link before evaluating those blockers so a prepared attempt cannot claim a send lease mid-replacement, refuses with 409 `briefing_link_superseded` when the live row is no longer the one the caller inspected (compare-and-swap; `expectedLinkId` is required for staff reissue, so a stale client gets 400 rather than revoking blindly; the tab refreshes, Share's `ensure` adopts the current readable row), otherwise marks the live row revoked and inserts the replacement, recording `superseded_by`. A send that claims its lease after that commit sees the link revoked and fails `distribution_briefing_stale`. The tab shows the new link. Old emails now point at a dead link; the PD resends. A live row whose sealed token can no longer be read (key rotation, damaged ciphertext) is reported as `unreadable` to the tab, which still offers "Issue new link"; Share's `ensure` replaces such a row itself.
- **Feature gate**: `DELIBERATION_BRIEFING_SCHEMA_READY === 'on'`, owner-set after applying migration 038, the same convention as `SITE_VISIT_LOGISTICS_SCHEMA_READY` [VERIFIED via lib/utils/site-visit-logistics-readiness.js:10-12]. When off, the composer states the page is not enabled, no link enters the email body or preview hash, the staff route returns 503, and the external routes return 404. Rollback is unsetting the flag; the migration is additive.

### 2.3 Routes

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/external/briefing/[token]/context` | GET | External token (`verifyBriefingToken`) | method → rate limit → verify → record outcome → shape, the order the grantee context route documents [VERIFIED via pages/api/external/grantee/[token]/context.js:14-15]. Returns the page model: title, session, site visit, expiry, writeup descriptors, reviews with answers, proposal descriptor. No SharePoint or Dataverse URLs. |
| `/api/external/briefing/[token]/document` | GET | External token | `?member=` one of `writeup-docx`, `writeup-pdf`, `proposal`, `review:<suggestionId>`. The server resolves the member against the same model; anything else is 404 before any Graph call. Streams bytes with `nosniff`, `private, no-store`, and a bounded `Content-Disposition`, as the reviewer proposal route does [VERIFIED via pages/api/external/review/[token]/proposal.js:81-91, 128-133]. PDF inline, everything else attachment. |
| `/api/workbench/pre-site-visit/briefing-link` | GET, POST | `requireAppAccess('reviewers')`, the guard the sibling distribution routes use [VERIFIED via pages/api/workbench/pre-site-visit/distribution/prepare.js:33] | GET returns the live link summary for a request or null. POST `{ requestId, action: 'ensure' \| 'reissue' }` mints or reissues; actor from session. |

Page: `pages/external/briefing/[token].js`, modeled on the grantee shell [VERIFIED via pages/external/grantee/[token].js:28-65, 126-132].

### 2.4 Staff surface

Inside `PreSiteDistributionPanel` (rendered by the tab once the writeup is shared [VERIFIED via shared/components/workbench/StaffDeliberationsTab.js:830-843]): the composer shows "Briefing page link — included in this email, expires {date}" once the preview has minted it. After a send, the panel header shows the live link with Copy and "Issue new link" (a confirm dialog names the consequence: earlier emails stop working, resend required).

## 3. Security contract

- New audience `briefing`; reviewer and grantee tokens are rejected by audience, and briefing tokens are rejected by the reviewer and grantee verifiers by the same check [VERIFIED via lib/external/verify-grantee-token.js:52-58 for the grantee side].
- Rate limited per token and per IP via `checkRateLimit` / `recordTokenOutcome` [VERIFIED via lib/external/rate-limit.js:139, 191].
- The external routes never accept a request id, file path, drive id, or filename from the client. `member` is an enum plus a GUID that must appear in the server-resolved review set.
- Response headers on `document`: `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Disposition` with a sanitized filename.
- Raw token never logged or persisted outside `token_ciphertext`: the attempt row stores a body placeholder, and the URL is unsealed only inside the staff route and the distribution send path when the Dynamics activity is built.
- Writeup downloads hash the bytes and refuse (`snapshot_mismatch`) when they differ from the byte hash the distribution ledger pinned.
- The page renders a session meeting link only when it parses as an absolute `https:` URL.
- Every `document` member re-resolves the request in Dataverse before any retained pointer or Graph read; a request that no longer resolves is 404 for downloads as well as for `context`.
- Codex adversarial reviews (2026-09-09, gpt-5.6-sol): two passes, twelve findings, all addressed on the same branch; record in `outputs/deliberation-briefing-codex-adversarial-review-2026-09-09.md`.
- Reviewer names and affiliations are shown (D13). The page carries no request number in its title (Codex plan §9 external-label rule); the writeup filenames may include it because staff already send them by email.

## 4. Tests

- Verifier: valid → ok; after revoke → `revoked`; digest mismatch with valid signature → `invalid_claim`; grantee-audience token → `invalid_claim`; expired row → `expired`; `sub` ≠ row request → `invalid_claim`.
- Mint: ensure twice → same row id; reissue → old row revoked with `superseded_by`, new row live.
- Distribution: preview hash changes when the link id changes; send after reissue fails with `distribution_briefing_stale`; flag off → no link section in `distributionBodyHtml` and no `briefingLinkId` in the hash.
- `document`: unknown member → 404 with no Graph call; `review:<guid>` outside the request's set → 404; headers asserted.
- `context`: flag off → 404; reviews limited to received rows; no URL-shaped fields in the response.
- Page: fail-closed states render; writeup placeholder before any send.

## 5. Durable surfaces touched

Migration `038_deliberation_briefing_links.sql` + manifest; Atlas `postgres-infra-tables.md` and `APPLICATION_STATE_ATLAS.md` rows; `API_ROUTE_SECURITY_MATRIX.md` rows for the three routes above; `CREDENTIALS_RUNBOOK.md` for the new flag; `SERVICE_AND_UTILITY_CATALOG.md`; docs catalog; the Codex plan's out-of-scope note is superseded for this subset (recorded here, not on the Codex branch).

## 6. Release

Tier 2 on `feature/deliberation-briefing-page`. Owner applies migration 038 to production, sets the flag, merges, and opens a real link in a private window before the first session. Rollback: unset the flag.
