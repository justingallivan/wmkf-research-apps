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
