# Codex adversarial review — Deliberation briefing page (PR #221), 2026-09-09

Model `gpt-5.6-sol`, `--base origin/main`, run by Claude with owner authorization (Session 502). Verdict: needs-attention, six findings. Every finding was verified against source before the fix; all six are addressed on the same branch (commit after `f91c1900`).

| # | Finding (Codex) | Verified? | Fix |
|---|---|---|---|
| 1 | Raw JWT persisted in `pre_site_distribution_attempts.body_html` | Yes: `bodyHtml` embedded the URL and the INSERT stores it | Stored body holds `BRIEFING_LINK_PLACEHOLDER`; `renderBriefingBody` substitutes the live URL only at Dynamics activity creation and for recovery matching. Test: persisted attempt fields never contain the token. |
| 2 | Reissue mid-send could email a dead link; only one liveness check, before attachments | Yes: pre-transport block re-checked source and extensions only | `resolveBoundBriefingUrl` runs at claim and again immediately before `sendEmail`; panel disables "Issue new link" while preparing or sending. Test: reissue during attachment work fails `distribution_briefing_stale` with no transport. Residual: a reissue between the last check and `SendEmail` (milliseconds) is not transactionally serialized. |
| 3 | Expiry fails open to 60 days; site-visit lookup failure swallowed | Partly: the past-date fallback was deliberate (post-visit re-share); the swallowed lookup error was real | Expiry now takes the first future event cutoff (visit end + 7d, then meeting + 7d), 60 days only when neither authoritative read yields a window; lookup errors propagate and refuse the mint. Tests for both. |
| 4 | Writeup downloads served current bytes without checking the pinned hash | Yes | SHA-256 of the downloaded buffer must equal `docx_byte_hash`/`pdf_byte_hash`; otherwise 409 `snapshot_mismatch`. Tests for mutated bytes and missing hash. |
| 5 | `briefingLinkId: null` changed flag-off hash inputs | Yes: `canonicalHash` serializes null keys | Key included only when a link exists, in both hashes. Test: absent-dependency and flag-off harnesses produce identical draft and preview hashes. |
| 6 | "https-only" guard accepted http | Yes | `new URL()` with `protocol === 'https:'`. Tests reject http, protocol-relative, javascript:, ftp, and non-URLs. |

Codex's "next steps" tests: mid-send revocation, failed schedule read, expired event dates, mutated snapshot bytes, flag-off hash compatibility, HTTP meeting links — all added. Full unit suite green after the fixes (801 suites, 11,492 tests).

## Second pass (same model, `--base origin/main`, after the first fixes)

Verdict: needs-attention, six findings. All verified against source; all addressed in the next commit.

| # | Finding (Codex) | Verified? | Fix |
|---|---|---|---|
| 1 | Reader treated `send_requested_at` as published; pre-transport rechecks can fail after it is stamped | Yes | Reader now returns the latest `state = 'sent'` attempt only (`getLatestSentAttempt`). |
| 2 | Reissue could commit between the final check and `SendEmail` | Yes | `replaceLiveLink` locks the live row and every unsent attempt bound to it `FOR UPDATE`; refuses 409 `briefing_send_in_progress` while one holds an unexpired send lease; a `claimDistributionSend` racing it waits for the commit and then fails `distribution_briefing_stale`. Owner judgment call: lease-based guard instead of a new reservation table. |
| 3 | One-hour floor discarded near cutoffs and widened expiry | Yes | Any cutoff strictly later than now is used as is. |
| 4 | Unreadable sealed token hid the only recovery action | Yes | `getLiveBriefingLink` reports `unreadable: true`; the tab shows a recovery card with "Issue new link"; Share's `ensure` replaces such a row. |
| 5 | Writeup downloads served retained bytes after the request disappeared | Yes | Every `document` member resolves the request first; a 404 there is a 404 before any Graph read. |
| 6 | `records[0]` from up to three active visits was nondeterministic | Yes | `selectActiveSiteVisit`: earliest scheduled end wins, ties on activity id; used by expiry and the page. Owner judgment call: deterministic narrowest window rather than fail-closed on duplicates. |

## Third pass (after the second fixes)

Verdict: needs-attention, two findings. Both verified; both addressed in the next commit.

| # | Finding (Codex) | Verified? | Fix |
|---|---|---|---|
| 1 | Reissue guard only blocked on an unexpired lease; an ambiguous SendEmail clears the lease with the state unresolved | Yes | Guard also blocks on any unsent attempt bound to the link with `send_requested_at` within the last 24 hours [ASSUMED window]; error text tells staff to retry the send first. |
| 2 | Unreadable/expired-row recovery replaced whichever row was live, so concurrent recoveries could revoke each other's fresh link | Yes | `replaceLiveLink` takes `expectedLiveId` (compare-and-swap under `FOR UPDATE`) and refuses 409 `briefing_link_superseded`; `ensure` adopts the current readable row on refusal; staff reissue passes the inspected id and the tab refreshes on refusal. |

## Fourth pass (after the third fixes)

Verdict: needs-attention, two findings. Both verified; both addressed in the next commit.

| # | Finding (Codex) | Verified? | Fix |
|---|---|---|---|
| 1 | The reissue transaction locked only attempts already leased or recently send-requested; a merely prepared attempt could claim a lease mid-replacement | Yes | Lock every unsent attempt bound to the link `FOR UPDATE` first, then evaluate the lease / unresolved-send blockers on the locked rows. |
| 2 | Reissue without `expectedLinkId` (a pre-deploy browser bundle) bypassed the compare-and-swap | Yes | `expectedLinkId` is required for reissue at the route (400) and the service (`briefing_expected_link_required`). |
